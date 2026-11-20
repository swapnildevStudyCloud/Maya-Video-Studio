import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';
import { buildFfmpegArgs } from './ffmpegArgs';
import { sanitizeExportFilename } from './fileValidation';
import {
  INTERNAL_INPUT_FILENAME,
  INTERNAL_OUTPUT_FILENAME,
  type ExportMode,
  type RenderProgress,
  type RenderResult,
} from './types';

let ffmpegInstance: FFmpeg | null = null;
let loadPromise: Promise<FFmpeg> | null = null;
let loadedCoreURL: string | null = null;
let loadedWasmURL: string | null = null;

function revokeCoreBlobUrls(): void {
  if (loadedCoreURL) {
    URL.revokeObjectURL(loadedCoreURL);
    loadedCoreURL = null;
  }
  if (loadedWasmURL) {
    URL.revokeObjectURL(loadedWasmURL);
    loadedWasmURL = null;
  }
}

async function getLoadedFfmpeg(
  onProgress?: (progress: RenderProgress) => void,
  signal?: AbortSignal
): Promise<FFmpeg> {
  if (signal?.aborted) {
    throw new DOMException('Export cancelled.', 'AbortError');
  }

  if (ffmpegInstance && ffmpegInstance.loaded) {
    return ffmpegInstance;
  }

  if (!loadPromise) {
    loadPromise = (async () => {
      onProgress?.({ phase: 'loading', progress: 0 });
      const instance = new FFmpeg();

      // Load single-threaded core from local static assets so no SharedArrayBuffer
      // or COOP/COEP headers are required and nothing calls external CDNs.
      const coreURL = await toBlobURL('/ffmpeg/ffmpeg-core.js', 'text/javascript');
      const wasmURL = await toBlobURL('/ffmpeg/ffmpeg-core.wasm', 'application/wasm');
      loadedCoreURL = coreURL;
      loadedWasmURL = wasmURL;

      if (signal?.aborted) {
        instance.terminate();
        revokeCoreBlobUrls();
        throw new DOMException('Export cancelled.', 'AbortError');
      }

      await instance.load({ coreURL, wasmURL }, { signal });
      ffmpegInstance = instance;
      return instance;
    })().catch((err) => {
      loadPromise = null;
      ffmpegInstance = null;
      revokeCoreBlobUrls();
      throw err;
    });
  }

  return loadPromise;
}

function resetFfmpegWorker(): void {
  if (ffmpegInstance) {
    try {
      ffmpegInstance.terminate();
    } catch {
      // Ignore worker termination errors
    }
  }
  ffmpegInstance = null;
  loadPromise = null;
  revokeCoreBlobUrls();
}

function toFriendlyRenderError(err: unknown, mode: ExportMode): Error {
  if (err instanceof DOMException && err.name === 'AbortError') {
    return err;
  }

  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();

  if (
    lower.includes('out of memory') ||
    lower.includes('oom') ||
    lower.includes('cannot enlarge memory') ||
    lower.includes('memory access out of bounds') ||
    lower.includes('aborted')
  ) {
    const modeHint =
      mode === 'precise'
        ? 'Try switching to Fast mode or using a smaller video file.'
        : 'Try closing other browser tabs or using a smaller video file.';
    return new Error(`The browser ran out of memory while processing this video. ${modeHint}`);
  }

  const fallbackHint =
    mode === 'precise'
      ? 'Try switching to Fast mode or using a smaller file.'
      : 'Please check that the video has standard H.264/AAC streams, or try a smaller file.';

  return new Error(`Video export failed. ${fallbackHint}`);
}

