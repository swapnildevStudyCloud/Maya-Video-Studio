import { wrapCaptionTextForBurnIn } from './captions';
import { validateSegments } from './segments';
import {
  hasActiveColorFilter,
  hasActiveEditingTools,
  sanitizeOverlayText,
  validateEditToolsConfig,
} from './toolsValidation';
import { validateTrimRange } from './trimValidation';
import {
  INTERNAL_AUDIO_FILENAME,
  INTERNAL_FONT_FILENAME,
  INTERNAL_INPUT_FILENAME,
  INTERNAL_OUTPUT_AUDIO_FILENAME,
  INTERNAL_OUTPUT_FILENAME,
  type CropAspectRatio,
  type EditToolsConfig,
  type ExportMode,
  type ExportQuality,
  type ExportResolution,
  type ImageOverlayPosition,
  type RotationDegrees,
  type TextOverlayColor,
  type TextOverlayPosition,
  type TextOverlaySize,
  type VideoSegment,
} from './types';

function formatSecondsArg(value: number): string {
  return value.toFixed(3);
}

export interface VirtualTextFile {
  path: string;
  content: string;
}

export interface ExtraMediaFile {
  internalPath: string;
  file: File;
}

export interface ExportPlan {
  args: string[];
  textFiles: VirtualTextFile[];
  extraMediaFiles: ExtraMediaFile[];
  requiresFont: boolean;
  effectiveMode: ExportMode;
  forcedPrecise: boolean;
  outputDuration: number;
  isAudioOnly: boolean;
}

function getEffectiveDimensions(params: {
  width: number;
  height: number;
  cropAspect: CropAspectRatio;
  rotationDegrees: RotationDegrees;
  resolution: ExportResolution;
}): { width: number; height: number } {
  let w = params.width > 0 ? params.width : 1280;
  let h = params.height > 0 ? params.height : 720;

  if (params.cropAspect === '9:16') {
    const targetW = Math.min(w, (h * 9) / 16);
    const targetH = Math.min(h, (w * 16) / 9);
    w = Math.max(2, Math.floor(targetW / 2) * 2);
    h = Math.max(2, Math.floor(targetH / 2) * 2);
  } else if (params.cropAspect === '1:1') {
    const side = Math.max(2, Math.floor(Math.min(w, h) / 2) * 2);
    w = side;
    h = side;
  } else if (params.cropAspect === '16:9') {
    const targetW = Math.min(w, (h * 16) / 9);
    const targetH = Math.min(h, (w * 9) / 16);
    w = Math.max(2, Math.floor(targetW / 2) * 2);
    h = Math.max(2, Math.floor(targetH / 2) * 2);
  }

  if (params.rotationDegrees === 90 || params.rotationDegrees === 270) {
    const tmp = w;
    w = h;
    h = tmp;
  }

  const maxH = getResolutionTargetHeight(params.resolution);
  if (maxH !== null && h > maxH) {
    w = Math.max(2, Math.floor(((w * maxH) / h) / 2) * 2);
    h = maxH;
  }

  return { width: w, height: h };
}

function getResolutionTargetHeight(resolution: ExportResolution): number | null {
  switch (resolution) {
    case '1080p':
      return 1080;
    case '720p':
      return 720;
    case '480p':
      return 480;
    case 'original':
      return null;
  }
}

function getQualitySettings(quality: ExportQuality): {
  crf: string;
  aacBitrate: string;
  mp3Bitrate: string;
} {
  switch (quality) {
    case 'draft':
      return { crf: '30', aacBitrate: '96k', mp3Bitrate: '128k' };
    case 'small':
      return { crf: '28', aacBitrate: '96k', mp3Bitrate: '128k' };
    case 'high':
      return { crf: '18', aacBitrate: '192k', mp3Bitrate: '256k' };
    case 'balanced':
      return { crf: '23', aacBitrate: '128k', mp3Bitrate: '192k' };
  }
}

