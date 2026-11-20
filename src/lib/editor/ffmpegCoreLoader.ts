import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';
import type { RenderProgress } from './types';

// Exact version matching installed @ffmpeg/core@0.12.10 (for @ffmpeg/ffmpeg@0.12.x)
export const FFMPEG_CORE_VERSION = '0.12.10';
export const FFMPEG_LOCAL_BASE_URL = '/ffmpeg';
export const FFMPEG_CDN_BASE_URL = `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${FFMPEG_CORE_VERSION}/dist/umd`;

export const FFMPEG_LOAD_TIMEOUT_MS = 45_000;
export const MIN_FFMPEG_WASM_BYTES = 20 * 1024 * 1024; // 20 MB

export class FfmpegCoreLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FfmpegCoreLoadError';
  }
}

class LocalSourceTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Local ffmpeg core timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
    this.name = 'LocalSourceTimeoutError';
  }
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

async function raceWithSignalAndTimeout<T>(
  promise: Promise<T>,
  options: {
    signal?: AbortSignal;
    timeoutMs: number;
    timeoutErrorFactory: () => Error;
  }
): Promise<T> {
  const { signal, timeoutMs, timeoutErrorFactory } = options;
  throwIfAborted(signal);

  return new Promise<T>((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      if (timerId !== undefined) {
        clearTimeout(timerId);
      }
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
    };

    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new DOMException('Operation cancelled.', 'AbortError'));
    };

    const timerId =
      timeoutMs > 0
        ? setTimeout(() => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(timeoutErrorFactory());
          }, timeoutMs)
        : undefined;

    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }

    promise.then(
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

async function fetchValidatedLocalBytes(params: {
  url: string;
  kind: 'js' | 'wasm';
  fetchFn: typeof fetch;
  signal: AbortSignal;
  onByteProgress?: (received: number, total: number) => void;
}): Promise<Uint8Array> {
  const { url, kind, fetchFn, signal, onByteProgress } = params;
  const resp = await fetchFn(url, { signal });

  if (!resp.ok) {
    throw new Error(`Local ${url} returned HTTP ${resp.status}.`);
  }

  const contentType = resp.headers.get('content-type');
  if (isHtmlContentType(contentType)) {
    throw new Error(`Local ${url} returned HTML (${contentType}).`);
  }

  const rawLength = resp.headers.get('content-length');
  const declaredTotal = rawLength ? Number.parseInt(rawLength, 10) : -1;
  const totalBytes = Number.isFinite(declaredTotal) && declaredTotal > 0 ? declaredTotal : -1;

  if (kind === 'wasm' && totalBytes > 0 && totalBytes <= MIN_FFMPEG_WASM_BYTES) {
    throw new Error(
      `Local ${url} is too small (${totalBytes} bytes; expected > 20 MB).`
    );
  }

  let bytes: Uint8Array;
  const reader = resp.body?.getReader();
  if (reader) {
    const chunks: Uint8Array[] = [];
    let received = 0;
    try {
      for (;;) {
        if (signal.aborted) {
          throw new DOMException('Operation cancelled.', 'AbortError');
        }
        const { done, value } = await reader.read();
        if (done) break;
        if (value && value.byteLength > 0) {
          chunks.push(value);
          received += value.byteLength;
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
    const buf = await resp.arrayBuffer();
    bytes = new Uint8Array(buf);
    onByteProgress?.(bytes.byteLength, totalBytes > 0 ? totalBytes : bytes.byteLength);
  }

  if (bytes.byteLength === 0 || looksLikeHtmlBytes(bytes)) {
    throw new Error(`Local ${url} appears to be HTML or empty instead of a valid ${kind} file.`);
  }

  if (kind === 'wasm' && bytes.byteLength <= MIN_FFMPEG_WASM_BYTES) {
    throw new Error(
      `Local ${url} is only ${bytes.byteLength} bytes (must be larger than 20 MB).`
    );
  }

  return bytes;
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
  toBlobUrlFn?: typeof toBlobURL;
  createFfmpeg?: () => T;
  timeoutMs?: number;
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

async function tryLoadFromLocal<T extends FfmpegInstanceLike>(params: {
  state: CoreLoadSessionState<T>;
  createFfmpeg: () => T;
  fetchFn: typeof fetch;
  localBaseUrl: string;
  timeoutMs: number;
  callerSignal?: AbortSignal;
  onProgress?: (progress: RenderProgress) => void;
}): Promise<T> {
  const {
    state,
    createFfmpeg,
    fetchFn,
    localBaseUrl,
    timeoutMs,
    callerSignal,
    onProgress,
  } = params;

  const localController = new AbortController();
  const onCallerAbort = () => localController.abort();
  if (callerSignal) {
    if (callerSignal.aborted) {
      throw new DOMException('Operation cancelled.', 'AbortError');
    }
    callerSignal.addEventListener('abort', onCallerAbort, { once: true });
  }

  let localCoreUrl: string | null = null;
  let localWasmUrl: string | null = null;
  let activeInstance: T | null = null;

  const attempt = (async (): Promise<T> => {
    onProgress?.({
      phase: 'loading',
      progress: 0,
      statusText: 'Loading ffmpeg core...',
    });

    const jsBytes = await fetchValidatedLocalBytes({
      url: `${localBaseUrl}/ffmpeg-core.js`,
      kind: 'js',
      fetchFn,
      signal: localController.signal,
    });

    const wasmBytes = await fetchValidatedLocalBytes({
      url: `${localBaseUrl}/ffmpeg-core.wasm`,
      kind: 'wasm',
      fetchFn,
      signal: localController.signal,
      onByteProgress: (received, total) => {
        const pct = total > 0 ? Math.min(0.95, Math.max(0, received / total)) : 0;
        onProgress?.({
          phase: 'loading',
          progress: pct,
          statusText: formatDownloadingCoreText(received, total),
        });
      },
    });

    throwIfAborted(callerSignal);

    localCoreUrl = URL.createObjectURL(
      new Blob([new Uint8Array(jsBytes)], { type: 'text/javascript' })
    );
    localWasmUrl = URL.createObjectURL(
      new Blob([new Uint8Array(wasmBytes)], { type: 'application/wasm' })
    );

    onProgress?.({
      phase: 'loading',
      progress: 0.96,
      statusText: 'Initializing ffmpeg core...',
    });

    const created = createFfmpeg();
    activeInstance = created;
    await created.load(
      { coreURL: localCoreUrl, wasmURL: localWasmUrl },
      { signal: localController.signal }
    );

    state.coreURL = localCoreUrl;
    state.wasmURL = localWasmUrl;
    state.instance = created;
    return created;
  })();

  try {
    return await raceWithSignalAndTimeout(attempt, {
      signal: callerSignal,
      timeoutMs,
      timeoutErrorFactory: () => {
        localController.abort();
        return new LocalSourceTimeoutError(timeoutMs);
      },
    });
  } catch (err) {
    localController.abort();
    const instanceToTerminate = activeInstance as T | null;
    if (instanceToTerminate) {
      try {
        instanceToTerminate.terminate();
      } catch {
        // Ignore cleanup errors
      }
    }
    if (localCoreUrl) URL.revokeObjectURL(localCoreUrl);
    if (localWasmUrl) URL.revokeObjectURL(localWasmUrl);
    throw err;
  } finally {
    if (callerSignal) {
      callerSignal.removeEventListener('abort', onCallerAbort);
    }
  }
}

async function loadFromJsDelivrCdn<T extends FfmpegInstanceLike>(params: {
  state: CoreLoadSessionState<T>;
  createFfmpeg: () => T;
  toBlobUrlFn: typeof toBlobURL;
  cdnBaseUrl: string;
  timeoutMs: number;
  callerSignal?: AbortSignal;
  onProgress?: (progress: RenderProgress) => void;
}): Promise<T> {
  const {
    state,
    createFfmpeg,
    toBlobUrlFn,
    cdnBaseUrl,
    timeoutMs,
    callerSignal,
    onProgress,
  } = params;

  const cdnController = new AbortController();
  const onCallerAbort = () => cdnController.abort();
  if (callerSignal) {
    if (callerSignal.aborted) {
      throw new DOMException('Operation cancelled.', 'AbortError');
    }
    callerSignal.addEventListener('abort', onCallerAbort, { once: true });
  }

  let cdnCoreUrl: string | null = null;
  let cdnWasmUrl: string | null = null;
  let activeInstance: T | null = null;

  const attempt = (async (): Promise<T> => {
    onProgress?.({
      phase: 'loading',
      progress: 0,
      statusText: 'Downloading ffmpeg core...',
    });

    cdnCoreUrl = await toBlobUrlFn(`${cdnBaseUrl}/ffmpeg-core.js`, 'text/javascript', false);
    throwIfAborted(callerSignal);

    cdnWasmUrl = await toBlobUrlFn(
      `${cdnBaseUrl}/ffmpeg-core.wasm`,
      'application/wasm',
      true,
      ({ received, total }) => {
        if (callerSignal?.aborted) return;
        const pct = total > 0 ? Math.min(0.95, Math.max(0, received / total)) : 0;
        onProgress?.({
          phase: 'loading',
          progress: pct,
          statusText: formatDownloadingCoreText(received, total),
        });
      }
    );
    throwIfAborted(callerSignal);

    onProgress?.({
      phase: 'loading',
      progress: 0.96,
      statusText: 'Initializing ffmpeg core...',
    });

    let created = createFfmpeg();
    activeInstance = created;
    try {
      await created.load(
        { coreURL: cdnCoreUrl, wasmURL: cdnWasmUrl },
        { signal: cdnController.signal }
      );
    } catch (loadErr) {
      const msg = loadErr instanceof Error ? loadErr.message : String(loadErr);
      if (
        !callerSignal?.aborted &&
        msg.toLowerCase().includes('failed to import') &&
        cdnBaseUrl.includes('/umd')
      ) {
        try {
          created.terminate();
        } catch {
          // Ignore cleanup errors
        }
        const esmCoreUrl = await toBlobUrlFn(
          `${cdnBaseUrl.replace(/\/umd\/?$/, '/esm')}/ffmpeg-core.js`,
          'text/javascript',
          false
        );
        if (cdnCoreUrl) URL.revokeObjectURL(cdnCoreUrl);
        cdnCoreUrl = esmCoreUrl;
        throwIfAborted(callerSignal);
        created = createFfmpeg();
        activeInstance = created;
        await created.load(
          { coreURL: cdnCoreUrl, wasmURL: cdnWasmUrl },
          { signal: cdnController.signal }
        );
      } else {
        throw loadErr;
      }
    }

    state.coreURL = cdnCoreUrl;
    state.wasmURL = cdnWasmUrl;
    state.instance = created;
    return created;
  })();

  try {
    return await raceWithSignalAndTimeout(attempt, {
      signal: callerSignal,
      timeoutMs,
      timeoutErrorFactory: () => {
        cdnController.abort();
        return new Error(
          `Downloading ffmpeg core from CDN timed out after ${Math.round(timeoutMs / 1000)} seconds.`
        );
      },
    });
  } catch (err) {
    cdnController.abort();
    const instanceToTerminate = activeInstance as T | null;
    if (instanceToTerminate) {
      try {
        instanceToTerminate.terminate();
      } catch {
        // Ignore cleanup errors
      }
    }
    if (cdnCoreUrl) URL.revokeObjectURL(cdnCoreUrl);
    if (cdnWasmUrl) URL.revokeObjectURL(cdnWasmUrl);
    throw err;
  } finally {
    if (callerSignal) {
      callerSignal.removeEventListener('abort', onCallerAbort);
    }
  }
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
  const toBlobUrlFn = deps.toBlobUrlFn ?? toBlobURL;
  const createFfmpeg: () => T = deps.createFfmpeg ?? (() => new FFmpeg() as unknown as T);
  const timeoutMs = deps.timeoutMs ?? FFMPEG_LOAD_TIMEOUT_MS;
  const localBaseUrl = deps.localBaseUrl ?? FFMPEG_LOCAL_BASE_URL;
  const cdnBaseUrl = deps.cdnBaseUrl ?? FFMPEG_CDN_BASE_URL;

  let loadPromise = state.loadPromise;
  if (!loadPromise) {
    loadPromise = (async (): Promise<T> => {
      let localFailureReason: string | null = null;
      try {
        return await tryLoadFromLocal<T>({
          state,
          createFfmpeg,
          fetchFn,
          localBaseUrl,
          timeoutMs,
          callerSignal: signal,
          onProgress,
        });
      } catch (localErr) {
        if (signal?.aborted || (localErr instanceof DOMException && localErr.name === 'AbortError')) {
          throw new DOMException('Operation cancelled.', 'AbortError');
        }
        localFailureReason =
          localErr instanceof Error ? localErr.message : 'Local ffmpeg core failed to load.';
      }

      try {
        return await loadFromJsDelivrCdn<T>({
          state,
          createFfmpeg,
          toBlobUrlFn,
          cdnBaseUrl,
          timeoutMs,
          callerSignal: signal,
          onProgress,
        });
      } catch (cdnErr) {
        if (signal?.aborted || (cdnErr instanceof DOMException && cdnErr.name === 'AbortError')) {
          throw new DOMException('Operation cancelled.', 'AbortError');
        }
        const cdnReason =
          cdnErr instanceof Error ? cdnErr.message : 'CDN download failed.';
        throw new FfmpegCoreLoadError(
          `Failed to load ffmpeg core (${localFailureReason}; CDN fallback failed: ${cdnReason}). Please check your connection and click Retry.`
        );
      }
    })().catch((err) => {
      resetCoreLoadSession(state);
      throw err;
    });
    state.loadPromise = loadPromise;
  }

  return raceWithSignalAndTimeout(loadPromise, {
    signal,
    timeoutMs: 0,
    timeoutErrorFactory: () => new Error('Unexpected timeout'),
  }).catch((err) => {
    if (signal?.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
      resetCoreLoadSession(state);
      throw new DOMException('Operation cancelled.', 'AbortError');
    }
    throw err;
  });
}
