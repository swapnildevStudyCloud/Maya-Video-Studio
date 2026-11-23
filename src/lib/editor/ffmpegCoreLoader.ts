import { FFmpeg } from '@ffmpeg/ffmpeg';
import type { RenderProgress } from './types';

// Exact version matching installed @ffmpeg/core@0.12.10 (for @ffmpeg/ffmpeg@0.12.x)
export const FFMPEG_CORE_VERSION = '0.12.10';
export const FFMPEG_LOCAL_BASE_URL = '/ffmpeg';
export const FFMPEG_CDN_BASE_URL = `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${FFMPEG_CORE_VERSION}/dist/umd`;

export const FFMPEG_STALL_TIMEOUT_MS = 30_000; // 30 seconds with no bytes received
export const FFMPEG_OVERALL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes overall limit
export const FFMPEG_CACHE_NAME = 'maya-ffmpeg-core-v1';
export const MIN_FFMPEG_WASM_BYTES = 20 * 1024 * 1024; // 20 MB

export interface CacheLike {
  match: (request: RequestInfo | URL) => Promise<Response | undefined>;
  put: (request: RequestInfo | URL, response: Response) => Promise<void>;
}

export interface CacheStorageLike {
  open: (cacheName: string) => Promise<CacheLike>;
  delete: (cacheName: string) => Promise<boolean>;
}

export class FfmpegCoreLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FfmpegCoreLoadError';
  }
}

export class CoreDownloadError extends Error {
  readonly receivedBytes: number;
  readonly totalBytes: number;
  readonly retryable: boolean;

  constructor(
    message: string,
    info: { receivedBytes: number; totalBytes: number; retryable: boolean }
  ) {
    super(message);
    this.name = 'CoreDownloadError';
    this.receivedBytes = info.receivedBytes;
    this.totalBytes = info.totalBytes;
    this.retryable = info.retryable;
  }
}

export function getFfmpegCoreCacheKey(
  fileName: 'ffmpeg-core.js' | 'ffmpeg-core.wasm',
  version = FFMPEG_CORE_VERSION
): string {
  return `https://maya-ffmpeg-core-cache.local/${version}/${fileName}`;
}

export function formatMbLabel(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  if (bytes < 1_000_000) {
    return `${Math.max(0.1, Number((bytes / 1_000_000).toFixed(1)))} MB`;
  }
  return `${Math.round(bytes / 1_000_000)} MB`;
}

function formatArrivedProgress(receivedBytes: number, totalBytes: number): string {
  const recStr = formatMbLabel(receivedBytes);
  if (Number.isFinite(totalBytes) && totalBytes > 0) {
    return `${recStr} of ${formatMbLabel(totalBytes)}`;
  }
  return recStr;
}

export function formatDownloadingCoreText(receivedBytes: number, totalBytes: number): string {
  const receivedMb = Math.max(0, Math.round(receivedBytes / 1_000_000));
  if (Number.isFinite(totalBytes) && totalBytes > 0) {
    const totalMb = Math.max(1, Math.round(totalBytes / 1_000_000));
    const clamped = Math.min(totalMb, receivedMb);
    return `Downloading ffmpeg core... ${clamped} MB / ${totalMb} MB`;
  }
  if (receivedMb > 0) {
    return `Downloading ffmpeg core... ${receivedMb} MB`;
  }
  return 'Downloading ffmpeg core...';
}

function isHtmlContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  const lower = contentType.toLowerCase();
  return lower.includes('text/html') || lower.includes('application/xhtml');
}

function looksLikeHtmlBytes(bytes: Uint8Array): boolean {
  const sampleLen = Math.min(bytes.byteLength, 256);
  if (sampleLen === 0) return false;
  const prefix = new TextDecoder().decode(bytes.subarray(0, sampleLen)).trimStart().toLowerCase();
  return (
    prefix.startsWith('<!doctype') ||
    prefix.startsWith('<html') ||
    prefix.startsWith('<?xml') ||
    prefix.startsWith('<head') ||
    prefix.startsWith('<body')
  );
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Operation cancelled.', 'AbortError');
  }
}

function isAbortError(err: unknown, callerSignal?: AbortSignal): boolean {
  return Boolean(
    callerSignal?.aborted || (err instanceof DOMException && err.name === 'AbortError')
  );
}