function getCropFilter(cropAspect: CropAspectRatio): string | null {
  switch (cropAspect) {
    case 'original':
      return null;
    case '9:16':
      return 'crop=trunc(min(iw\\,ih*9/16)/2)*2:trunc(min(ih\\,iw*16/9)/2)*2:(iw-ow)/2:(ih-oh)/2';
    case '1:1':
      return 'crop=trunc(min(iw\\,ih)/2)*2:trunc(min(iw\\,ih)/2)*2:(iw-ow)/2:(ih-oh)/2';
    case '16:9':
      return 'crop=trunc(min(iw\\,ih*16/9)/2)*2:trunc(min(ih\\,iw*9/16)/2)*2:(iw-ow)/2:(ih-oh)/2';
  }
}

function getImageOverlayPositionExpr(position: ImageOverlayPosition): string {
  switch (position) {
    case 'top-left':
      return 'x=W*0.03:y=H*0.03';
    case 'top-right':
      return 'x=W-w-W*0.03:y=H*0.03';
    case 'bottom-left':
      return 'x=W*0.03:y=H-h-H*0.03';
    case 'bottom-right':
      return 'x=W-w-W*0.03:y=H-h-H*0.03';
    case 'center':
      return 'x=(W-w)/2:y=(H-h)/2';
  }
}

function getOverlayFontSize(size: TextOverlaySize, outHeight: number): number {
  const factor = size === 'small' ? 0.04 : size === 'medium' ? 0.06 : 0.085;
  return Math.max(16, Math.round(outHeight * factor));
}

function getOverlayYExpr(position: TextOverlayPosition): string {
  switch (position) {
    case 'top':
      return 'h*0.08';
    case 'center':
      return '(h-text_h)/2';
    case 'bottom':
      return 'h-text_h-h*0.08';
  }
}

function getOverlayContrastParams(color: TextOverlayColor): string {
  if (color === 'black') {
    return 'borderw=2:bordercolor=white@0.85';
  }
  return 'shadowcolor=black@0.7:shadowx=2:shadowy=2';
}

/**
 * Builds deterministic Phase 1 ffmpeg CLI arguments using fixed internal filenames
 * and validated numeric start/duration values.
 */
export function buildFfmpegArgs(params: {
  start: number;
  end: number;
  duration: number;
  mode: ExportMode;
}): string[] {
  const validation = validateTrimRange(params.start, params.end, params.duration);
  if (!validation.ok) {
    throw new Error(validation.error);
  }

  const { start, end } = validation.value;
  const clipDuration = end - start;
  const startStr = formatSecondsArg(start);
  const durationStr = formatSecondsArg(clipDuration);

  if (params.mode === 'fast') {
    return [
      '-ss',
      startStr,
      '-i',
      INTERNAL_INPUT_FILENAME,
      '-t',
      durationStr,
      '-c',
      'copy',
      '-avoid_negative_ts',
      'make_zero',
      '-movflags',
      '+faststart',
      INTERNAL_OUTPUT_FILENAME,
    ];
  }

  return [
    '-ss',
    startStr,
    '-i',
    INTERNAL_INPUT_FILENAME,
    '-t',
    durationStr,
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-crf',
    '23',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-movflags',
    '+faststart',
    INTERNAL_OUTPUT_FILENAME,
  ];
}

/**
 * Builds deterministic ffmpeg CLI arguments to extract mono 32 kbps MP3 audio
 * from the trimmed range for Gemini caption generation.
 */
export function buildExtractAudioArgs(params: {
  start: number;
  end: number;
  duration: number;
}): string[] {
  const validation = validateTrimRange(params.start, params.end, params.duration);
  if (!validation.ok) {
    throw new Error(validation.error);
  }

  const { start, end } = validation.value;
  const clipDuration = end - start;

  return [
    '-ss',
    formatSecondsArg(start),
    '-i',
    INTERNAL_INPUT_FILENAME,
    '-t',
    formatSecondsArg(clipDuration),
    '-vn',
    '-ac',
    '1',
    '-ar',
    '16000',
    '-b:a',
    '32k',
    '-c:a',
    'libmp3lame',
    INTERNAL_AUDIO_FILENAME,
  ];
}

