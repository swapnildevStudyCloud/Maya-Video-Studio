import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';
import { buildExtractAudioArgs, buildToolsExportPlan } from './ffmpegArgs';
import { sanitizeExportFilename } from './fileValidation';
import { validateFontBytes } from './toolsValidation';
import {
  createDefaultEditTools,
  INTERNAL_AUDIO_FILENAME,
  INTERNAL_FONT_FILENAME,
  INTERNAL_INPUT_FILENAME,
  INTERNAL_OUTPUT_AUDIO_FILENAME,
  INTERNAL_OUTPUT_FILENAME,
  type EditToolsConfig,
  type ExportMode,
  type ExtractedAudioResult,
  type MediaAsset,
  type ProjectState,
  type RenderProgress,
  type RenderResult,
  type VideoSegment,
} from './types';

let ffmpegInstance: FFmpeg | null = null;
let loadPromise: Promise<FFmpeg> | null = null;
let loadedCoreURL: string | null = null;
let loadedWasmURL: string | null = null;
let cachedFontBytes: Uint8Array | null = null;

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
    throw new DOMException('Operation cancelled.', 'AbortError');
  }

  if (ffmpegInstance && ffmpegInstance.loaded) {
    return ffmpegInstance;
  }

  if (!loadPromise) {
    loadPromise = (async () => {
      onProgress?.({ phase: 'loading', progress: 0 });
      const instance = new FFmpeg();

      const coreURL = await toBlobURL('/ffmpeg/ffmpeg-core.js', 'text/javascript');
      const wasmURL = await toBlobURL('/ffmpeg/ffmpeg-core.wasm', 'application/wasm');
      loadedCoreURL = coreURL;
      loadedWasmURL = wasmURL;

      if (signal?.aborted) {
        instance.terminate();
        revokeCoreBlobUrls();
        throw new DOMException('Operation cancelled.', 'AbortError');
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

async function getBundledFontBytes(signal?: AbortSignal): Promise<Uint8Array> {
  if (cachedFontBytes) {
    validateFontBytes(cachedFontBytes);
    return new Uint8Array(cachedFontBytes);
  }
  const response = await fetch('/ffmpeg/font.ttf', { signal });
  if (!response.ok) {
    throw new Error('font file missing: public/ffmpeg/font.ttf could not be loaded.');
  }
  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  validateFontBytes(bytes);
  cachedFontBytes = bytes;
  return new Uint8Array(bytes);
}

/**
 * Probes a file in MEMFS to check whether it contains an audio stream.
 */
async function detectHasAudioStream(
  ffmpeg: FFmpeg,
  internalPath = INTERNAL_INPUT_FILENAME,
  signal?: AbortSignal
): Promise<boolean> {
  const probeLogs: string[] = [];
  const onLog = ({ message }: { message: string }) => {
    probeLogs.push(message);
  };
  ffmpeg.on('log', onLog);
  try {
    await ffmpeg.exec(['-i', internalPath], -1, { signal });
  } catch {
    // ffmpeg -i without output exits non-zero; stream info is in logs
  } finally {
    ffmpeg.off('log', onLog);
  }
  return probeLogs.some((line) => /Stream\s+#\d+:\d+.*Audio:/i.test(line));
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

function toFriendlyRenderError(
  err: unknown,
  mode: ExportMode,
  burningCaptions: boolean
): Error {
  if (err instanceof DOMException && err.name === 'AbortError') {
    return err;
  }

  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();

  if (lower.includes('font file missing')) {
    return new Error(raw);
  }

  if (lower.includes('no audio stream is available')) {
    return new Error(raw);
  }

  if (
    lower.includes('out of memory') ||
    lower.includes('oom') ||
    lower.includes('cannot enlarge memory') ||
    lower.includes('memory access out of bounds') ||
    lower.includes('aborted')
  ) {
    const modeHint =
      mode === 'precise'
        ? 'Try switching to Fast mode (with tools cleared), lowering export resolution, or using a smaller file.'
        : 'Try closing other browser tabs or using a smaller video file.';
    return new Error(`The browser ran out of memory while processing this video. ${modeHint}`);
  }

  if (burningCaptions) {
    return new Error(
      'Burning captions into the video failed in this browser ffmpeg build. You can still use "Download .srt" or uncheck "Burn captions into video" to export your video.'
    );
  }

  const fallbackHint =
    mode === 'precise'
      ? 'Try simplifying active tools or using a smaller file.'
      : 'Please check that the video has standard H.264/AAC streams, or try a smaller file.';

  return new Error(`Video export failed. ${fallbackHint}`);
}

export async function extractAudioFromTrimmedRange(params: {
  file: File;
  start: number;
  end: number;
  duration: number;
  signal?: AbortSignal;
  onProgress?: (progress: RenderProgress) => void;
}): Promise<ExtractedAudioResult> {
  const { file, start, end, duration, signal, onProgress } = params;
  const args = buildExtractAudioArgs({ start, end, duration });
  const clipDuration = end - start;

  let ffmpeg: FFmpeg | null = null;
  const recentLogs: string[] = [];

  const handleAbort = () => {
    resetFfmpegWorker();
  };

  if (signal) {
    if (signal.aborted) {
      throw new DOMException('Audio extraction cancelled.', 'AbortError');
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
    if (recentLogs.length > 30) recentLogs.shift();
    recentLogs.push(message);
  };

  try {
    ffmpeg = await getLoadedFfmpeg(onProgress, signal);
    if (signal?.aborted) {
      throw new DOMException('Audio extraction cancelled.', 'AbortError');
    }

    ffmpeg.on('progress', handleProgress);
    ffmpeg.on('log', handleLog);

    onProgress?.({ phase: 'preparing', progress: 0 });
    const fileBytes = new Uint8Array(await file.arrayBuffer());
    if (signal?.aborted) {
      throw new DOMException('Audio extraction cancelled.', 'AbortError');
    }

    await ffmpeg.writeFile(INTERNAL_INPUT_FILENAME, fileBytes, { signal });

    onProgress?.({ phase: 'processing', progress: 0 });
    const exitCode = await ffmpeg.exec(args, -1, { signal });

    if (signal?.aborted) {
      throw new DOMException('Audio extraction cancelled.', 'AbortError');
    }

    if (exitCode !== 0) {
      const logTail = recentLogs.join(' ').toLowerCase();
      if (
        logTail.includes('does not contain any stream') ||
        logTail.includes('no audio') ||
        logTail.includes('output file #0 does not contain')
      ) {
        throw new Error('This video does not appear to contain an audio track to transcribe.');
      }
      throw new Error('Could not extract audio from this video clip.');
    }

    onProgress?.({ phase: 'finalizing', progress: 1 });
    const outputData = await ffmpeg.readFile(INTERNAL_AUDIO_FILENAME, 'binary', { signal });

    if (!(outputData instanceof Uint8Array) || outputData.byteLength === 0) {
      throw new Error('This video does not contain a readable audio track.');
    }

    const audioCopy = new Uint8Array(outputData.byteLength);
    audioCopy.set(outputData);

    return {
      bytes: audioCopy,
      mimeType: 'audio/mp3',
      duration: clipDuration,
    };
  } catch (err) {
    if (signal?.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
      resetFfmpegWorker();
      throw new DOMException('Audio extraction cancelled.', 'AbortError');
    }
    const rawMsg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
    if (rawMsg.includes('memory') || rawMsg.includes('terminated') || rawMsg.includes('abort')) {
      resetFfmpegWorker();
    }
    throw err instanceof Error ? err : new Error('Audio extraction failed.');
  } finally {
    if (signal) {
      signal.removeEventListener('abort', handleAbort);
    }
    if (ffmpeg && ffmpeg.loaded) {
      ffmpeg.off('progress', handleProgress);
      ffmpeg.off('log', handleLog);
      for (const path of [INTERNAL_INPUT_FILENAME, INTERNAL_AUDIO_FILENAME]) {
        try {
          await ffmpeg.deleteFile(path);
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  }
}

export async function renderTrimmedVideo(params: {
  file: File;
  start: number;
  end: number;
  duration: number;
  segments?: VideoSegment[];
  mode: ExportMode;
  tools?: EditToolsConfig;
  videoWidth?: number;
  videoHeight?: number;
  signal?: AbortSignal;
  onProgress?: (progress: RenderProgress) => void;
}): Promise<RenderResult> {
  const {
    file,
    start,
    end,
    duration,
    segments,
    mode,
    tools = createDefaultEditTools(),
    videoWidth,
    videoHeight,
    signal,
    onProgress,
  } = params;

  // Validate inputs early before loading ffmpeg core
  const preliminaryPlan = buildToolsExportPlan({
    start,
    end,
    duration,
    segments,
    mode,
    tools,
    videoWidth,
    videoHeight,
    hasSourceAudio: true,
  });

  const burningCaptions = Boolean(tools.burnCaptions && tools.captions.length > 0);
  let ffmpeg: FFmpeg | null = null;
  const recentLogs: string[] = [];
  const writtenTempFiles: string[] = [];

  const handleAbort = () => {
    resetFfmpegWorker();
  };

  if (signal) {
    if (signal.aborted) {
      throw new DOMException('Export cancelled.', 'AbortError');
    }
    signal.addEventListener('abort', handleAbort, { once: true });
  }

  let expectedDuration = preliminaryPlan.outputDuration;

  const handleProgress = ({ progress, time }: { progress: number; time: number }) => {
    const timeSeconds = Number.isFinite(time) && time >= 0 ? time / 1_000_000 : undefined;
    let normalized = 0;

    if (timeSeconds !== undefined && timeSeconds > 0 && expectedDuration > 0) {
      normalized = Math.min(0.99, Math.max(0, timeSeconds / expectedDuration));
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

    onProgress?.({ phase: 'preparing', progress: 0 });

    // Validate font early before heavy file I/O if text/captions are needed
    let fontBytes: Uint8Array | null = null;
    if (preliminaryPlan.requiresFont) {
      fontBytes = await getBundledFontBytes(signal);
    }

    const fileBytes = new Uint8Array(await file.arrayBuffer());
    if (signal?.aborted) {
      throw new DOMException('Export cancelled.', 'AbortError');
    }

    await ffmpeg.writeFile(INTERNAL_INPUT_FILENAME, fileBytes, { signal });
    writtenTempFiles.push(INTERNAL_INPUT_FILENAME);

    // Probe whether the video actually contains an audio stream when complex routing/mixing is used
    const needsStreamProbe =
      (segments && segments.filter((s) => !s.deleted).length > 1) ||
      Boolean(tools.addedAudio.file) ||
      tools.exportSettings.audioOnlyMp3;

    const hasSourceAudio = needsStreamProbe
      ? await detectHasAudioStream(ffmpeg, INTERNAL_INPUT_FILENAME, signal)
      : true;

    const plan = buildToolsExportPlan({
      start,
      end,
      duration,
      segments,
      mode,
      tools,
      videoWidth,
      videoHeight,
      hasSourceAudio,
    });
    expectedDuration = plan.outputDuration;

    if (plan.requiresFont) {
      if (!fontBytes) {
        fontBytes = await getBundledFontBytes(signal);
      }
      await ffmpeg.writeFile(INTERNAL_FONT_FILENAME, fontBytes, { signal });
      writtenTempFiles.push(INTERNAL_FONT_FILENAME);
    }

    const encoder = new TextEncoder();
    for (const tf of plan.textFiles) {
      const bytes = encoder.encode(tf.content);
      await ffmpeg.writeFile(tf.path, bytes, { signal });
      writtenTempFiles.push(tf.path);
    }

    for (const media of plan.extraMediaFiles) {
      const mediaBytes = new Uint8Array(await media.file.arrayBuffer());
      if (signal?.aborted) {
        throw new DOMException('Export cancelled.', 'AbortError');
      }
      await ffmpeg.writeFile(media.internalPath, mediaBytes, { signal });
      writtenTempFiles.push(media.internalPath);
    }

    ffmpeg.on('progress', handleProgress);
    ffmpeg.on('log', handleLog);

    onProgress?.({ phase: 'processing', progress: 0 });
    const exitCode = await ffmpeg.exec(plan.args, -1, { signal });

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
    const outInternalFile = plan.isAudioOnly
      ? INTERNAL_OUTPUT_AUDIO_FILENAME
      : INTERNAL_OUTPUT_FILENAME;
    writtenTempFiles.push(outInternalFile);

    const outputData = await ffmpeg.readFile(outInternalFile, 'binary', { signal });

    if (!(outputData instanceof Uint8Array) || outputData.byteLength === 0) {
      throw new Error('Export produced an empty output file.');
    }

    const outputCopy = new Uint8Array(outputData.byteLength);
    outputCopy.set(outputData);

    const blob = new Blob([outputCopy.buffer], {
      type: plan.isAudioOnly ? 'audio/mpeg' : 'video/mp4',
    });

    const baseSuggested = sanitizeExportFilename(file.name);
    const suggestedFilename = plan.isAudioOnly
      ? baseSuggested.replace(/\.mp4$/i, '.mp3')
      : baseSuggested;

    return {
      blob,
      size: blob.size,
      duration: expectedDuration,
      mode: plan.effectiveMode,
      suggestedFilename,
      isAudioOnly: plan.isAudioOnly,
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
    throw toFriendlyRenderError(err, preliminaryPlan.effectiveMode, burningCaptions);
  } finally {
    if (signal) {
      signal.removeEventListener('abort', handleAbort);
    }
    if (ffmpeg && ffmpeg.loaded) {
      ffmpeg.off('progress', handleProgress);
      ffmpeg.off('log', handleLog);
      for (const path of writtenTempFiles) {
        try {
          await ffmpeg.deleteFile(path);
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  }
}

export async function renderProjectExport(params: {
  videoFile: File | null;
  project: ProjectState;
  assets: Map<string, MediaAsset>;
  videoWidth?: number;
  videoHeight?: number;
  signal?: AbortSignal;
  onProgress?: (progress: RenderProgress) => void;
}): Promise<RenderResult> {
  const { compileProjectToFfmpegPlan } = await import('./projectCompiler');
  const {
    videoFile,
    project,
    assets,
    videoWidth,
    videoHeight,
    signal,
    onProgress,
  } = params;

  const preliminaryPlan = compileProjectToFfmpegPlan({
    project,
    assets,
    videoWidth,
    videoHeight,
    hasSourceAudio: Boolean(videoFile),
  });

  let ffmpeg: FFmpeg | null = null;
  const recentLogs: string[] = [];
  const writtenTempFiles: string[] = [];

  const handleAbort = () => {
    resetFfmpegWorker();
  };

  if (signal) {
    if (signal.aborted) {
      throw new DOMException('Export cancelled.', 'AbortError');
    }
    signal.addEventListener('abort', handleAbort, { once: true });
  }

  let expectedDuration = preliminaryPlan.outputDuration;

  const handleProgress = ({ progress, time }: { progress: number; time: number }) => {
    const timeSeconds = Number.isFinite(time) && time >= 0 ? time / 1_000_000 : undefined;
    let normalized = 0;

    if (timeSeconds !== undefined && timeSeconds > 0 && expectedDuration > 0) {
      normalized = Math.min(0.99, Math.max(0, timeSeconds / expectedDuration));
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

    onProgress?.({ phase: 'preparing', progress: 0 });

    let fontBytes: Uint8Array | null = null;
    if (preliminaryPlan.requiresFont) {
      fontBytes = await getBundledFontBytes(signal);
    }

    // Write each source media file into MEMFS ONCE and probe audio streams per unique video file
    const writtenPathSet = new Set<string>();
    const videoAudioPresence = new Map<string, boolean>();
    const videoTrack = project.tracks.find((t) => t.kind === 'video');
    const videoClips = (videoTrack?.clips ?? []).filter((c) => c.type === 'video');

    for (const media of preliminaryPlan.extraMediaFiles) {
      if (writtenPathSet.has(media.internalPath)) continue;
      const mediaBytes = new Uint8Array(await media.file.arrayBuffer());
      if (signal?.aborted) {
        throw new DOMException('Export cancelled.', 'AbortError');
      }
      await ffmpeg.writeFile(media.internalPath, mediaBytes, { signal });
      writtenTempFiles.push(media.internalPath);
      writtenPathSet.add(media.internalPath);
    }

    // Probe each unique video asset present in MEMFS
    const seenVideoAssetIds: string[] = [];
    for (const vc of videoClips) {
      if (!seenVideoAssetIds.includes(vc.assetId)) {
        seenVideoAssetIds.push(vc.assetId);
      }
    }
    if (preliminaryPlan.effectiveMode === 'fast' && seenVideoAssetIds.length === 1) {
      videoAudioPresence.set(seenVideoAssetIds[0], true);
    } else {
      for (let i = 0; i < seenVideoAssetIds.length; i++) {
        const assetId = seenVideoAssetIds[i];
        const asset = assets.get(assetId);
        if (!asset || asset.kind !== 'video') continue;
        const vidPath = `vid_src_${i}.${asset.extension}`;
        if (writtenPathSet.has(vidPath)) {
          const hasAudio = await detectHasAudioStream(ffmpeg, vidPath, signal);
          videoAudioPresence.set(assetId, hasAudio);
        }
      }
    }

    const plan = compileProjectToFfmpegPlan({
      project,
      assets,
      videoWidth,
      videoHeight,
      videoAudioPresence,
    });
    expectedDuration = plan.outputDuration;

    if (plan.requiresFont) {
      if (!fontBytes) {
        fontBytes = await getBundledFontBytes(signal);
      }
      await ffmpeg.writeFile(INTERNAL_FONT_FILENAME, fontBytes, { signal });
      writtenTempFiles.push(INTERNAL_FONT_FILENAME);
    }

    const encoder = new TextEncoder();
    for (const tf of plan.textFiles) {
      const bytes = encoder.encode(tf.content);
      await ffmpeg.writeFile(tf.path, bytes, { signal });
      writtenTempFiles.push(tf.path);
    }

    for (const media of plan.extraMediaFiles) {
      if (writtenPathSet.has(media.internalPath)) continue;
      const mediaBytes = new Uint8Array(await media.file.arrayBuffer());
      if (signal?.aborted) {
        throw new DOMException('Export cancelled.', 'AbortError');
      }
      await ffmpeg.writeFile(media.internalPath, mediaBytes, { signal });
      writtenTempFiles.push(media.internalPath);
      writtenPathSet.add(media.internalPath);
    }

    ffmpeg.on('progress', handleProgress);
    ffmpeg.on('log', handleLog);

    onProgress?.({ phase: 'processing', progress: 0 });
    const exitCode = await ffmpeg.exec(plan.args, -1, { signal });

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
    const outInternalFile = plan.isAudioOnly
      ? INTERNAL_OUTPUT_AUDIO_FILENAME
      : INTERNAL_OUTPUT_FILENAME;
    writtenTempFiles.push(outInternalFile);

    const outputData = await ffmpeg.readFile(outInternalFile, 'binary', { signal });

    if (!(outputData instanceof Uint8Array) || outputData.byteLength === 0) {
      throw new Error('Export produced an empty output file.');
    }

    const outputCopy = new Uint8Array(outputData.byteLength);
    outputCopy.set(outputData);

    const blob = new Blob([outputCopy.buffer], {
      type: plan.isAudioOnly ? 'audio/mpeg' : 'video/mp4',
    });

    const firstClipAsset = videoClips[0] ? assets.get(videoClips[0].assetId) : undefined;
    const baseSuggested = sanitizeExportFilename(
      videoFile
        ? videoFile.name
        : firstClipAsset
          ? firstClipAsset.name
          : `${project.name || 'project'}.mp4`
    );
    const suggestedFilename = plan.isAudioOnly
      ? baseSuggested.replace(/\.mp4$/i, '.mp3')
      : baseSuggested;

    return {
      blob,
      size: blob.size,
      duration: expectedDuration,
      mode: plan.effectiveMode,
      suggestedFilename,
      isAudioOnly: plan.isAudioOnly,
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
    throw toFriendlyRenderError(err, preliminaryPlan.effectiveMode, false);
  } finally {
    if (signal) {
      signal.removeEventListener('abort', handleAbort);
    }
    if (ffmpeg && ffmpeg.loaded) {
      ffmpeg.off('progress', handleProgress);
      ffmpeg.off('log', handleLog);
      for (const path of writtenTempFiles) {
        try {
          await ffmpeg.deleteFile(path);
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  }
}
