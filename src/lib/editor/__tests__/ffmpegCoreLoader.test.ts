import type { toBlobURL } from '@ffmpeg/util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createCoreLoadSessionState,
  FFMPEG_CDN_BASE_URL,
  FFMPEG_CORE_VERSION,
  FFMPEG_LOAD_TIMEOUT_MS,
  FfmpegCoreLoadError,
  formatDownloadingCoreText,
  loadFfmpegCoreWithFallback,
  MIN_FFMPEG_WASM_BYTES,
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

  it('pins the exact CDN core version matching @ffmpeg/core 0.12.10', () => {
    expect(FFMPEG_CORE_VERSION).toBe('0.12.10');
    expect(FFMPEG_CDN_BASE_URL).toBe(
      'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd'
    );
    expect(FFMPEG_LOAD_TIMEOUT_MS).toBe(45_000);
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

  it('loads valid local /ffmpeg core files and caches the loaded instance in memory', async () => {
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

    const toBlobUrlFn = vi.fn();
    const fakeInstance = createFakeFfmpeg();
    const createFfmpeg = vi.fn(() => fakeInstance);
    const progressEvents: RenderProgress[] = [];

    const first = await loadFfmpegCoreWithFallback(state, {
      onProgress: (p) => progressEvents.push(p),
      deps: { fetchFn, toBlobUrlFn, createFfmpeg },
    });

    expect(first).toBe(fakeInstance);
    expect(fakeInstance.loaded).toBe(true);
    expect(toBlobUrlFn).not.toHaveBeenCalled();
    expect(progressEvents.some((p) => p.statusText === 'Downloading ffmpeg core... 12 MB / 22 MB')).toBe(
      true
    );

    // Second call returns cached instance immediately without fetching again
    const second = await loadFfmpegCoreWithFallback(state, {
      deps: { fetchFn, toBlobUrlFn, createFfmpeg },
    });
    expect(second).toBe(first);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(createFfmpeg).toHaveBeenCalledTimes(1);
  });

  it('falls back to jsDelivr via toBlobURL when local wasm returns text/html', async () => {
    const state = createCoreLoadSessionState<FfmpegInstanceLike>();
    const jsBytes = new TextEncoder().encode('export default function() {}');
    const htmlBytes = new TextEncoder().encode('<!doctype html><html><body>SPA</body></html>');

    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/ffmpeg-core.js')) {
        return makeMockResponse({
          contentType: 'text/javascript',
          bodyBytes: jsBytes,
        });
      }
      return makeMockResponse({
        contentType: 'text/html; charset=utf-8',
        contentLength: 25_000_000,
        bodyBytes: htmlBytes,
      });
    }) as unknown as typeof fetch;

    const toBlobUrlFn = vi.fn(
      async (
        url: string,
        _mime: string,
        hasCb?: boolean,
        cb?: (e: { received: number; total: number }) => void
      ) => {
        if (hasCb && cb) {
          cb({ received: 12_000_000, total: 32_000_000 });
          cb({ received: 32_000_000, total: 32_000_000 });
        }
        return `blob:cdn-${url}`;
      }
    ) as unknown as typeof toBlobURL;

    const fakeInstance = createFakeFfmpeg();
    const progressEvents: RenderProgress[] = [];

    const loaded = await loadFfmpegCoreWithFallback(state, {
      onProgress: (p) => progressEvents.push(p),
      deps: { fetchFn, toBlobUrlFn, createFfmpeg: () => fakeInstance },
    });

    expect(loaded).toBe(fakeInstance);
    expect(toBlobUrlFn).toHaveBeenCalledWith(
      `${FFMPEG_CDN_BASE_URL}/ffmpeg-core.js`,
      'text/javascript',
      false
    );
    expect(toBlobUrlFn).toHaveBeenCalledWith(
      `${FFMPEG_CDN_BASE_URL}/ffmpeg-core.wasm`,
      'application/wasm',
      true,
      expect.any(Function)
    );
    expect(
      progressEvents.some((p) => p.statusText === 'Downloading ffmpeg core... 12 MB / 32 MB')
    ).toBe(true);
  });

  it('falls back to jsDelivr when local wasm is <= 20 MB', async () => {
    const state = createCoreLoadSessionState<FfmpegInstanceLike>();
    const jsBytes = new TextEncoder().encode('export default function() {}');
    const tinyWasm = makeValidWasmBytes(512_000);

    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/ffmpeg-core.js')) {
        return makeMockResponse({ contentType: 'text/javascript', bodyBytes: jsBytes });
      }
      return makeMockResponse({
        contentType: 'application/wasm',
        contentLength: tinyWasm.byteLength,
        bodyBytes: tinyWasm,
      });
    }) as unknown as typeof fetch;

    const toBlobUrlFn = vi.fn(async (url: string) => `blob:cdn-${url}`);
    const fakeInstance = createFakeFfmpeg();

    const loaded = await loadFfmpegCoreWithFallback(state, {
      deps: { fetchFn, toBlobUrlFn, createFfmpeg: () => fakeInstance },
    });

    expect(loaded).toBe(fakeInstance);
    expect(toBlobUrlFn).toHaveBeenCalledTimes(2);
  });

  it('falls back to jsDelivr when local js returns HTML bytes', async () => {
    const state = createCoreLoadSessionState<FfmpegInstanceLike>();
    const htmlJs = new TextEncoder().encode('<!DOCTYPE html><html></html>');

    const fetchFn = vi.fn(async () =>
      makeMockResponse({
        contentType: 'application/javascript', // misconfigured MIME but HTML content
        bodyBytes: htmlJs,
      })
    ) as unknown as typeof fetch;

    const toBlobUrlFn = vi.fn(async (url: string) => `blob:cdn-${url}`);
    const fakeInstance = createFakeFfmpeg();

    const loaded = await loadFfmpegCoreWithFallback(state, {
      deps: { fetchFn, toBlobUrlFn, createFfmpeg: () => fakeInstance },
    });

    expect(loaded).toBe(fakeInstance);
    expect(toBlobUrlFn).toHaveBeenCalledTimes(2);
  });

  it('falls back to jsDelivr when local loading times out', async () => {
    const state = createCoreLoadSessionState<FfmpegInstanceLike>();
    let abortedByTimeout = false;

    const fetchFn = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => {
              abortedByTimeout = true;
              reject(new DOMException('Aborted', 'AbortError'));
            },
            { once: true }
          );
        })
    ) as unknown as typeof fetch;

    const toBlobUrlFn = vi.fn(async (url: string) => `blob:cdn-${url}`);
    const fakeInstance = createFakeFfmpeg();

    const loaded = await loadFfmpegCoreWithFallback(state, {
      deps: { fetchFn, toBlobUrlFn, createFfmpeg: () => fakeInstance, timeoutMs: 25 },
    });

    expect(abortedByTimeout).toBe(true);
    expect(loaded).toBe(fakeInstance);
    expect(toBlobUrlFn).toHaveBeenCalledTimes(2);
  });

  it('switches only ffmpeg-core.js to /esm when module worker fails to import UMD script', async () => {
    const state = createCoreLoadSessionState<FfmpegInstanceLike>();
    const fetchFn = vi.fn(async () =>
      makeMockResponse({ ok: false, status: 404 })
    ) as unknown as typeof fetch;

    const toBlobUrlFn = vi.fn(async (url: string) => `blob:${url}`);
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
      deps: { fetchFn, toBlobUrlFn, createFfmpeg },
    });

    expect(loaded).toBe(instances[1]);
    expect(toBlobUrlFn).toHaveBeenCalledWith(
      `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${FFMPEG_CORE_VERSION}/dist/esm/ffmpeg-core.js`,
      'text/javascript',
      false
    );
    // WASM downloaded only once
    expect(toBlobUrlFn).toHaveBeenCalledTimes(3);
  });

  it('throws FfmpegCoreLoadError and leaves session reset when both local and CDN fail', async () => {
    const state = createCoreLoadSessionState<FfmpegInstanceLike>();
    const fetchFn = vi.fn(async () =>
      makeMockResponse({ ok: false, status: 503 })
    ) as unknown as typeof fetch;
    const toBlobUrlFn = vi.fn(async () => {
      throw new Error('CDN unreachable');
    });

    await expect(
      loadFfmpegCoreWithFallback(state, {
        deps: { fetchFn, toBlobUrlFn, createFfmpeg: () => createFakeFfmpeg() },
      })
    ).rejects.toBeInstanceOf(FfmpegCoreLoadError);

    expect(state.instance).toBeNull();
    expect(state.loadPromise).toBeNull();
    expect(state.coreURL).toBeNull();
    expect(state.wasmURL).toBeNull();
  });

  it('aborts immediately without CDN fallback and resets state when caller cancels', async () => {
    const state = createCoreLoadSessionState<FfmpegInstanceLike>();
    const controller = new AbortController();

    const fetchFn = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Cancelled', 'AbortError')),
            { once: true }
          );
        })
    ) as unknown as typeof fetch;

    const toBlobUrlFn = vi.fn();

    const loadPromise = loadFfmpegCoreWithFallback(state, {
      signal: controller.signal,
      deps: { fetchFn, toBlobUrlFn, createFfmpeg: () => createFakeFfmpeg(), timeoutMs: 5000 },
    });

    controller.abort();

    await expect(loadPromise).rejects.toMatchObject({ name: 'AbortError' });
    expect(toBlobUrlFn).not.toHaveBeenCalled();
    expect(state.instance).toBeNull();
    expect(state.loadPromise).toBeNull();
  });
});