/**
 * Builds deterministic ffmpeg export plan applying segments and tools in fixed order:
 * trim/concat -> crop -> rotate/flip -> speed -> color -> scale -> image overlay -> text/captions -> fade.
 * User text and Gemini captions are written to virtual files (textfile=) and never embedded in args.
 */
export function buildToolsExportPlan(params: {
  start: number;
  end: number;
  duration: number;
  segments?: VideoSegment[];
  mode: ExportMode;
  tools: EditToolsConfig;
  videoWidth?: number;
  videoHeight?: number;
  hasSourceAudio?: boolean;
}): ExportPlan {
  const hasSourceAudio = params.hasSourceAudio ?? true;

  let keptSegments: VideoSegment[];
  if (params.segments && params.segments.length > 0) {
    const segRes = validateSegments(params.segments, params.duration);
    if (!segRes.ok) {
      throw new Error(segRes.error);
    }
    keptSegments = segRes.value;
  } else {
    const trimRes = validateTrimRange(params.start, params.end, params.duration);
    if (!trimRes.ok) {
      throw new Error(trimRes.error);
    }
    keptSegments = [
      {
        id: 'single',
        start: trimRes.value.start,
        end: trimRes.value.end,
        deleted: false,
      },
    ];
  }

  const clipDuration = keptSegments.reduce((sum, s) => sum + (s.end - s.start), 0);
  const isMultiSegment = keptSegments.length > 1;

  const toolsRes = validateEditToolsConfig(params.tools, clipDuration);
  if (!toolsRes.ok) {
    throw new Error(toolsRes.error);
  }
  const tools = toolsRes.value;

  const toolsActive = hasActiveEditingTools(tools);
  if (!isMultiSegment && !toolsActive) {
    const single = keptSegments[0];
    return {
      args: buildFfmpegArgs({
        start: single.start,
        end: single.end,
        duration: params.duration,
        mode: params.mode,
      }),
      textFiles: [],
      extraMediaFiles: [],
      requiresFont: false,
      effectiveMode: params.mode,
      forcedPrecise: false,
      outputDuration: clipDuration,
      isAudioOnly: false,
    };
  }

  const outputDuration = clipDuration / tools.speed;
  const quality = getQualitySettings(tools.exportSettings.quality);
  const isAudioOnly = tools.exportSettings.audioOnlyMp3;
  const effectiveDims = getEffectiveDimensions({
    width: params.videoWidth ?? 1280,
    height: params.videoHeight ?? 720,
    cropAspect: tools.cropAspect,
    rotationDegrees: tools.rotationDegrees,
    resolution: tools.exportSettings.resolution,
  });

  const keepOrigAudio =
    hasSourceAudio && !tools.audio.muted && tools.audio.volumePercent > 0;
  const hasAddedAudio = Boolean(
    tools.addedAudio.file && tools.addedAudio.format && tools.addedAudio.volumePercent > 0
  );
  const hasImageOverlay = Boolean(
    !isAudioOnly && tools.imageOverlay.file && tools.imageOverlay.format
  );

  if (isAudioOnly && !keepOrigAudio && !hasAddedAudio) {
    throw new Error(
      'No audio stream is available to export as MP3 (the video has no audio track or is muted, and no sound track was added).'
    );
  }

  const extraMediaFiles: ExtraMediaFile[] = [];
  const textFiles: VirtualTextFile[] = [];

  // Register extra media inputs deterministically with fixed internal names
  let addedAudioInputIdx: number | null = null;
  let imageInputIdx: number | null = null;
  let nextInputIdx = 1;

  if (hasAddedAudio && tools.addedAudio.file && tools.addedAudio.format) {
    addedAudioInputIdx = nextInputIdx++;
    extraMediaFiles.push({
      internalPath: `added_audio.${tools.addedAudio.format}`,
      file: tools.addedAudio.file,
    });
  }

  if (hasImageOverlay && tools.imageOverlay.file && tools.imageOverlay.format) {
    imageInputIdx = nextInputIdx++;
    extraMediaFiles.push({
      internalPath: `overlay_image.${tools.imageOverlay.format}`,
      file: tools.imageOverlay.file,
    });
  }

  // Build simple video filter steps (post-trim/concat)
  const videoPostFilters: string[] = [];
  if (!isAudioOnly) {
    // 2. Crop (center crop)
    const cropFilter = getCropFilter(tools.cropAspect);
    if (cropFilter) {
      videoPostFilters.push(cropFilter);
    }

    // 3. Rotate & Flip
    if (tools.rotationDegrees === 90) {
      videoPostFilters.push('transpose=1');
    } else if (tools.rotationDegrees === 180) {
      videoPostFilters.push('transpose=1', 'transpose=1');
    } else if (tools.rotationDegrees === 270) {
      videoPostFilters.push('transpose=2');
    }
    if (tools.flipHorizontal) {
      videoPostFilters.push('hflip');
    }

    // 4. Speed
    if (tools.speed === 0.5) {
      videoPostFilters.push('setpts=2.0*PTS');
    } else if (tools.speed === 1.5) {
      videoPostFilters.push('setpts=0.666667*PTS');
    } else if (tools.speed === 2) {
      videoPostFilters.push('setpts=0.5*PTS');
    }

    // 4b. Color filters (eq + preset)
    if (hasActiveColorFilter(tools.colorFilter)) {
      const { brightness, contrast, saturation, preset } = tools.colorFilter;
      if (
        Math.abs(brightness) > 1e-6 ||
        Math.abs(contrast - 1) > 1e-6 ||
        Math.abs(saturation - 1) > 1e-6
      ) {
        videoPostFilters.push(
          `eq=brightness=${brightness.toFixed(2)}:contrast=${contrast.toFixed(2)}:saturation=${saturation.toFixed(2)}`
        );
      }
      if (preset === 'bw') {
        videoPostFilters.push('hue=s=0');
      } else if (preset === 'warm') {
        videoPostFilters.push('colorbalance=rs=0.08:gs=0.02:bs=-0.08');
      } else if (preset === 'cool') {
        videoPostFilters.push('colorbalance=rs=-0.08:gs=0.02:bs=0.08');
      }
    }

    // 4c. Resolution scale
    const maxHeight = getResolutionTargetHeight(tools.exportSettings.resolution);
    if (maxHeight !== null) {
      videoPostFilters.push(`scale=-2:'trunc(min(ih\\,${maxHeight})/2)*2'`);
    }
  }

  // 5. Text overlays & burned captions (placed after image overlay in filtergraph)
  const textAndFadeFilters: string[] = [];
  if (!isAudioOnly) {
    tools.textOverlays.forEach((overlay, idx) => {
      const filename = `overlay_${idx}.txt`;
      textFiles.push({
        path: filename,
        content: sanitizeOverlayText(overlay.text).trim(),
      });

      const fontSize = getOverlayFontSize(overlay.size, effectiveDims.height);
      const yExpr = getOverlayYExpr(overlay.position);
      const contrast = getOverlayContrastParams(overlay.color);
      const s = formatSecondsArg(overlay.start);
      const e = formatSecondsArg(overlay.end);

      textAndFadeFilters.push(
        `drawtext=fontfile=${INTERNAL_FONT_FILENAME}:textfile=${filename}:expansion=none:fontsize=${fontSize}:fontcolor=${overlay.color}:${contrast}:x=(w-text_w)/2:y=${yExpr}:enable='between(t,${s},${e})'`
      );
    });

    if (tools.burnCaptions && tools.captions.length > 0) {
      const captionFontSize = Math.max(18, Math.round(effectiveDims.height * 0.045));
      tools.captions.forEach((segment, idx) => {
        const filename = `caption_${idx}.txt`;
        textFiles.push({
          path: filename,
          content: wrapCaptionTextForBurnIn(segment.text),
        });

        const scaledStart = Math.max(0, Math.min(outputDuration, segment.start / tools.speed));
        const scaledEnd = Math.max(0, Math.min(outputDuration, segment.end / tools.speed));
        if (scaledEnd <= scaledStart) {
          return;
        }

        const s = formatSecondsArg(scaledStart);
        const e = formatSecondsArg(scaledEnd);

        textAndFadeFilters.push(
          `drawtext=fontfile=${INTERNAL_FONT_FILENAME}:textfile=${filename}:expansion=none:fontsize=${captionFontSize}:fontcolor=white:box=1:boxcolor=black@0.75:boxborderw=10:x=(w-text_w)/2:y=h-text_h-h*0.07:enable='between(t,${s},${e})'`
        );
      });
    }

    // 6. Video Fade in / out
    if (tools.fade.fadeInSeconds > 0) {
      textAndFadeFilters.push(`fade=t=in:st=0:d=${formatSecondsArg(tools.fade.fadeInSeconds)}`);
    }
    if (tools.fade.fadeOutSeconds > 0) {
      const st = formatSecondsArg(Math.max(0, outputDuration - tools.fade.fadeOutSeconds));
      textAndFadeFilters.push(`fade=t=out:st=${st}:d=${formatSecondsArg(tools.fade.fadeOutSeconds)}`);
    }
  }

  // Audio filters for original track
  const origAudioFilters: string[] = [];
  if (keepOrigAudio) {
    if (tools.audio.volumePercent !== 100) {
      origAudioFilters.push(`volume=${(tools.audio.volumePercent / 100).toFixed(2)}`);
    }
    if (tools.speed === 0.5) {
      origAudioFilters.push('atempo=0.5');
    } else if (tools.speed === 1.5) {
      origAudioFilters.push('atempo=1.5');
    } else if (tools.speed === 2) {
      origAudioFilters.push('atempo=2.0');
    }
    if (tools.fade.fadeInSeconds > 0) {
      origAudioFilters.push(`afade=t=in:st=0:d=${formatSecondsArg(tools.fade.fadeInSeconds)}`);
    }
    if (tools.fade.fadeOutSeconds > 0) {
      const st = formatSecondsArg(Math.max(0, outputDuration - tools.fade.fadeOutSeconds));
      origAudioFilters.push(`afade=t=out:st=${st}:d=${formatSecondsArg(tools.fade.fadeOutSeconds)}`);
    }
  }

  // Simple path (single segment, no extra inputs, not audio-only): preserves -vf / -af structure
  const useComplexGraph =
    isMultiSegment || addedAudioInputIdx !== null || imageInputIdx !== null || isAudioOnly;

  if (!useComplexGraph) {
    const single = keptSegments[0];
    const combinedVf = [...videoPostFilters, ...textAndFadeFilters];
    const args: string[] = [
      '-ss',
      formatSecondsArg(single.start),
      '-i',
      INTERNAL_INPUT_FILENAME,
      '-t',
      formatSecondsArg(clipDuration),
    ];

    if (combinedVf.length > 0) {
      args.push('-vf', combinedVf.join(','));
    }

    args.push(
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-crf',
      quality.crf,
      '-pix_fmt',
      'yuv420p'
    );

    if (!keepOrigAudio) {
      args.push('-an');
    } else {
      if (origAudioFilters.length > 0) {
        args.push('-af', origAudioFilters.join(','));
      }
      args.push('-c:a', 'aac', '-b:a', quality.aacBitrate);
    }

    args.push('-movflags', '+faststart', INTERNAL_OUTPUT_FILENAME);

    return {
      args,
      textFiles,
      extraMediaFiles,
      requiresFont: textFiles.length > 0,
      effectiveMode: 'precise',
      forcedPrecise: params.mode !== 'precise',
      outputDuration,
      isAudioOnly: false,
    };
  }

  // Complex filtergraph path (multi-segment concat, added sound mixing, image overlay, or MP3-only)
  const args: string[] = [];

  if (!isMultiSegment) {
    const single = keptSegments[0];
    args.push(
      '-ss',
      formatSecondsArg(single.start),
      '-i',
      INTERNAL_INPUT_FILENAME,
      '-t',
      formatSecondsArg(clipDuration)
    );
  } else {
    args.push('-i', INTERNAL_INPUT_FILENAME);
  }

  for (const media of extraMediaFiles) {
    const isAddedAudio =
      addedAudioInputIdx !== null && media.internalPath.startsWith('added_audio.');
    if (isAddedAudio && tools.addedAudio.loopToVideo) {
      args.push('-stream_loop', '-1');
    }
    args.push('-i', media.internalPath);
  }

  const filterParts: string[] = [];
  let videoLabel: string | null = null;
  let origAudioLabel: string | null = null;

  if (!isAudioOnly) {
    if (isMultiSegment) {
      const segVideoLabels: string[] = [];
      keptSegments.forEach((seg, idx) => {
        const lbl = `[vseg${idx}]`;
        filterParts.push(
          `[0:v]trim=start=${formatSecondsArg(seg.start)}:end=${formatSecondsArg(seg.end)},setpts=PTS-STARTPTS${lbl}`
        );
        segVideoLabels.push(lbl);
      });
      filterParts.push(
        `${segVideoLabels.join('')}concat=n=${keptSegments.length}:v=1:a=0[vcat]`
      );
      videoLabel = '[vcat]';
    } else {
      videoLabel = '[0:v]';
    }

    if (videoPostFilters.length > 0) {
      filterParts.push(`${videoLabel}${videoPostFilters.join(',')}[vpost]`);
      videoLabel = '[vpost]';
    }

    if (imageInputIdx !== null) {
      const targetWidth = Math.max(
        2,
        Math.round(((effectiveDims.width * tools.imageOverlay.sizePercent) / 100) / 2) * 2
      );
      const opacity = (tools.imageOverlay.opacityPercent / 100).toFixed(2);
      const posExpr = getImageOverlayPositionExpr(tools.imageOverlay.position);
      const s = formatSecondsArg(tools.imageOverlay.start);
      const e = formatSecondsArg(tools.imageOverlay.end);

      filterParts.push(
        `[${imageInputIdx}:v]format=rgba,colorchannelmixer=aa=${opacity},scale=${targetWidth}:-2[ovimg]`
      );
      filterParts.push(
        `${videoLabel}[ovimg]overlay=${posExpr}:enable='between(t,${s},${e})'[vimg]`
      );
      videoLabel = '[vimg]';
    }

    if (textAndFadeFilters.length > 0) {
      filterParts.push(`${videoLabel}${textAndFadeFilters.join(',')}[vfinal]`);
      videoLabel = '[vfinal]';
    }
  }

  if (keepOrigAudio) {
    if (isMultiSegment) {
      const segAudioLabels: string[] = [];
      keptSegments.forEach((seg, idx) => {
        const lbl = `[aseg${idx}]`;
        filterParts.push(
          `[0:a]atrim=start=${formatSecondsArg(seg.start)}:end=${formatSecondsArg(seg.end)},asetpts=PTS-STARTPTS${lbl}`
        );
        segAudioLabels.push(lbl);
      });
      filterParts.push(
        `${segAudioLabels.join('')}concat=n=${keptSegments.length}:v=0:a=1[acat]`
      );
      origAudioLabel = '[acat]';
    } else {
      origAudioLabel = '[0:a]';
    }

    if (origAudioFilters.length > 0) {
      filterParts.push(`${origAudioLabel}${origAudioFilters.join(',')}[aorig]`);
      origAudioLabel = '[aorig]';
    }
  }

  let addedAudioLabel: string | null = null;
  if (hasAddedAudio && addedAudioInputIdx !== null) {
    const addSteps: string[] = ['aformat=sample_rates=44100:channel_layouts=stereo'];
    const delayMs = Math.round(tools.addedAudio.startOffsetSeconds * 1000);
    if (delayMs > 0) {
      addSteps.push(`adelay=${delayMs}|${delayMs}`);
    }
    addSteps.push(`atrim=0:${formatSecondsArg(outputDuration)}`, 'asetpts=PTS-STARTPTS');
    if (tools.addedAudio.volumePercent !== 100) {
      addSteps.push(`volume=${(tools.addedAudio.volumePercent / 100).toFixed(2)}`);
    }
    if (tools.addedAudio.fadeInSeconds > 0) {
      addSteps.push(
        `afade=t=in:st=${formatSecondsArg(tools.addedAudio.startOffsetSeconds)}:d=${formatSecondsArg(tools.addedAudio.fadeInSeconds)}`
      );
    }
    if (tools.addedAudio.fadeOutSeconds > 0) {
      const fadeOutSt = Math.max(0, outputDuration - tools.addedAudio.fadeOutSeconds);
      addSteps.push(
        `afade=t=out:st=${formatSecondsArg(fadeOutSt)}:d=${formatSecondsArg(tools.addedAudio.fadeOutSeconds)}`
      );
    }

    filterParts.push(`[${addedAudioInputIdx}:a]${addSteps.join(',')}[aadd]`);
    addedAudioLabel = '[aadd]';
  }

  let finalAudioLabel: string | null = null;
  if (origAudioLabel && addedAudioLabel) {
    filterParts.push(
      `${origAudioLabel}aformat=sample_rates=44100:channel_layouts=stereo[aorig_fmt]`
    );
    filterParts.push(
      `[aorig_fmt]${addedAudioLabel}amix=inputs=2:duration=first:dropout_transition=0:normalize=0[amixed]`
    );
    finalAudioLabel = '[amixed]';
  } else if (origAudioLabel) {
    finalAudioLabel = origAudioLabel;
  } else if (addedAudioLabel) {
    finalAudioLabel = addedAudioLabel;
  }

  if (filterParts.length > 0) {
    args.push('-filter_complex', filterParts.join(';'));
  }

  if (isAudioOnly) {
    args.push('-vn');
    if (finalAudioLabel) {
      args.push('-map', finalAudioLabel);
    }
    args.push('-c:a', 'libmp3lame', '-b:a', quality.mp3Bitrate, INTERNAL_OUTPUT_AUDIO_FILENAME);

    return {
      args,
      textFiles: [],
      extraMediaFiles: extraMediaFiles.filter((m) => m.internalPath.startsWith('added_audio.')),
      requiresFont: false,
      effectiveMode: 'precise',
      forcedPrecise: params.mode !== 'precise',
      outputDuration,
      isAudioOnly: true,
    };
  }

  if (videoLabel && videoLabel !== '[0:v]') {
    args.push('-map', videoLabel);
  } else {
    args.push('-map', '0:v');
  }

  args.push(
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-crf',
    quality.crf,
    '-pix_fmt',
    'yuv420p'
  );

  if (!finalAudioLabel) {
    args.push('-an');
  } else {
    if (finalAudioLabel !== '[0:a]') {
      args.push('-map', finalAudioLabel);
    } else {
      args.push('-map', '0:a');
    }
    args.push('-c:a', 'aac', '-b:a', quality.aacBitrate);
  }

  args.push('-movflags', '+faststart', INTERNAL_OUTPUT_FILENAME);

  return {
    args,
    textFiles,
    extraMediaFiles,
    requiresFont: textFiles.length > 0,
    effectiveMode: 'precise',
    forcedPrecise: params.mode !== 'precise',
    outputDuration,
    isAudioOnly: false,
  };
}