async function awaitWithStepTimeout<T>(
  operation: Promise<T>,
  options: {
    callerSignal?: AbortSignal;
    stepTimeoutMs: number;
    onTimeout: () => Error;
  }
): Promise<T> {
  const { callerSignal, stepTimeoutMs, onTimeout } = options;
  throwIfAborted(callerSignal);

  return new Promise<T>((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      if (timerId !== undefined) {
        clearTimeout(timerId);
      }
      if (callerSignal) {
        callerSignal.removeEventListener('abort', onAbort);
      }
    };

    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new DOMException('Operation cancelled.', 'AbortError'));
    };

    const timerId =
      Number.isFinite(stepTimeoutMs) && stepTimeoutMs >= 0
        ? setTimeout(() => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(onTimeout());
          }, stepTimeoutMs)
        : undefined;

    if (callerSignal) {
      callerSignal.addEventListener('abort', onAbort, { once: true });
    }

    operation.then(
      (val) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(val);
      },
      (err) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(err);
      }
    );
  });
}

function computeNextStepBudget(
  stallTimeoutMs: number,
  overallDeadlineAt: number | undefined
): { stepMs: number; isOverallLimit: boolean } {
  if (overallDeadlineAt === undefined) {
    return { stepMs: stallTimeoutMs, isOverallLimit: false };
  }
  const remainingOverall = overallDeadlineAt - Date.now();
  if (remainingOverall <= 0) {
    return { stepMs: 0, isOverallLimit: true };
  }
  if (remainingOverall < stallTimeoutMs) {
    return { stepMs: remainingOverall, isOverallLimit: true };
  }
  return { stepMs: stallTimeoutMs, isOverallLimit: false };
}

/**
 * Downloads a core JS or WASM file with a streaming reader, resetting a stall timer
 * whenever bytes arrive and enforcing an overall limit + content validation.
 */