export async function renderTrimmedVideo(params: {
  file: File;
  start: number;
  end: number;
  duration: number;
  mode: ExportMode;
  signal?: AbortSignal;
  onProgress?: (progress: RenderProgress) => void;
}): Promise<RenderResult> {
  const { file, start, end, duration, mode, signal, onProgress } = params;

  // Validate trim bounds and build deterministic args before loading ffmpeg.
  const args = buildFfmpegArgs({ start, end, duration, mode });
  const clipDuration = end - start;

  let ffmpeg: FFmpeg | null = null;
  const recentLogs: string[] = [];

  const handleAbort = () => {
    resetFfmpegWorker();
  };

  if (signal) {
    if (signal.aborted) {
      throw new DOMException('Export cancelled.', 'AbortError');
    }
    signal.addEventListener('abort', handleAbort, { once: true });
  }

  const handleProgress = ({ progress, time }: { progress: number; time: number }) => {
    const timeSeconds = Number.isFinite(time) && time >= 0 ? time / 1_000_000 : undefined;
    let normalized = 0;

    if (timeSeconds !== undefined && timeSeconds > 0 && clipDuration > 0) {
      normalized = Math.min(0.99, Math.max(0, timeSeconds / clipDuration));
    } else if (Number.isFinite(progress) && progress >= 0 && progress <= 1) {
      normalized = progress;
    }

    onProgress?.({
      phase: 'processing',
      progress: Math.min(1, Math.max(0, normalized)),
      timeSeconds,
    });
  };

  const handleLog = ({ message }: { message: string }) => {
    if (recentLogs.length > 30) {
      recentLogs.shift();
    }
    recentLogs.push(message);
  };

  try {
    ffmpeg = await getLoadedFfmpeg(onProgress, signal);

    if (signal?.aborted) {
      throw new DOMException('Export cancelled.', 'AbortError');
    }

    ffmpeg.on('progress', handleProgress);
    ffmpeg.on('log', handleLog);

    onProgress?.({ phase: 'preparing', progress: 0 });
    const fileBytes = new Uint8Array(await file.arrayBuffer());

    if (signal?.aborted) {
      throw new DOMException('Export cancelled.', 'AbortError');
    }

    await ffmpeg.writeFile(INTERNAL_INPUT_FILENAME, fileBytes, { signal });

    onProgress?.({ phase: 'processing', progress: 0 });
    const exitCode = await ffmpeg.exec(args, -1, { signal });

    if (signal?.aborted) {
      throw new DOMException('Export cancelled.', 'AbortError');
    }

    if (exitCode !== 0) {
      const logTail = recentLogs.join(' ').toLowerCase();
      if (logTail.includes('memory') || logTail.includes('oom')) {
        throw new Error('Out of memory during ffmpeg execution.');
      }
      throw new Error(`ffmpeg exited with code ${exitCode}`);
    }

    onProgress?.({ phase: 'finalizing', progress: 1 });
    const outputData = await ffmpeg.readFile(INTERNAL_OUTPUT_FILENAME, 'binary', { signal });

    if (!(outputData instanceof Uint8Array) || outputData.byteLength === 0) {
      throw new Error('Export produced an empty output file.');
    }

    // Copy into a standalone ArrayBuffer so the Blob is decoupled from WASM memory.
    const outputCopy = new Uint8Array(outputData.byteLength);
    outputCopy.set(outputData);
    const blob = new Blob([outputCopy.buffer], { type: 'video/mp4' });

    return {
      blob,
      size: blob.size,
      duration: clipDuration,
      mode,
      suggestedFilename: sanitizeExportFilename(file.name),
    };
  } catch (err) {
    if (signal?.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
      resetFfmpegWorker();
      throw new DOMException('Export cancelled.', 'AbortError');
    }
    const rawMsg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
    if (rawMsg.includes('memory') || rawMsg.includes('terminated') || rawMsg.includes('abort')) {
      resetFfmpegWorker();
    }
    throw toFriendlyRenderError(err, mode);
  } finally {
    if (signal) {
      signal.removeEventListener('abort', handleAbort);
    }
    if (ffmpeg && ffmpeg.loaded) {
      ffmpeg.off('progress', handleProgress);
      ffmpeg.off('log', handleLog);
      try {
        await ffmpeg.deleteFile(INTERNAL_INPUT_FILENAME);
      } catch {
        // Ignore cleanup failure
      }
      try {
        await ffmpeg.deleteFile(INTERNAL_OUTPUT_FILENAME);
      } catch {
        // Ignore cleanup failure
      }
    }
  }
}
