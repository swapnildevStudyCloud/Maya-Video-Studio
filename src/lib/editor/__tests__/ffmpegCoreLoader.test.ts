import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearCachedFfmpegCore,
  CoreDownloadError,
  createCoreLoadSessionState,
  downloadValidatedCoreFile,
  FFMPEG_CACHE_NAME,
  FFMPEG_CDN_BASE_URL,
  FFMPEG_CORE_VERSION,
  FFMPEG_OVERALL_TIMEOUT_MS,
  FFMPEG_STALL_TIMEOUT_MS,
  FfmpegCoreLoadError,
  formatDownloadingCoreText,
  getFfmpegCoreCacheKey,
  loadFfmpegCoreWithFallback,
  MIN_FFMPEG_WASM_BYTES,
  type CacheLike,
  type CacheStorageLike,
  type FfmpegInstanceLike,
} from '../ffmpegCoreLoader';
import type { RenderProgress } from '../types';

function makeValidWasmBytes(size = MIN_FFMPEG_WASM_BYTES + 1024): Uint8Array {
  const buf = new Uint8Array(size);
  // WASM magic header: \0asm
  buf[0] = 0x00;
  buf[1] = 0x61;
  buf[2] = 0x73;
  buf[3] = 0x6d;
  return buf;
}

function makeMockResponse(params: {
  ok?: boolean;
  status?: number;
  contentType?: string;
  contentLength?: number;
  bodyBytes?: Uint8Array;
  chunks?: Uint8Array[];
}): Response {
  const {
    ok = true,
    status = 200,
    contentType = 'application/octet-stream',
    contentLength,
    bodyBytes,
    chunks,
  } = params;

  const headers = new Headers();
  if (contentType) headers.set('content-type', contentType);
  if (contentLength !== undefined) {
    headers.set('content-length', String(contentLength));
  }

  let body: ReadableStream<Uint8Array> | null = null;
  if (chunks) {
    body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(chunk);
        }
        controller.close();
      },
    });
  } else if (bodyBytes) {
    body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bodyBytes);
        controller.close();
      },
    });
  }

  return new Response(body, { status: ok ? status : status || 404, headers });
}

function createFakeFfmpeg(loadImpl?: FfmpegInstanceLike['load']): FfmpegInstanceLike & {
  loadMock: ReturnType<typeof vi.fn>;
  terminateMock: ReturnType<typeof vi.fn>;
} {
  const terminateMock = vi.fn(() => {
    instance.loaded = false;
  });
  const loadMock = vi.fn(
    loadImpl ??
      (async () => {
        instance.loaded = true;
        return true;
      })
  );
  const instance: FfmpegInstanceLike & {
    loadMock: typeof loadMock;
    terminateMock: typeof terminateMock;
  } = {
    loaded: false,
    load: loadMock,
    terminate: terminateMock,
    loadMock,
    terminateMock,
  };
  return instance;
}

function createFakeCacheStorage(): {
  cacheStorage: CacheStorageLike;
  stores: Map<string, Map<string, Response>>;
} {
  const stores = new Map<string, Map<string, Response>>();

  const cacheStorage: CacheStorageLike = {
    async open(cacheName: string): Promise<CacheLike> {
      let bucket = stores.get(cacheName);
      if (!bucket) {
        bucket = new Map<string, Response>();
        stores.set(cacheName, bucket);
      }
      const targetBucket = bucket;
      return {
        async match(request: RequestInfo | URL) {
          const key = typeof request === 'string' ? request : String(request);
          const stored = targetBucket.get(key);
          return stored ? stored.clone() : undefined;
        },
        async put(request: RequestInfo | URL, response: Response) {
          const key = typeof request === 'string' ? request : String(request);
          targetBucket.set(key, response.clone());
        },
      };
    },
    async delete(cacheName: string): Promise<boolean> {
      return stores.delete(cacheName);
    },
  };

  return { cacheStorage, stores };
}