export async function downloadValidatedCoreFile(params: {
  url: string;
  sourceLabel: 'Local' | 'CDN';
  kind: 'js' | 'wasm';
  fetchFn: typeof fetch;
  callerSignal?: AbortSignal;
  stallTimeoutMs?: number;
  overallDeadlineAt?: number;
  onByteProgress?: (received: number, total: number) => void;
}): Promise<Uint8Array> {
  const {
    url,
    sourceLabel,
    kind,
    fetchFn,
    callerSignal,
    stallTimeoutMs = FFMPEG_STALL_TIMEOUT_MS,
    overallDeadlineAt,
    onByteProgress,
  } = params;

  const fileLabel = kind === 'wasm' ? 'ffmpeg-core.wasm' : 'ffmpeg-core.js';
  const attemptController = new AbortController();
  const onCallerAbort = () => attemptController.abort();

  if (callerSignal) {
    if (callerSignal.aborted) {
      throw new DOMException('Operation cancelled.', 'AbortError');
    }
    callerSignal.addEventListener('abort', onCallerAbort, { once: true });
  }

  let received = 0;
  let totalBytes = -1;

  const runStep = async <R>(promise: Promise<R>, phase: 'connect' | 'read'): Promise<R> => {
    const { stepMs, isOverallLimit } = computeNextStepBudget(stallTimeoutMs, overallDeadlineAt);
    if (stepMs <= 0 && isOverallLimit) {
      attemptController.abort();
      throw new CoreDownloadError(
        `${sourceLabel} ${fileLabel} exceeded the 5-minute overall limit after ${formatArrivedProgress(received, totalBytes)} arrived`,
        { receivedBytes: received, totalBytes, retryable: false }
      );
    }

    return awaitWithStepTimeout(promise, {
      callerSignal,
      stepTimeoutMs: stepMs,
      onTimeout: () => {
        attemptController.abort();
        if (isOverallLimit) {
          return new CoreDownloadError(
            `${sourceLabel} ${fileLabel} exceeded the 5-minute overall limit after ${formatArrivedProgress(received, totalBytes)} arrived`,
            { receivedBytes: received, totalBytes, retryable: false }
          );
        }
        const secs = Math.max(1, Math.round(stallTimeoutMs / 1000));
        const reason =
          phase === 'connect'
            ? `timed out waiting for server response (${secs}s with no data)`
            : `stalled for ${secs}s with no data`;
        return new CoreDownloadError(
          `${sourceLabel} ${fileLabel} ${reason} after ${formatArrivedProgress(received, totalBytes)} arrived`,
          { receivedBytes: received, totalBytes, retryable: true }
        );
      },
    });
  };

  try {
    let resp: Response;
    try {
      resp = await runStep(fetchFn(url, { signal: attemptController.signal }), 'connect');
    } catch (err) {
      if (isAbortError(err, callerSignal)) {
        throw new DOMException('Operation cancelled.', 'AbortError');
      }
      if (err instanceof CoreDownloadError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      throw new CoreDownloadError(
        `${sourceLabel} ${fileLabel} network error after 0 MB arrived: ${msg}`,
        { receivedBytes: 0, totalBytes: -1, retryable: true }
      );
    }

    if (!resp.ok) {
      throw new CoreDownloadError(
        `${sourceLabel} ${fileLabel} returned HTTP ${resp.status} (0 MB arrived)`,
        {
          receivedBytes: 0,
          totalBytes: -1,
          retryable: resp.status >= 500 || resp.status === 408 || resp.status === 429,
        }
      );
    }

    const contentType = resp.headers.get('content-type');
    if (isHtmlContentType(contentType)) {
      throw new CoreDownloadError(
        `${sourceLabel} ${fileLabel} returned HTML (${contentType}; 0 MB arrived)`,
        { receivedBytes: 0, totalBytes: -1, retryable: false }
      );
    }

    const rawLength = resp.headers.get('content-length');
    const declaredTotal = rawLength ? Number.parseInt(rawLength, 10) : -1;
    totalBytes = Number.isFinite(declaredTotal) && declaredTotal > 0 ? declaredTotal : -1;

    if (kind === 'wasm' && totalBytes > 0 && totalBytes <= MIN_FFMPEG_WASM_BYTES) {
      throw new CoreDownloadError(
        `${sourceLabel} ${fileLabel} is too small (${formatMbLabel(totalBytes)} declared; expected > 20 MB, 0 MB arrived)`,
        { receivedBytes: 0, totalBytes, retryable: false }
      );
    }

    let bytes: Uint8Array;
    const reader = resp.body?.getReader();
    if (reader) {
      const chunks: Uint8Array[] = [];
      try {
        for (;;) {
          throwIfAborted(callerSignal);
          let readResult: ReadableStreamReadResult<Uint8Array>;
          try {
            readResult = await runStep(reader.read(), 'read');
          } catch (readErr) {
            if (isAbortError(readErr, callerSignal)) {
              throw new DOMException('Operation cancelled.', 'AbortError');
            }
            if (readErr instanceof CoreDownloadError) throw readErr;
            const msg = readErr instanceof Error ? readErr.message : String(readErr);
            throw new CoreDownloadError(
              `${sourceLabel} ${fileLabel} network error after ${formatArrivedProgress(received, totalBytes)}: ${msg}`,
              { receivedBytes: received, totalBytes, retryable: true }
            );
          }

          if (readResult.done) break;
          const chunk = readResult.value;
          if (chunk && chunk.byteLength > 0) {
            chunks.push(chunk);
            received += chunk.byteLength;
            onByteProgress?.(received, totalBytes);
          }
        }
      } finally {
        try {
          reader.releaseLock();
        } catch {
          // Ignore lock release errors
        }
      }

      bytes = new Uint8Array(received);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
    } else {
      let buf: ArrayBuffer;
      try {
        buf = await runStep(resp.arrayBuffer(), 'read');
      } catch (bufErr) {
        if (isAbortError(bufErr, callerSignal)) {
          throw new DOMException('Operation cancelled.', 'AbortError');
        }
        if (bufErr instanceof CoreDownloadError) throw bufErr;
        const msg = bufErr instanceof Error ? bufErr.message : String(bufErr);
        throw new CoreDownloadError(
          `${sourceLabel} ${fileLabel} network error after ${formatArrivedProgress(received, totalBytes)}: ${msg}`,
          { receivedBytes: received, totalBytes, retryable: true }
        );
      }
      bytes = new Uint8Array(buf);
      received = bytes.byteLength;
      onByteProgress?.(received, totalBytes > 0 ? totalBytes : received);
    }

    if (bytes.byteLength === 0) {
      throw new CoreDownloadError(
        `${sourceLabel} ${fileLabel} returned an empty file (0 MB arrived)`,
        { receivedBytes: 0, totalBytes, retryable: true }
      );
    }

    if (looksLikeHtmlBytes(bytes)) {
      throw new CoreDownloadError(
        `${sourceLabel} ${fileLabel} returned HTML instead of a valid ${kind} file (${formatMbLabel(bytes.byteLength)} arrived)`,
        { receivedBytes: bytes.byteLength, totalBytes, retryable: false }
      );
    }

    if (totalBytes > 0 && bytes.byteLength !== totalBytes) {
      throw new CoreDownloadError(
        `${sourceLabel} ${fileLabel} size mismatch: ${formatArrivedProgress(bytes.byteLength, totalBytes)} arrived`,
        { receivedBytes: bytes.byteLength, totalBytes, retryable: true }
      );
    }

    if (kind === 'wasm' && bytes.byteLength <= MIN_FFMPEG_WASM_BYTES) {
      throw new CoreDownloadError(
        `${sourceLabel} ${fileLabel} is too small (${formatMbLabel(bytes.byteLength)} arrived; must be larger than 20 MB)`,
        { receivedBytes: bytes.byteLength, totalBytes, retryable: false }
      );
    }

    return bytes;
  } finally {
    attemptController.abort();
    if (callerSignal) {
      callerSignal.removeEventListener('abort', onCallerAbort);
    }
  }
}

function getDefaultCacheStorage(): CacheStorageLike | null {
  try {
    return typeof globalThis !== 'undefined' && 'caches' in globalThis && globalThis.caches
      ? (globalThis.caches as unknown as CacheStorageLike)
      : null;
  } catch {
    return null;
  }
}

async function readCachedCoreBytes(
  cacheStorage: CacheStorageLike | null
): Promise<{ jsBytes: Uint8Array; wasmBytes: Uint8Array } | null> {
  if (!cacheStorage) return null;
  try {
    const cache = await cacheStorage.open(FFMPEG_CACHE_NAME);
    const [jsResp, wasmResp] = await Promise.all([
      cache.match(getFfmpegCoreCacheKey('ffmpeg-core.js')),
      cache.match(getFfmpegCoreCacheKey('ffmpeg-core.wasm')),
    ]);
    if (!jsResp || !wasmResp) return null;

    const jsBuf = await jsResp.arrayBuffer();
    const wasmBuf = await wasmResp.arrayBuffer();
    const jsBytes = new Uint8Array(jsBuf);
    const wasmBytes = new Uint8Array(wasmBuf);

    if (jsBytes.byteLength === 0 || looksLikeHtmlBytes(jsBytes)) return null;
    if (wasmBytes.byteLength <= MIN_FFMPEG_WASM_BYTES || looksLikeHtmlBytes(wasmBytes)) {
      return null;
    }

    const jsLenHeader = jsResp.headers?.get('content-length');
    if (jsLenHeader) {
      const expectedJs = Number.parseInt(jsLenHeader, 10);
      if (Number.isFinite(expectedJs) && expectedJs > 0 && jsBytes.byteLength !== expectedJs) {
        return null;
      }
    }
    const wasmLenHeader = wasmResp.headers?.get('content-length');
    if (wasmLenHeader) {
      const expectedWasm = Number.parseInt(wasmLenHeader, 10);
      if (
        Number.isFinite(expectedWasm) &&
        expectedWasm > 0 &&
        wasmBytes.byteLength !== expectedWasm
      ) {
        return null;
      }
    }

    return { jsBytes, wasmBytes };
  } catch {
    return null;
  }
}

async function storeCachedCoreBytes(
  cacheStorage: CacheStorageLike | null,
  jsBytes: Uint8Array,
  wasmBytes: Uint8Array
): Promise<void> {
  if (!cacheStorage) return;
  try {
    const cache = await cacheStorage.open(FFMPEG_CACHE_NAME);
    await Promise.all([
      cache.put(
        getFfmpegCoreCacheKey('ffmpeg-core.js'),
        new Response(new Uint8Array(jsBytes), {
          headers: {
            'content-type': 'text/javascript',
            'content-length': String(jsBytes.byteLength),
          },
        })
      ),
      cache.put(
        getFfmpegCoreCacheKey('ffmpeg-core.wasm'),
        new Response(new Uint8Array(wasmBytes), {
          headers: {
            'content-type': 'application/wasm',
            'content-length': String(wasmBytes.byteLength),
          },
        })
      ),
    ]);
  } catch {
    // Cache Storage may be unavailable or full (e.g., private browsing); ignore silently.
  }
}

export async function clearCachedFfmpegCore(
  cacheStorage: CacheStorageLike | null = getDefaultCacheStorage()
): Promise<boolean> {
  if (!cacheStorage) return false;
  try {
    return await cacheStorage.delete(FFMPEG_CACHE_NAME);
  } catch {
    return false;
  }
}

export interface FfmpegInstanceLike {
  loaded: boolean;
  load: (
    config: { coreURL?: string; wasmURL?: string },
    options?: { signal?: AbortSignal }
  ) => Promise<boolean>;
  terminate: () => void;
}

export interface FfmpegCoreLoaderDeps<T extends FfmpegInstanceLike = FFmpeg> {
  fetchFn?: typeof fetch;
  createFfmpeg?: () => T;
  cacheStorage?: CacheStorageLike | null;
  stallTimeoutMs?: number;
  overallTimeoutMs?: number;
  localBaseUrl?: string;
  cdnBaseUrl?: string;
}

export interface CoreLoadSessionState<T extends FfmpegInstanceLike = FFmpeg> {
  instance: T | null;
  loadPromise: Promise<T> | null;
  coreURL: string | null;
  wasmURL: string | null;
}

export function createCoreLoadSessionState<
  T extends FfmpegInstanceLike = FFmpeg,
>(): CoreLoadSessionState<T> {
  return {
    instance: null,
    loadPromise: null,
    coreURL: null,
    wasmURL: null,
  };
}

export function revokeSessionBlobUrls<T extends FfmpegInstanceLike>(
  state: CoreLoadSessionState<T>
): void {
  if (state.coreURL) {
    URL.revokeObjectURL(state.coreURL);
    state.coreURL = null;
  }
  if (state.wasmURL) {
    URL.revokeObjectURL(state.wasmURL);
    state.wasmURL = null;
  }
}

export function resetCoreLoadSession<T extends FfmpegInstanceLike>(
  state: CoreLoadSessionState<T>
): void {
  if (state.instance) {
    try {
      state.instance.terminate();
    } catch {
      // Ignore worker termination errors
    }
  }
  state.instance = null;
  state.loadPromise = null;
  revokeSessionBlobUrls(state);
}

async function initializeInstanceFromBytes<T extends FfmpegInstanceLike>(params: {
  state: CoreLoadSessionState<T>;
  createFfmpeg: () => T;
  jsBytes: Uint8Array;
  wasmBytes: Uint8Array;
  callerSignal?: AbortSignal;
  onProgress?: (progress: RenderProgress) => void;
  esmFallbackDownload?: () => Promise<Uint8Array>;
}): Promise<{ instance: T; jsBytesUsed: Uint8Array }> {
  const {
    state,
    createFfmpeg,
    jsBytes,
    wasmBytes,
    callerSignal,
    onProgress,
    esmFallbackDownload,
  } = params;

  throwIfAborted(callerSignal);

  let coreUrl: string | null = URL.createObjectURL(
    new Blob([new Uint8Array(jsBytes)], { type: 'text/javascript' })
  );
  const wasmUrl: string | null = URL.createObjectURL(
    new Blob([new Uint8Array(wasmBytes)], { type: 'application/wasm' })
  );
  let activeInstance: T | null = null;
  let jsBytesUsed = jsBytes;

  try {
    onProgress?.({
      phase: 'loading',
      progress: 0.96,
      statusText: 'Initializing ffmpeg core...',
    });

    let created = createFfmpeg();
    activeInstance = created;

    try {
      await created.load({ coreURL: coreUrl, wasmURL: wasmUrl }, { signal: callerSignal });
    } catch (loadErr) {
      const msg = loadErr instanceof Error ? loadErr.message : String(loadErr);
      if (
        !callerSignal?.aborted &&
        esmFallbackDownload &&
        msg.toLowerCase().includes('failed to import')
      ) {
        try {
          created.terminate();
        } catch {
          // Ignore cleanup errors
        }
        const esmJsBytes = await esmFallbackDownload();
        throwIfAborted(callerSignal);
        const esmCoreUrl = URL.createObjectURL(
          new Blob([new Uint8Array(esmJsBytes)], { type: 'text/javascript' })
        );
        URL.revokeObjectURL(coreUrl);
        coreUrl = esmCoreUrl;
        jsBytesUsed = esmJsBytes;

        created = createFfmpeg();
        activeInstance = created;
        await created.load({ coreURL: coreUrl, wasmURL: wasmUrl }, { signal: callerSignal });
      } else {
        throw loadErr;
      }
    }

    state.coreURL = coreUrl;
    state.wasmURL = wasmUrl;
    state.instance = created;
    return { instance: created, jsBytesUsed };
  } catch (err) {
    if (activeInstance) {
      try {
        activeInstance.terminate();
      } catch {
        // Ignore cleanup errors
      }
    }
    if (coreUrl) URL.revokeObjectURL(coreUrl);
    if (wasmUrl) URL.revokeObjectURL(wasmUrl);
    throw err;
  }
}

async function loadFromSource<T extends FfmpegInstanceLike>(params: {
  state: CoreLoadSessionState<T>;
  sourceLabel: 'Local' | 'CDN';
  baseUrl: string;
  createFfmpeg: () => T;
  fetchFn: typeof fetch;
  cacheStorage: CacheStorageLike | null;
  stallTimeoutMs: number;
  overallDeadlineAt: number;
  callerSignal?: AbortSignal;
  onProgress?: (progress: RenderProgress) => void;
  allowEsmFallback?: boolean;
}): Promise<T> {
  const {
    state,
    sourceLabel,
    baseUrl,
    createFfmpeg,
    fetchFn,
    cacheStorage,
    stallTimeoutMs,
    overallDeadlineAt,
    callerSignal,
    onProgress,
    allowEsmFallback = false,
  } = params;

  onProgress?.({
    phase: 'loading',
    progress: 0,
    statusText:
      sourceLabel === 'Local' ? 'Loading ffmpeg core...' : 'Downloading ffmpeg core...',
  });

  const jsBytes = await downloadValidatedCoreFile({
    url: `${baseUrl}/ffmpeg-core.js`,
    sourceLabel,
    kind: 'js',
    fetchFn,
    callerSignal,
    stallTimeoutMs,
    overallDeadlineAt,
  });

  const wasmBytes = await downloadValidatedCoreFile({
    url: `${baseUrl}/ffmpeg-core.wasm`,
    sourceLabel,
    kind: 'wasm',
    fetchFn,
    callerSignal,
    stallTimeoutMs,
    overallDeadlineAt,
    onByteProgress: (received, total) => {
      if (callerSignal?.aborted) return;
      const pct = total > 0 ? Math.min(0.95, Math.max(0, received / total)) : 0;
      onProgress?.({
        phase: 'loading',
        progress: pct,
        statusText: formatDownloadingCoreText(received, total),
      });
    },
  });

  const esmFallbackDownload =
    allowEsmFallback && baseUrl.includes('/umd')
      ? () =>
          downloadValidatedCoreFile({
            url: `${baseUrl.replace(/\/umd\/?$/, '/esm')}/ffmpeg-core.js`,
            sourceLabel,
            kind: 'js',
            fetchFn,
            callerSignal,
            stallTimeoutMs,
            overallDeadlineAt,
          })
      : undefined;

  const { instance, jsBytesUsed } = await initializeInstanceFromBytes({
    state,
    createFfmpeg,
    jsBytes,
    wasmBytes,
    callerSignal,
    onProgress,
    esmFallbackDownload,
  });

  await storeCachedCoreBytes(cacheStorage, jsBytesUsed, wasmBytes);
  return instance;
}

function hasOverallBudgetRemaining(overallDeadlineAt: number): boolean {
  return Date.now() < overallDeadlineAt;
}

export async function loadFfmpegCoreWithFallback<T extends FfmpegInstanceLike = FFmpeg>(
  state: CoreLoadSessionState<T>,
  options: {
    onProgress?: (progress: RenderProgress) => void;
    signal?: AbortSignal;
    deps?: FfmpegCoreLoaderDeps<T>;
  } = {}
): Promise<T> {
  const { onProgress, signal, deps = {} } = options;
  throwIfAborted(signal);

  if (state.instance && state.instance.loaded) {
    return state.instance;
  }

  const fetchFn = deps.fetchFn ?? fetch;
  const createFfmpeg: () => T = deps.createFfmpeg ?? (() => new FFmpeg() as unknown as T);
  const cacheStorage =
    deps.cacheStorage === undefined ? getDefaultCacheStorage() : deps.cacheStorage;
  const stallTimeoutMs = deps.stallTimeoutMs ?? FFMPEG_STALL_TIMEOUT_MS;
  const overallTimeoutMs = deps.overallTimeoutMs ?? FFMPEG_OVERALL_TIMEOUT_MS;
  const localBaseUrl = deps.localBaseUrl ?? FFMPEG_LOCAL_BASE_URL;
  const cdnBaseUrl = deps.cdnBaseUrl ?? FFMPEG_CDN_BASE_URL;

  let loadPromise = state.loadPromise;
  if (!loadPromise) {
    loadPromise = (async (): Promise<T> => {
      const overallDeadlineAt = Date.now() + overallTimeoutMs;

      // 1. Check Cache Storage first so the 32 MB core is downloaded only once per browser
      const cached = await readCachedCoreBytes(cacheStorage);
      if (cached) {
        throwIfAborted(signal);
        try {
          onProgress?.({
            phase: 'loading',
            progress: 0.96,
            statusText: 'Loading cached ffmpeg core...',
          });
          const { instance } = await initializeInstanceFromBytes({
            state,
            createFfmpeg,
            jsBytes: cached.jsBytes,
            wasmBytes: cached.wasmBytes,
            callerSignal: signal,
            onProgress,
          });
          return instance;
        } catch (cacheInitErr) {
          if (isAbortError(cacheInitErr, signal)) {
            throw new DOMException('Operation cancelled.', 'AbortError');
          }
          // Cached bytes failed to initialize; fall back to downloading
        }
      }

      // 2. Try local /ffmpeg core (auto-retry once on transient download failure)
      let localFailureReason: string | null = null;
      let localAttempts = 0;
      while (localAttempts < 2) {
        localAttempts += 1;
        try {
          return await loadFromSource<T>({
            state,
            sourceLabel: 'Local',
            baseUrl: localBaseUrl,
            createFfmpeg,
            fetchFn,
            cacheStorage,
            stallTimeoutMs,
            overallDeadlineAt,
            callerSignal: signal,
            onProgress,
          });
        } catch (localErr) {
          if (isAbortError(localErr, signal)) {
            throw new DOMException('Operation cancelled.', 'AbortError');
          }
          localFailureReason =
            localErr instanceof Error ? localErr.message : 'Local ffmpeg core failed to load.';
          const shouldRetryLocal =
            localAttempts === 1 &&
            localErr instanceof CoreDownloadError &&
            localErr.retryable &&
            hasOverallBudgetRemaining(overallDeadlineAt);
          if (!shouldRetryLocal) {
            break;
          }
        }
      }

      // 3. Fall back to jsDelivr CDN (with 1 automatic retry on download failure)
      let cdnFailureReason = 'CDN download failed (0 MB arrived)';
      let cdnAttempts = 0;
      while (cdnAttempts < 2) {
        cdnAttempts += 1;
        if (!hasOverallBudgetRemaining(overallDeadlineAt)) {
          break;
        }
        try {
          return await loadFromSource<T>({
            state,
            sourceLabel: 'CDN',
            baseUrl: cdnBaseUrl,
            createFfmpeg,
            fetchFn,
            cacheStorage,
            stallTimeoutMs,
            overallDeadlineAt,
            callerSignal: signal,
            onProgress,
            allowEsmFallback: true,
          });
        } catch (cdnErr) {
          if (isAbortError(cdnErr, signal)) {
            throw new DOMException('Operation cancelled.', 'AbortError');
          }
          cdnFailureReason =
            cdnErr instanceof Error ? cdnErr.message : 'CDN download failed (0 MB arrived).';
          const canRetryCdn = cdnAttempts === 1 && hasOverallBudgetRemaining(overallDeadlineAt);
          if (!canRetryCdn) {
            break;
          }
        }
      }

      throw new FfmpegCoreLoadError(
        `Failed to load ffmpeg core (${localFailureReason}; CDN fallback failed: ${cdnFailureReason}). Please check your connection and click Retry.`
      );
    })().catch((err) => {
      resetCoreLoadSession(state);
      throw err;
    });
    state.loadPromise = loadPromise;
  }

  return awaitWithStepTimeout(loadPromise, {
    callerSignal: signal,
    stepTimeoutMs: Number.POSITIVE_INFINITY,
    onTimeout: () => new Error('Unexpected timeout'),
  }).catch((err) => {
    if (isAbortError(err, signal)) {
      resetCoreLoadSession(state);
      throw new DOMException('Operation cancelled.', 'AbortError');
    }
    throw err;
  });
}