describe('ffmpegCoreLoader', () => {
  let blobCounter = 0;

  beforeEach(() => {
    blobCounter = 0;
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:test-${++blobCounter}`);
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('defines expected version, stall/overall timeouts, and cache constants', () => {
    expect(FFMPEG_CORE_VERSION).toBe('0.12.10');
    expect(FFMPEG_CDN_BASE_URL).toBe(
      'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd'
    );
    expect(FFMPEG_STALL_TIMEOUT_MS).toBe(30_000);
    expect(FFMPEG_OVERALL_TIMEOUT_MS).toBe(300_000);
    expect(FFMPEG_CACHE_NAME).toBe('maya-ffmpeg-core-v1');
    expect(getFfmpegCoreCacheKey('ffmpeg-core.wasm', '0.12.10')).toContain('/0.12.10/ffmpeg-core.wasm');
    expect(getFfmpegCoreCacheKey('ffmpeg-core.js', '0.12.10')).toContain('/0.12.10/ffmpeg-core.js');
  });

  it('formats live download byte progress text cleanly', () => {
    expect(formatDownloadingCoreText(12_000_000, 32_000_000)).toBe(
      'Downloading ffmpeg core... 12 MB / 32 MB'
    );
    expect(formatDownloadingCoreText(35_000_000, 32_000_000)).toBe(
      'Downloading ffmpeg core... 32 MB / 32 MB'
    );
    expect(formatDownloadingCoreText(5_000_000, 0)).toBe('Downloading ffmpeg core... 5 MB');
    expect(formatDownloadingCoreText(0, 0)).toBe('Downloading ffmpeg core...');
  });

  describe('downloadValidatedCoreFile', () => {
    it('keeps downloading past stallTimeoutMs as long as chunks keep arriving, and enforces overallDeadlineAt', async () => {
      const wasmBytes = makeValidWasmBytes(22_000_000);
      const chunkSize = Math.ceil(wasmBytes.byteLength / 4);
      const chunks = [
        wasmBytes.subarray(0, chunkSize),
        wasmBytes.subarray(chunkSize, chunkSize * 2),
        wasmBytes.subarray(chunkSize * 2, chunkSize * 3),
        wasmBytes.subarray(chunkSize * 3),
      ];

      // 4 chunks spaced 20ms apart (~60-80ms total), while stallTimeoutMs is 35ms.
      const fetchSlowButSteady = vi.fn(async () => {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            chunks.forEach((chunk, index) => {
              setTimeout(() => {
                controller.enqueue(chunk);
                if (index === chunks.length - 1) {
                  controller.close();
                }
              }, (index + 1) * 20);
            });
          },
        });
        return new Response(stream, {
          status: 200,
          headers: {
            'content-type': 'application/wasm',
            'content-length': String(wasmBytes.byteLength),
          },
        });
      }) as unknown as typeof fetch;

      const downloaded = await downloadValidatedCoreFile({
        url: 'https://cdn.example/ffmpeg-core.wasm',
        sourceLabel: 'CDN',
        kind: 'wasm',
        fetchFn: fetchSlowButSteady,
        stallTimeoutMs: 35,
        overallDeadlineAt: Date.now() + 2000,
      });
      expect(downloaded.byteLength).toBe(wasmBytes.byteLength);

      // Now test overall deadline exceeding while chunks keep arriving
      await expect(
        downloadValidatedCoreFile({
          url: 'https://cdn.example/ffmpeg-core.wasm',
          sourceLabel: 'CDN',
          kind: 'wasm',
          fetchFn: fetchSlowButSteady,
          stallTimeoutMs: 500,
          overallDeadlineAt: Date.now() + 30,
        })
      ).rejects.toMatchObject({
        name: 'CoreDownloadError',
        retryable: false,
        message: expect.stringContaining('5-minute overall limit'),
      });
    });

    it('fails with stall error and arrived MB when no bytes arrive for stallTimeoutMs', async () => {
      const firstChunk = makeValidWasmBytes(12_000_000);
      const fetchStalled = vi.fn(async () => {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(firstChunk);
            // Never enqueue next chunk or close
          },
        });
        return new Response(stream, {
          status: 200,
          headers: {
            'content-type': 'application/wasm',
            'content-length': String(32_000_000),
          },
        });
      }) as unknown as typeof fetch;

      let caught: unknown;
      try {
        await downloadValidatedCoreFile({
          url: 'https://cdn.example/ffmpeg-core.wasm',
          sourceLabel: 'CDN',
          kind: 'wasm',
          fetchFn: fetchStalled,
          stallTimeoutMs: 25,
          overallDeadlineAt: Date.now() + 5000,
        });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(CoreDownloadError);
      const dlErr = caught as CoreDownloadError;
      expect(dlErr.receivedBytes).toBe(12_000_000);
      expect(dlErr.totalBytes).toBe(32_000_000);
      expect(dlErr.retryable).toBe(true);
      expect(dlErr.message).toContain('stalled');
      expect(dlErr.message).toContain('12 MB of 32 MB');
    });

    it('reports real network error with arrived MB when stream fails partway', async () => {
      const partial = makeValidWasmBytes(12_000_000);
      const fetchPartialFail = vi.fn(async () => {
        let sent = false;
        const stream = new ReadableStream<Uint8Array>({
          pull(controller) {
            if (!sent) {
              sent = true;
              controller.enqueue(partial);
              return;
            }
            controller.error(new TypeError('Failed to fetch'));
          },
        });
        return new Response(stream, {
          status: 200,
          headers: {
            'content-type': 'application/wasm',
            'content-length': '32000000',
          },
        });
      }) as unknown as typeof fetch;

      let caught: unknown;
      try {
        await downloadValidatedCoreFile({
          url: 'https://cdn.example/ffmpeg-core.wasm',
          sourceLabel: 'CDN',
          kind: 'wasm',
          fetchFn: fetchPartialFail,
        });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(CoreDownloadError);
      const dlErr = caught as CoreDownloadError;
      expect(dlErr.receivedBytes).toBe(12_000_000);
      expect(dlErr.totalBytes).toBe(32_000_000);
      expect(dlErr.retryable).toBe(true);
      expect(dlErr.message).toContain('CDN ffmpeg-core.wasm network error after 12 MB of 32 MB');
      expect(dlErr.message).toContain('Failed to fetch');
    });

    it('rejects size mismatch when stream closes with fewer bytes than Content-Length', async () => {
      const truncated = makeValidWasmBytes(21_000_000);
      const fetchTruncated = vi.fn(async () =>
        makeMockResponse({
          contentType: 'application/wasm',
          contentLength: 32_000_000,
          bodyBytes: truncated,
        })
      ) as unknown as typeof fetch;

      await expect(
        downloadValidatedCoreFile({
          url: 'https://cdn.example/ffmpeg-core.wasm',
          sourceLabel: 'CDN',
          kind: 'wasm',
          fetchFn: fetchTruncated,
        })
      ).rejects.toMatchObject({
        name: 'CoreDownloadError',
        retryable: true,
        message: expect.stringContaining('size mismatch: 21 MB of 32 MB arrived'),
      });
    });

    it('rejects HTML responses and wasm <= 20 MB', async () => {
      const htmlFetch = vi.fn(async () =>
        makeMockResponse({
          contentType: 'text/html; charset=utf-8',
          bodyBytes: new TextEncoder().encode('<!doctype html>'),
        })
      ) as unknown as typeof fetch;

      await expect(
        downloadValidatedCoreFile({
          url: '/ffmpeg/ffmpeg-core.js',
          sourceLabel: 'Local',
          kind: 'js',
          fetchFn: htmlFetch,
        })
      ).rejects.toMatchObject({
        name: 'CoreDownloadError',
        message: expect.stringContaining('returned HTML'),
      });

      const smallWasmFetch = vi.fn(async () =>
        makeMockResponse({
          contentType: 'application/wasm',
          contentLength: 5_000_000,
          bodyBytes: makeValidWasmBytes(5_000_000),
        })
      ) as unknown as typeof fetch;

      await expect(
        downloadValidatedCoreFile({
          url: '/ffmpeg/ffmpeg-core.wasm',
          sourceLabel: 'Local',
          kind: 'wasm',
          fetchFn: smallWasmFetch,
        })
      ).rejects.toMatchObject({
        name: 'CoreDownloadError',
        message: expect.stringContaining('too small'),
      });
    });
  });

  it('loads valid local /ffmpeg core files and keeps the loaded instance in memory', async () => {
    const state = createCoreLoadSessionState<FfmpegInstanceLike>();
    const jsBytes = new TextEncoder().encode('export default function createFFmpegCore() {}');
    const wasmBytes = makeValidWasmBytes(22_000_000);
    const chunkA = wasmBytes.subarray(0, 12_000_000);
    const chunkB = wasmBytes.subarray(12_000_000);

    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/ffmpeg-core.js')) {
        return makeMockResponse({
          contentType: 'text/javascript',
          contentLength: jsBytes.byteLength,
          bodyBytes: jsBytes,
        });
      }
      if (url.endsWith('/ffmpeg-core.wasm')) {
        return makeMockResponse({
          contentType: 'application/wasm',
          contentLength: wasmBytes.byteLength,
          chunks: [chunkA, chunkB],
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    }) as unknown as typeof fetch;

    const fakeInstance = createFakeFfmpeg();
    const createFfmpeg = vi.fn(() => fakeInstance);
    const progressEvents: RenderProgress[] = [];

    const first = await loadFfmpegCoreWithFallback(state, {
      onProgress: (p) => progressEvents.push(p),
      deps: { fetchFn, createFfmpeg, cacheStorage: null },
    });

    expect(first).toBe(fakeInstance);
    expect(fakeInstance.loaded).toBe(true);
    expect(progressEvents.some((p) => p.statusText === 'Downloading ffmpeg core... 12 MB / 22 MB')).toBe(
      true
    );

    // Second call returns cached session instance immediately without fetching again
    const second = await loadFfmpegCoreWithFallback(state, {
      deps: { fetchFn, createFfmpeg, cacheStorage: null },
    });
    expect(second).toBe(first);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(createFfmpeg).toHaveBeenCalledTimes(1);
  });

  it('falls back to jsDelivr via reader download (not toBlobURL) when local returns HTML or <= 20 MB', async () => {
    const state = createCoreLoadSessionState<FfmpegInstanceLike>();
    const jsBytes = new TextEncoder().encode('export default function() {}');
    const htmlBytes = new TextEncoder().encode('<!doctype html><html><body>SPA</body></html>');
    const cdnWasm = makeValidWasmBytes(32_000_000);

    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/ffmpeg/')) {
        if (url.endsWith('/ffmpeg-core.js')) {
          return makeMockResponse({
            contentType: 'text/javascript',
            contentLength: jsBytes.byteLength,
            bodyBytes: jsBytes,
          });
        }
        return makeMockResponse({
          contentType: 'text/html; charset=utf-8',
          contentLength: 25_000_000,
          bodyBytes: htmlBytes,
        });
      }
      if (url === `${FFMPEG_CDN_BASE_URL}/ffmpeg-core.js`) {
        return makeMockResponse({
          contentType: 'text/javascript',
          contentLength: jsBytes.byteLength,
          bodyBytes: jsBytes,
        });
      }
      if (url === `${FFMPEG_CDN_BASE_URL}/ffmpeg-core.wasm`) {
        return makeMockResponse({
          contentType: 'application/wasm',
          contentLength: cdnWasm.byteLength,
          chunks: [cdnWasm.subarray(0, 12_000_000), cdnWasm.subarray(12_000_000)],
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    }) as unknown as typeof fetch;

    const fakeInstance = createFakeFfmpeg();
    const progressEvents: RenderProgress[] = [];

    const loaded = await loadFfmpegCoreWithFallback(state, {
      onProgress: (p) => progressEvents.push(p),
      deps: { fetchFn, createFfmpeg: () => fakeInstance, cacheStorage: null },
    });

    expect(loaded).toBe(fakeInstance);
    expect(fetchFn).toHaveBeenCalledWith(
      `${FFMPEG_CDN_BASE_URL}/ffmpeg-core.js`,
      expect.any(Object)
    );
    expect(fetchFn).toHaveBeenCalledWith(
      `${FFMPEG_CDN_BASE_URL}/ffmpeg-core.wasm`,
      expect.any(Object)
    );
    expect(
      progressEvents.some((p) => p.statusText === 'Downloading ffmpeg core... 12 MB / 32 MB')
    ).toBe(true);
  });

  it('falls back to jsDelivr when local loading stalls past stallTimeoutMs', async () => {
    const state = createCoreLoadSessionState<FfmpegInstanceLike>();
    let abortedByStallTimeout = false;
    const jsBytes = new TextEncoder().encode('export default function() {}');
    const cdnWasm = makeValidWasmBytes(22_000_000);

    const fetchFn = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('/ffmpeg/')) {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => {
              abortedByStallTimeout = true;
              reject(new DOMException('Aborted', 'AbortError'));
            },
            { once: true }
          );
        });
      }
      if (url.endsWith('/ffmpeg-core.js')) {
        return Promise.resolve(
          makeMockResponse({
            contentType: 'text/javascript',
            contentLength: jsBytes.byteLength,
            bodyBytes: jsBytes,
          })
        );
      }
      return Promise.resolve(
        makeMockResponse({
          contentType: 'application/wasm',
          contentLength: cdnWasm.byteLength,
          bodyBytes: cdnWasm,
        })
      );
    }) as unknown as typeof fetch;

    const fakeInstance = createFakeFfmpeg();
    const loaded = await loadFfmpegCoreWithFallback(state, {
      deps: {
        fetchFn,
        createFfmpeg: () => fakeInstance,
        cacheStorage: null,
        stallTimeoutMs: 25,
        overallTimeoutMs: 5000,
      },
    });

    expect(abortedByStallTimeout).toBe(true);
    expect(loaded).toBe(fakeInstance);
  });

  it('switches only ffmpeg-core.js to /esm when module worker fails to import UMD script', async () => {
    const state = createCoreLoadSessionState<FfmpegInstanceLike>();
    const jsBytes = new TextEncoder().encode('export default function() {}');
    const wasmBytes = makeValidWasmBytes(22_000_000);
    const requestedUrls: string[] = [];

    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url.startsWith('/ffmpeg/')) {
        return makeMockResponse({ ok: false, status: 404 });
      }
      if (url.endsWith('/ffmpeg-core.js')) {
        return makeMockResponse({
          contentType: 'text/javascript',
          contentLength: jsBytes.byteLength,
          bodyBytes: jsBytes,
        });
      }
      return makeMockResponse({
        contentType: 'application/wasm',
        contentLength: wasmBytes.byteLength,
        bodyBytes: wasmBytes,
      });
    }) as unknown as typeof fetch;

    let attempts = 0;
    const instances: FfmpegInstanceLike[] = [];
    const createFfmpeg = vi.fn(() => {
      attempts += 1;
      const attemptNum = attempts;
      const inst = createFakeFfmpeg(async () => {
        if (attemptNum === 1) {
          throw new Error('failed to import ffmpeg-core.js');
        }
        inst.loaded = true;
        return true;
      });
      instances.push(inst);
      return inst;
    });

    const loaded = await loadFfmpegCoreWithFallback(state, {
      deps: { fetchFn, createFfmpeg, cacheStorage: null },
    });

    expect(loaded).toBe(instances[1]);
    expect(requestedUrls).toContain(
      `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${FFMPEG_CORE_VERSION}/dist/esm/ffmpeg-core.js`
    );
    // WASM downloaded only once
    expect(requestedUrls.filter((u) => u === `${FFMPEG_CDN_BASE_URL}/ffmpeg-core.wasm`)).toHaveLength(
      1
    );
  });

  it('automatically retries a failed CDN download once before failing or succeeding', async () => {
    const state = createCoreLoadSessionState<FfmpegInstanceLike>();
    const jsBytes = new TextEncoder().encode('export default function() {}');
    const wasmBytes = makeValidWasmBytes(22_000_000);
    let cdnWasmAttempts = 0;

    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/ffmpeg/')) {
        return makeMockResponse({ ok: false, status: 404 });
      }
      if (url.endsWith('/ffmpeg-core.js')) {
        return makeMockResponse({
          contentType: 'text/javascript',
          contentLength: jsBytes.byteLength,
          bodyBytes: jsBytes,
        });
      }
      cdnWasmAttempts += 1;
      if (cdnWasmAttempts === 1) {
        // First CDN attempt drops partway at 12 MB
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(wasmBytes.subarray(0, 12_000_000));
            controller.error(new TypeError('network reset'));
          },
        });
        return new Response(stream, {
          status: 200,
          headers: {
            'content-type': 'application/wasm',
            'content-length': String(wasmBytes.byteLength),
          },
        });
      }
      return makeMockResponse({
        contentType: 'application/wasm',
        contentLength: wasmBytes.byteLength,
        bodyBytes: wasmBytes,
      });
    }) as unknown as typeof fetch;

    const fakeInstance = createFakeFfmpeg();
    const loaded = await loadFfmpegCoreWithFallback(state, {
      deps: { fetchFn, createFfmpeg: () => fakeInstance, cacheStorage: null },
    });

    expect(loaded).toBe(fakeInstance);
    expect(cdnWasmAttempts).toBe(2);
  });

  it('retries CDN once and throws clear FfmpegCoreLoadError with arrived MB and Retry guidance when both attempts fail', async () => {
    const state = createCoreLoadSessionState<FfmpegInstanceLike>();
    const jsBytes = new TextEncoder().encode('export default function() {}');
    let cdnWasmAttempts = 0;

    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/ffmpeg/')) {
        return makeMockResponse({ ok: false, status: 404 });
      }
      if (url.endsWith('/ffmpeg-core.js')) {
        return makeMockResponse({
          contentType: 'text/javascript',
          contentLength: jsBytes.byteLength,
          bodyBytes: jsBytes,
        });
      }
      cdnWasmAttempts += 1;
      const partial = makeValidWasmBytes(12_000_000);
      let sent = false;
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (!sent) {
            sent = true;
            controller.enqueue(partial);
            return;
          }
          controller.error(new TypeError('socket hang up'));
        },
      });
      return new Response(stream, {
        status: 200,
        headers: {
          'content-type': 'application/wasm',
          'content-length': '32000000',
        },
      });
    }) as unknown as typeof fetch;

    let caught: unknown;
    try {
      await loadFfmpegCoreWithFallback(state, {
        deps: { fetchFn, createFfmpeg: () => createFakeFfmpeg(), cacheStorage: null },
      });
    } catch (err) {
      caught = err;
    }

    expect(cdnWasmAttempts).toBe(2);
    expect(caught).toBeInstanceOf(FfmpegCoreLoadError);
    const msg = (caught as Error).message;
    expect(msg).toContain('12 MB of 32 MB');
    expect(msg).toContain('check your connection and click Retry.');
    expect(state.instance).toBeNull();
    expect(state.loadPromise).toBeNull();
    expect(state.coreURL).toBeNull();
    expect(state.wasmURL).toBeNull();
  });

  describe('Cache Storage integration', () => {
    it('stores downloaded core in Cache Storage on first load, serves from cache on next session, and clears cleanly', async () => {
      const { cacheStorage, stores } = createFakeCacheStorage();
      const jsBytes = new TextEncoder().encode('export default function() {}');
      const wasmBytes = makeValidWasmBytes(22_000_000);

      const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/ffmpeg-core.js')) {
          return makeMockResponse({
            contentType: 'text/javascript',
            contentLength: jsBytes.byteLength,
            bodyBytes: jsBytes,
          });
        }
        return makeMockResponse({
          contentType: 'application/wasm',
          contentLength: wasmBytes.byteLength,
          bodyBytes: wasmBytes,
        });
      }) as unknown as typeof fetch;

      // 1. First load -> cache miss -> downloads & populates cache
      const session1 = createCoreLoadSessionState<FfmpegInstanceLike>();
      await loadFfmpegCoreWithFallback(session1, {
        deps: { fetchFn, createFfmpeg: () => createFakeFfmpeg(), cacheStorage },
      });

      expect(fetchFn).toHaveBeenCalledTimes(2);
      const bucket = stores.get(FFMPEG_CACHE_NAME);
      expect(bucket?.has(getFfmpegCoreCacheKey('ffmpeg-core.js'))).toBe(true);
      expect(bucket?.has(getFfmpegCoreCacheKey('ffmpeg-core.wasm'))).toBe(true);

      // 2. Fresh session -> cache hit -> zero network fetches
      const fetchNeverCalled = vi.fn(async () => {
        throw new Error('Should not hit network on cache hit');
      }) as unknown as typeof fetch;

      const session2 = createCoreLoadSessionState<FfmpegInstanceLike>();
      const progressEvents: RenderProgress[] = [];
      const cachedInstance = await loadFfmpegCoreWithFallback(session2, {
        onProgress: (p) => progressEvents.push(p),
        deps: {
          fetchFn: fetchNeverCalled,
          createFfmpeg: () => createFakeFfmpeg(),
          cacheStorage,
        },
      });

      expect(cachedInstance.loaded).toBe(true);
      expect(fetchNeverCalled).not.toHaveBeenCalled();
      expect(progressEvents.some((p) => p.statusText === 'Loading cached ffmpeg core...')).toBe(true);

      // 3. Clear cache -> deleted -> subsequent session downloads again
      const cleared = await clearCachedFfmpegCore(cacheStorage);
      expect(cleared).toBe(true);
      expect(stores.has(FFMPEG_CACHE_NAME)).toBe(false);

      const session3 = createCoreLoadSessionState<FfmpegInstanceLike>();
      await loadFfmpegCoreWithFallback(session3, {
        deps: { fetchFn, createFfmpeg: () => createFakeFfmpeg(), cacheStorage },
      });
      expect(fetchFn).toHaveBeenCalledTimes(4);
    });

    it('falls back to network download cleanly if cache entry is incomplete, corrupted, or Cache Storage throws', async () => {
      const { cacheStorage } = createFakeCacheStorage();
      const cache = await cacheStorage.open(FFMPEG_CACHE_NAME);
      // Put a truncated 1 KB wasm into cache
      await cache.put(
        getFfmpegCoreCacheKey('ffmpeg-core.js'),
        new Response('export default function() {}', {
          headers: { 'content-type': 'text/javascript' },
        })
      );
      await cache.put(
        getFfmpegCoreCacheKey('ffmpeg-core.wasm'),
        makeMockResponse({
          contentType: 'application/wasm',
          contentLength: 22_000_000,
          bodyBytes: makeValidWasmBytes(1024),
        })
      );

      const jsBytes = new TextEncoder().encode('export default function() {}');
      const validWasm = makeValidWasmBytes(22_000_000);
      const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/ffmpeg-core.js')) {
          return makeMockResponse({
            contentType: 'text/javascript',
            contentLength: jsBytes.byteLength,
            bodyBytes: jsBytes,
          });
        }
        return makeMockResponse({
          contentType: 'application/wasm',
          contentLength: validWasm.byteLength,
          bodyBytes: validWasm,
        });
      }) as unknown as typeof fetch;

      const session1 = createCoreLoadSessionState<FfmpegInstanceLike>();
      const loaded1 = await loadFfmpegCoreWithFallback(session1, {
        deps: { fetchFn, createFfmpeg: () => createFakeFfmpeg(), cacheStorage },
      });
      expect(loaded1.loaded).toBe(true);
      expect(fetchFn).toHaveBeenCalledTimes(2);

      // Broken CacheStorage throwing errors should also fall back seamlessly without failing load
      const brokenCacheStorage: CacheStorageLike = {
        async open() {
          throw new Error('QuotaExceededError');
        },
        async delete() {
          throw new Error('Unavailable');
        },
      };

      const session2 = createCoreLoadSessionState<FfmpegInstanceLike>();
      const loaded2 = await loadFfmpegCoreWithFallback(session2, {
        deps: { fetchFn, createFfmpeg: () => createFakeFfmpeg(), cacheStorage: brokenCacheStorage },
      });
      expect(loaded2.loaded).toBe(true);
      expect(fetchFn).toHaveBeenCalledTimes(4);
    });
  });

  it('aborts immediately without retry or CDN fallback and resets state when caller cancels', async () => {
    const state = createCoreLoadSessionState<FfmpegInstanceLike>();
    const controller = new AbortController();
    const requestedUrls: string[] = [];
    let notifyFetchStarted!: () => void;
    const fetchStarted = new Promise<void>((resolve) => {
      notifyFetchStarted = resolve;
    });

    const fetchFn = vi.fn(
      (input: RequestInfo | URL, init?: RequestInit) => {
        requestedUrls.push(String(input));
        notifyFetchStarted();
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Cancelled', 'AbortError')),
            { once: true }
          );
        });
      }
    ) as unknown as typeof fetch;

    const loadPromise = loadFfmpegCoreWithFallback(state, {
      signal: controller.signal,
      deps: {
        fetchFn,
        createFfmpeg: () => createFakeFfmpeg(),
        cacheStorage: null,
        stallTimeoutMs: 5000,
      },
    });

    await fetchStarted;
    controller.abort();

    await expect(loadPromise).rejects.toMatchObject({ name: 'AbortError' });
    expect(requestedUrls).toEqual(['/ffmpeg/ffmpeg-core.js']);
    expect(state.instance).toBeNull();
    expect(state.loadPromise).toBeNull();
  });
});
