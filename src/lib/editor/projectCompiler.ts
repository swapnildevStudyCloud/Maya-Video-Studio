import { wrapCaptionTextForBurnIn } from './captions';
import { buildFfmpegArgs, type ExportPlan, type ExtraMediaFile, type VirtualTextFile } from './ffmpegArgs';
import { getProjectDuration } from './projectReducer';
import { hasActiveColorFilter } from './toolsValidation';
import {
  ALLOWED_CANVAS_FIT_MODES,
  ALLOWED_CANVAS_PRESETS,
  ALLOWED_COLOR_PRESETS,
  ALLOWED_CROP_ASPECTS,
  ALLOWED_EXPORT_QUALITIES,
  ALLOWED_EXPORT_RESOLUTIONS,
  ALLOWED_OVERLAY_COLORS,
  ALLOWED_OVERLAY_SIZES,
  ALLOWED_ROTATIONS,
  ALLOWED_SPEEDS,
  ALLOWED_TEXT_ALIGNS,
  DEFAULT_EXPORT_FPS,
  INTERNAL_FONT_FILENAME,
  INTERNAL_INPUT_FILENAME,
  INTERNAL_OUTPUT_AUDIO_FILENAME,
  INTERNAL_OUTPUT_FILENAME,
  MAX_ADDED_AUDIO_FADE_SECONDS,
  MAX_FADE_SECONDS,
  MAX_IMAGE_SIZE_PERCENT,
  MAX_TEXT_CLIP_LENGTH,
  MAX_VIDEO_TRACK_CLIPS,
  MAX_VOLUME_PERCENT,
  MIN_IMAGE_SIZE_PERCENT,
  MIN_TRIM_DURATION_SECONDS,
  MIN_VOLUME_PERCENT,
  type AudioClip,
  type CanvasFitMode,
  type CaptionSegment,
  type CropAspectRatio,
  type ExportCanvasPreset,
  type ExportQuality,
  type ExportResolution,
  type ImageClip,
  type MediaAsset,
  type ProjectState,
  type RotationDegrees,
  type TextClip,
  type TextOverlayColor,
  type TextOverlaySize,
  type ValidationResult,
  type VideoClip,
} from './types';

function formatSecondsArg(value: number): string {
  return Math.max(0, value).toFixed(3);
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
    case 'small':
      return { crf: '28', aacBitrate: '96k', mp3Bitrate: '128k' };
    case 'high':
      return { crf: '18', aacBitrate: '192k', mp3Bitrate: '256k' };
    case 'balanced':
      return { crf: '23', aacBitrate: '128k', mp3Bitrate: '192k' };
  }
}

export function resolveProjectCanvasDimensions(params: {
  project: ProjectState;
  assets: Map<string, MediaAsset>;
  videoClips: VideoClip[];
  videoWidth?: number;
  videoHeight?: number;
}): { width: number; height: number } {
  const { project, assets, videoClips } = params;
  const preset: ExportCanvasPreset = project.exportSettings.canvasPreset ?? 'original';

  if (preset === '1080p-16:9') {
    return { width: 1920, height: 1080 };
  }
  if (preset === '720p-16:9') {
    return { width: 1280, height: 720 };
  }
  if (preset === '9:16') {
    return { width: 720, height: 1280 };
  }
  if (preset === '1:1') {
    return { width: 720, height: 720 };
  }

  // 'original': default to first video clip's source size
  const firstClip = videoClips[0];
  const firstAsset = firstClip ? assets.get(firstClip.assetId) : undefined;
  let w =
    firstAsset && firstAsset.kind === 'video' && firstAsset.width > 0
      ? firstAsset.width
      : (params.videoWidth && params.videoWidth > 0 ? params.videoWidth : 1280);
  let h =
    firstAsset && firstAsset.kind === 'video' && firstAsset.height > 0
      ? firstAsset.height
      : (params.videoHeight && params.videoHeight > 0 ? params.videoHeight : 720);

  // If single clip has explicit crop/rotate on Original canvas, honor it cleanly
  if (videoClips.length === 1 && firstClip) {
    if (firstClip.cropAspect === '9:16') {
      const targetW = Math.min(w, (h * 9) / 16);
      const targetH = Math.min(h, (w * 16) / 9);
      w = targetW;
      h = targetH;
    } else if (firstClip.cropAspect === '1:1') {
      const side = Math.min(w, h);
      w = side;
      h = side;
    } else if (firstClip.cropAspect === '16:9') {
      const targetW = Math.min(w, (h * 16) / 9);
      const targetH = Math.min(h, (w * 9) / 16);
      w = targetW;
      h = targetH;
    }

    if (firstClip.rotationDegrees === 90 || firstClip.rotationDegrees === 270) {
      const tmp = w;
      w = h;
      h = tmp;
    }
  }

  const maxH = getResolutionTargetHeight(project.exportSettings.resolution);
  if (maxH !== null && h > maxH) {
    w = (w * maxH) / h;
    h = maxH;
  }

  return {
    width: Math.max(2, Math.floor(w / 2) * 2),
    height: Math.max(2, Math.floor(h / 2) * 2),
  };
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

function getTextFontSize(size: TextOverlaySize, outHeight: number): number {
  const factor = size === 'small' ? 0.045 : size === 'medium' ? 0.065 : 0.09;
  return Math.max(16, Math.round(outHeight * factor));
}

function getTextContrastOrBox(clip: TextClip, color: TextOverlayColor): string {
  if (clip.backgroundBox) {
    const boxColor = color === 'black' ? 'white@0.85' : 'black@0.75';
    return `box=1:boxcolor=${boxColor}:boxborderw=10`;
  }
  if (color === 'black') {
    return 'borderw=2:bordercolor=white@0.85';
  }
  return 'shadowcolor=black@0.75:shadowx=2:shadowy=2';
}

export function sanitizeProjectTextContent(raw: string): string {
  return raw
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, ' ')
    .replace(/\r\n?/g, '\n')
    .trim()
    .slice(0, MAX_TEXT_CLIP_LENGTH);
}

/**
 * Extracts CaptionSegment[] from the project's Captions track for .srt export.
 */
export function projectToCaptions(project: ProjectState): CaptionSegment[] {
  const capTrack = project.tracks.find((t) => t.kind === 'captions');
  if (!capTrack) return [];
  return [...capTrack.clips]
    .filter((c): c is TextClip => c.type === 'text' && c.text.trim().length > 0 && c.duration > 0)
    .sort((a, b) => a.start - b.start)
    .map((c) => ({
      id: c.id,
      start: c.start,
      end: c.start + c.duration,
      text: c.text,
    }));
}

export function isSingleSimpleVideoClipProject(project: ProjectState): boolean {
  if (project.exportSettings.audioOnlyMp3) return false;
  if (project.exportSettings.resolution !== 'original') return false;
  if ((project.exportSettings.canvasPreset ?? 'original') !== 'original') return false;
  if ((project.exportSettings.canvasFit ?? 'fit') !== 'fit') return false;
  if (project.exportSettings.quality !== 'balanced') return false;

  const videoTrack = project.tracks.find((t) => t.kind === 'video');
  if (!videoTrack || videoTrack.hidden || videoTrack.muted) return false;
  if (videoTrack.clips.length !== 1) return false;

  const vc = videoTrack.clips[0];
  if (vc.type !== 'video') return false;
  if (vc.start > 0.01) return false;
  if (
    vc.speed !== 1 ||
    vc.muted ||
    vc.volumePercent !== 100 ||
    vc.rotationDegrees !== 0 ||
    vc.flipHorizontal ||
    vc.cropAspect !== 'original' ||
    hasActiveColorFilter(vc.colorFilter) ||
    vc.fadeInSeconds > 0 ||
    vc.fadeOutSeconds > 0
  ) {
    return false;
  }

  const hasOtherClips = project.tracks.some(
    (t) =>
      t.kind !== 'video' &&
      !t.hidden &&
      !(t.kind === 'audio' && t.muted) &&
      t.clips.length > 0
  );
  return !hasOtherClips;
}

export function validateProjectForExport(
  project: ProjectState,
  assets: Map<string, MediaAsset>
): ValidationResult<ProjectState> {
  if (!ALLOWED_EXPORT_RESOLUTIONS.includes(project.exportSettings.resolution)) {
    return {
      ok: false,
      code: 'INVALID_PROJECT',
      error: 'Invalid export resolution.',
    };
  }
  if (
    project.exportSettings.canvasPreset &&
    !ALLOWED_CANVAS_PRESETS.includes(project.exportSettings.canvasPreset)
  ) {
    return {
      ok: false,
      code: 'INVALID_PROJECT',
      error: 'Invalid project canvas preset.',
    };
  }
  if (
    project.exportSettings.canvasFit &&
    !ALLOWED_CANVAS_FIT_MODES.includes(project.exportSettings.canvasFit)
  ) {
    return {
      ok: false,
      code: 'INVALID_PROJECT',
      error: 'Invalid canvas fit mode.',
    };
  }
  if (!ALLOWED_EXPORT_QUALITIES.includes(project.exportSettings.quality)) {
    return {
      ok: false,
      code: 'INVALID_PROJECT',
      error: 'Invalid export quality.',
    };
  }

  const videoTrack = project.tracks.find((t) => t.kind === 'video');
  const allVideoTrackClips = videoTrack
    ? videoTrack.clips.filter((c): c is VideoClip => c.type === 'video')
    : [];

  if (allVideoTrackClips.length > MAX_VIDEO_TRACK_CLIPS) {
    return {
      ok: false,
      code: 'INVALID_PROJECT',
      error: `The Video track cannot contain more than ${MAX_VIDEO_TRACK_CLIPS} clips.`,
    };
  }

  const videoClips = videoTrack && !videoTrack.hidden ? allVideoTrackClips : [];

  if (!project.exportSettings.audioOnlyMp3) {
    if (videoClips.length === 0) {
      return {
        ok: false,
        code: 'INVALID_PROJECT',
        error: 'Add at least one visible video clip to export.',
      };
    }
    const totalVideoDuration = videoClips.reduce((sum, c) => sum + c.duration, 0);
    if (totalVideoDuration + 1e-6 < MIN_TRIM_DURATION_SECONDS) {
      return {
        ok: false,
        code: 'CLIP_TOO_SHORT',
        error: `At least ${MIN_TRIM_DURATION_SECONDS} seconds of kept video is required.`,
      };
    }
  }

  for (const track of project.tracks) {
    for (const clip of track.clips) {
      if (
        !Number.isFinite(clip.start) ||
        !Number.isFinite(clip.duration) ||
        clip.start < 0 ||
        clip.duration <= 0
      ) {
        return {
          ok: false,
          code: 'INVALID_PROJECT',
          error: `Clip "${clip.name}" has invalid timeline timestamps.`,
        };
      }

      if (clip.type === 'video') {
        const asset = assets.get(clip.assetId);
        if (!asset || asset.kind !== 'video') {
          return {
            ok: false,
            code: 'INVALID_PROJECT',
            error: `Source video file for "${clip.name}" is missing.`,
          };
        }
        if (
          !ALLOWED_SPEEDS.includes(clip.speed) ||
          !ALLOWED_ROTATIONS.includes(clip.rotationDegrees as RotationDegrees) ||
          !ALLOWED_CROP_ASPECTS.includes(clip.cropAspect)
        ) {
          return {
            ok: false,
            code: 'INVALID_TOOL_CONFIG',
            error: `Clip "${clip.name}" has unsupported speed, rotation, or crop settings.`,
          };
        }
        if (
          clip.fadeInSeconds < 0 ||
          clip.fadeInSeconds > MAX_FADE_SECONDS ||
          clip.fadeOutSeconds < 0 ||
          clip.fadeOutSeconds > MAX_FADE_SECONDS
        ) {
          return {
            ok: false,
            code: 'INVALID_TOOL_CONFIG',
            error: `Fade durations on "${clip.name}" must be between 0 and ${MAX_FADE_SECONDS} s.`,
          };
        }
        if (clip.fadeInSeconds + clip.fadeOutSeconds > clip.duration + 1e-3) {
          return {
            ok: false,
            code: 'INVALID_TOOL_CONFIG',
            error: `Combined fade in/out on "${clip.name}" exceeds the clip duration.`,
          };
        }
        if (!ALLOWED_COLOR_PRESETS.includes(clip.colorFilter.preset)) {
          return {
            ok: false,
            code: 'INVALID_TOOL_CONFIG',
            error: `Invalid color filter preset on "${clip.name}".`,
          };
        }
      } else if (clip.type === 'text') {
        if (clip.text.length > MAX_TEXT_CLIP_LENGTH) {
          return {
            ok: false,
            code: 'INVALID_TOOL_CONFIG',
            error: `Text clip "${clip.name}" exceeds ${MAX_TEXT_CLIP_LENGTH} characters.`,
          };
        }
        if (
          !ALLOWED_OVERLAY_SIZES.includes(clip.size) ||
          !ALLOWED_OVERLAY_COLORS.includes(clip.color) ||
          !ALLOWED_TEXT_ALIGNS.includes(clip.align)
        ) {
          return {
            ok: false,
            code: 'INVALID_TOOL_CONFIG',
            error: `Text clip "${clip.name}" has invalid styling options.`,
          };
        }
      } else if (clip.type === 'image') {
        if (!assets.has(clip.assetId)) {
          return {
            ok: false,
            code: 'INVALID_PROJECT',
            error: `Image file for "${clip.name}" is missing.`,
          };
        }
        if (clip.sizePercent < MIN_IMAGE_SIZE_PERCENT || clip.sizePercent > MAX_IMAGE_SIZE_PERCENT) {
          return {
            ok: false,
            code: 'INVALID_TOOL_CONFIG',
            error: `Image "${clip.name}" size must be between ${MIN_IMAGE_SIZE_PERCENT}% and ${MAX_IMAGE_SIZE_PERCENT}%.`,
          };
        }
      } else if (clip.type === 'audio') {
        if (!assets.has(clip.assetId)) {
          return {
            ok: false,
            code: 'INVALID_PROJECT',
            error: `Audio file for "${clip.name}" is missing.`,
          };
        }
        if (clip.volumePercent < MIN_VOLUME_PERCENT || clip.volumePercent > MAX_VOLUME_PERCENT) {
          return {
            ok: false,
            code: 'INVALID_TOOL_CONFIG',
            error: `Audio "${clip.name}" volume must be between 0% and 200%.`,
          };
        }
        if (
          clip.fadeInSeconds < 0 ||
          clip.fadeInSeconds > MAX_ADDED_AUDIO_FADE_SECONDS ||
          clip.fadeOutSeconds < 0 ||
          clip.fadeOutSeconds > MAX_ADDED_AUDIO_FADE_SECONDS
        ) {
          return {
            ok: false,
            code: 'INVALID_TOOL_CONFIG',
            error: `Audio "${clip.name}" fades must be between 0 and ${MAX_ADDED_AUDIO_FADE_SECONDS} s.`,
          };
        }
      }
    }
  }

  return { ok: true, value: project };
}

/**
 * Compiles the unified multi-clip timeline project into deterministic ffmpeg CLI args,
 * virtual MEMFS text files (for drawtext), and deduplicated source media files.
 * Each source video/image file is written into MEMFS at most once.
 */
export function compileProjectToFfmpegPlan(params: {
  project: ProjectState;
  assets: Map<string, MediaAsset>;
  videoWidth?: number;
  videoHeight?: number;
  hasSourceAudio?: boolean;
  videoAudioPresence?: Map<string, boolean>;
}): ExportPlan {
  const { project, assets, hasSourceAudio = true, videoAudioPresence } = params;
  const validation = validateProjectForExport(project, assets);
  if (!validation.ok) {
    throw new Error(validation.error);
  }

  const videoTrack = project.tracks.find((t) => t.kind === 'video');
  const videoClips: VideoClip[] =
    videoTrack && !videoTrack.hidden
      ? [...videoTrack.clips]
          .filter((c): c is VideoClip => c.type === 'video')
          .sort((a, b) => a.start - b.start)
      : [];

  // Fast mode shortcut when project has 1 untouched video clip and no active tools/presets
  if (isSingleSimpleVideoClipProject(project) && videoClips.length === 1) {
    const vc = videoClips[0];
    const asset = assets.get(vc.assetId);
    const start = Math.max(0, vc.sourceOffset);
    const end = Math.min(vc.sourceDuration, vc.sourceOffset + vc.duration);
    return {
      args: buildFfmpegArgs({
        start,
        end,
        duration: vc.sourceDuration,
        mode: project.exportMode,
      }),
      textFiles: [],
      extraMediaFiles:
        asset && asset.kind === 'video'
          ? [{ internalPath: INTERNAL_INPUT_FILENAME, file: asset.file }]
          : [],
      requiresFont: false,
      effectiveMode: project.exportMode,
      forcedPrecise: false,
      outputDuration: end - start,
      isAudioOnly: false,
    };
  }

  const isAudioOnly = project.exportSettings.audioOnlyMp3;
  const quality = getQualitySettings(project.exportSettings.quality);
  const canvasFit: CanvasFitMode = project.exportSettings.canvasFit ?? 'fit';
  const exportFps = project.exportSettings.fps ?? DEFAULT_EXPORT_FPS;
  const projectDuration = Math.max(0.5, getProjectDuration(project));

  const canvasDims = resolveProjectCanvasDimensions({
    project,
    assets,
    videoClips,
    videoWidth: params.videoWidth,
    videoHeight: params.videoHeight,
  });

  const videoTrackMuted = Boolean(videoTrack?.muted);
  const allTrackVideoClips = (videoTrack?.clips ?? [])
    .filter((c): c is VideoClip => c.type === 'video')
    .sort((a, b) => a.start - b.start);

  const doesVideoClipHaveAudio = (vc: VideoClip): boolean => {
    if (videoTrackMuted || vc.muted || vc.volumePercent <= 0) return false;
    if (videoAudioPresence) {
      return videoAudioPresence.get(vc.assetId) ?? true;
    }
    return hasSourceAudio;
  };

  const anyVideoAudio = allTrackVideoClips.some(doesVideoClipHaveAudio);

  // Register unique video inputs ONCE (for video track visual or audio output)
  const extraMediaFiles: ExtraMediaFile[] = [];
  const inputFileArgs: string[] = [];
  const videoAssetInputMap = new Map<string, { inputIdx: number; internalPath: string }>();
  let nextInputIdx = 0;

  const videoAssetsNeeded = isAudioOnly
    ? allTrackVideoClips.filter(doesVideoClipHaveAudio)
    : videoClips;

  for (const vc of videoAssetsNeeded) {
    if (videoAssetInputMap.has(vc.assetId)) continue;
    const asset = assets.get(vc.assetId);
    if (!asset || asset.kind !== 'video') continue;
    const internalPath = `vid_src_${videoAssetInputMap.size}.${asset.extension}`;
    const inputIdx = nextInputIdx++;
    videoAssetInputMap.set(vc.assetId, { inputIdx, internalPath });
    extraMediaFiles.push({ internalPath, file: asset.file });
    inputFileArgs.push('-i', internalPath);
  }

  // Register audio track clips
  const activeAudioEntries: Array<{
    clip: AudioClip;
    inputIdx: number;
    internalPath: string;
  }> = [];

  for (const track of project.tracks) {
    if (track.kind !== 'audio' || track.muted) continue;
    for (const clip of [...track.clips].sort((a, b) => a.start - b.start)) {
      if (clip.type !== 'audio' || clip.muted || clip.volumePercent <= 0) continue;
      const asset = assets.get(clip.assetId);
      if (!asset || asset.kind !== 'audio') continue;
      const internalPath = `audio_clip_${activeAudioEntries.length}.${clip.format}`;
      const inputIdx = nextInputIdx++;
      extraMediaFiles.push({ internalPath, file: asset.file });
      if (clip.loop) {
        inputFileArgs.push('-stream_loop', '-1');
      }
      inputFileArgs.push('-i', internalPath);
      activeAudioEntries.push({ clip, inputIdx, internalPath });
    }
  }

  // Register unique image assets ONCE (and reuse inputIdx if reused across clips)
  const imageAssetInputMap = new Map<string, { inputIdx: number; internalPath: string }>();
  const activeImageEntries: Array<{
    clip: ImageClip;
    inputIdx: number;
  }> = [];

  if (!isAudioOnly) {
    for (const track of project.tracks) {
      if (track.kind !== 'image' || track.hidden) continue;
      for (const clip of [...track.clips].sort((a, b) => a.start - b.start)) {
        if (clip.type !== 'image') continue;
        const asset = assets.get(clip.assetId);
        if (!asset || asset.kind !== 'image') continue;
        let mapped = imageAssetInputMap.get(clip.assetId);
        if (!mapped) {
          const internalPath = `overlay_img_${imageAssetInputMap.size}.${clip.format}`;
          const inputIdx = nextInputIdx++;
          mapped = { inputIdx, internalPath };
          imageAssetInputMap.set(clip.assetId, mapped);
          extraMediaFiles.push({ internalPath, file: asset.file });
          inputFileArgs.push('-i', internalPath);
        }
        activeImageEntries.push({ clip, inputIdx: mapped.inputIdx });
      }
    }
  }

  const activeTextClips: Array<{ clip: TextClip; isCaption: boolean }> = [];
  if (!isAudioOnly) {
    for (const track of project.tracks) {
      if ((track.kind !== 'text' && track.kind !== 'captions') || track.hidden) continue;
      for (const clip of [...track.clips].sort((a, b) => a.start - b.start)) {
        if (clip.type !== 'text') continue;
        if (sanitizeProjectTextContent(clip.text).length === 0) continue;
        activeTextClips.push({ clip, isCaption: track.kind === 'captions' });
      }
    }
  }

  const args: string[] = [...inputFileArgs];
  const filterParts: string[] = [];
  const textFiles: VirtualTextFile[] = [];

  // 1. Compile ripple video track clips (per-clip trim, transforms, Fit/Fill scale, fps, fades -> concat)
  let videoLabel: string | null = null;
  if (!isAudioOnly) {
    const videoSegLabels: string[] = [];
    let cursor = 0;

    videoClips.forEach((vc, segIdx) => {
      const mapped = videoAssetInputMap.get(vc.assetId);
      if (!mapped) return;

      const gap = vc.start - cursor;
      if (gap > 0.02) {
        const gapLbl = `[vgap${segIdx}]`;
        filterParts.push(
          `color=c=black:s=${canvasDims.width}x${canvasDims.height}:d=${formatSecondsArg(gap)}:r=${exportFps},setsar=1${gapLbl}`
        );
        videoSegLabels.push(gapLbl);
      }

      const srcStart = Math.max(0, vc.sourceOffset);
      const srcEnd = Math.min(vc.sourceDuration, vc.sourceOffset + vc.duration * vc.speed);
      const steps: string[] = [
        `trim=start=${formatSecondsArg(srcStart)}:end=${formatSecondsArg(srcEnd)}`,
        'setpts=PTS-STARTPTS',
      ];

      const cropFilter = getCropFilter(vc.cropAspect);
      if (cropFilter) steps.push(cropFilter);

      if (vc.rotationDegrees === 90) {
        steps.push('transpose=1');
      } else if (vc.rotationDegrees === 180) {
        steps.push('transpose=1', 'transpose=1');
      } else if (vc.rotationDegrees === 270) {
        steps.push('transpose=2');
      }
      if (vc.flipHorizontal) steps.push('hflip');

      if (vc.speed === 0.5) {
        steps.push('setpts=2.0*PTS');
      } else if (vc.speed === 1.5) {
        steps.push('setpts=0.666667*PTS');
      } else if (vc.speed === 2) {
        steps.push('setpts=0.5*PTS');
      }

      if (hasActiveColorFilter(vc.colorFilter)) {
        const { brightness, contrast, saturation, preset } = vc.colorFilter;
        if (
          Math.abs(brightness) > 1e-6 ||
          Math.abs(contrast - 1) > 1e-6 ||
          Math.abs(saturation - 1) > 1e-6
        ) {
          steps.push(
            `eq=brightness=${brightness.toFixed(2)}:contrast=${contrast.toFixed(2)}:saturation=${saturation.toFixed(2)}`
          );
        }
        if (preset === 'bw') {
          steps.push('hue=s=0');
        } else if (preset === 'warm') {
          steps.push('colorbalance=rs=0.08:gs=0.02:bs=-0.08');
        } else if (preset === 'cool') {
          steps.push('colorbalance=rs=-0.08:gs=0.02:bs=0.08');
        }
      }

      // Fit (black bars) vs Fill (crop to fill canvas)
      if (canvasFit === 'fill') {
        steps.push(
          `scale=${canvasDims.width}:${canvasDims.height}:force_original_aspect_ratio=increase`,
          `crop=${canvasDims.width}:${canvasDims.height}:(iw-ow)/2:(ih-oh)/2`
        );
      } else {
        steps.push(
          `scale=${canvasDims.width}:${canvasDims.height}:force_original_aspect_ratio=decrease`,
          `pad=${canvasDims.width}:${canvasDims.height}:(ow-iw)/2:(oh-ih)/2:black`
        );
      }
      steps.push(`fps=${exportFps}`, 'setsar=1');

      if (vc.fadeInSeconds > 0) {
        steps.push(`fade=t=in:st=0:d=${formatSecondsArg(vc.fadeInSeconds)}`);
      }
      if (vc.fadeOutSeconds > 0) {
        const st = Math.max(0, vc.duration - vc.fadeOutSeconds);
        steps.push(`fade=t=out:st=${formatSecondsArg(st)}:d=${formatSecondsArg(vc.fadeOutSeconds)}`);
      }

      const segLbl = `[vseg${segIdx}]`;
      filterParts.push(`[${mapped.inputIdx}:v]${steps.join(',')}${segLbl}`);
      videoSegLabels.push(segLbl);
      cursor = Math.max(cursor, vc.start + vc.duration);
    });

    if (videoSegLabels.length === 1) {
      videoLabel = videoSegLabels[0];
    } else if (videoSegLabels.length > 1) {
      filterParts.push(
        `${videoSegLabels.join('')}concat=n=${videoSegLabels.length}:v=1:a=0[vbase]`
      );
      videoLabel = '[vbase]';
    }

    // 2. Image overlay clips
    activeImageEntries.forEach((entry, idx) => {
      if (!videoLabel) return;
      const { clip, inputIdx } = entry;
      const targetWidth = Math.max(
        2,
        Math.round(((canvasDims.width * clip.sizePercent) / 100) / 2) * 2
      );
      const opacity = (clip.opacityPercent / 100).toFixed(2);
      const xFactor = (clip.xPercent / 100).toFixed(3);
      const yFactor = (clip.yPercent / 100).toFixed(3);
      const s = formatSecondsArg(clip.start);
      const e = formatSecondsArg(clip.start + clip.duration);

      filterParts.push(
        `[${inputIdx}:v]format=rgba,colorchannelmixer=aa=${opacity},scale=${targetWidth}:-2[ovimg${idx}]`
      );
      filterParts.push(
        `${videoLabel}[ovimg${idx}]overlay=x=(W-w)*${xFactor}:y=(H-h)*${yFactor}:enable='between(t,${s},${e})'[vimg${idx}]`
      );
      videoLabel = `[vimg${idx}]`;
    });

    // 3. Text & caption clips via drawtext + textfile=
    if (activeTextClips.length > 0 && videoLabel) {
      const drawFilters: string[] = [];
      activeTextClips.forEach(({ clip, isCaption }, idx) => {
        const filename = `text_${idx}.txt`;
        const cleaned = sanitizeProjectTextContent(clip.text);
        textFiles.push({
          path: filename,
          content: isCaption ? wrapCaptionTextForBurnIn(cleaned) : cleaned,
        });

        const fontSize = getTextFontSize(clip.size, canvasDims.height);
        const contrastOrBox = getTextContrastOrBox(clip, clip.color);
        const xFactor = (clip.xPercent / 100).toFixed(3);
        const yFactor = (clip.yPercent / 100).toFixed(3);
        const xExpr =
          clip.align === 'left'
            ? `w*${xFactor}`
            : clip.align === 'right'
              ? `w*${xFactor}-text_w`
              : `w*${xFactor}-text_w/2`;
        const yExpr = `h*${yFactor}-text_h/2`;
        const s = formatSecondsArg(clip.start);
        const e = formatSecondsArg(clip.start + clip.duration);

        drawFilters.push(
          `drawtext=fontfile=${INTERNAL_FONT_FILENAME}:textfile=${filename}:expansion=none:fontsize=${fontSize}:fontcolor=${clip.color}:${contrastOrBox}:x=${xExpr}:y=${yExpr}:enable='between(t,${s},${e})'`
        );
      });

      filterParts.push(`${videoLabel}${drawFilters.join(',')}[vtext]`);
      videoLabel = '[vtext]';
    }
  }

  // 4. Audio compilation (video track clips with silence fallback for silent clips + audio track clips -> amix)
  const audioMixInputs: string[] = [];

  if (anyVideoAudio && allTrackVideoClips.length > 0) {
    const segAudioLabels: string[] = [];
    let aCursor = 0;

    allTrackVideoClips.forEach((vc, aIdx) => {
      const gap = vc.start - aCursor;
      if (gap > 0.02) {
        const gapLbl = `[agap${aIdx}]`;
        filterParts.push(`anullsrc=r=44100:cl=stereo:d=${formatSecondsArg(gap)}${gapLbl}`);
        segAudioLabels.push(gapLbl);
      }

      const lbl = `[aseg${aIdx}]`;
      const mapped = videoAssetInputMap.get(vc.assetId);

      if (doesVideoClipHaveAudio(vc) && mapped) {
        const srcStart = Math.max(0, vc.sourceOffset);
        const srcEnd = Math.min(vc.sourceDuration, vc.sourceOffset + vc.duration * vc.speed);
        const aSteps: string[] = [
          `atrim=start=${formatSecondsArg(srcStart)}:end=${formatSecondsArg(srcEnd)}`,
          'asetpts=PTS-STARTPTS',
          'aformat=sample_rates=44100:channel_layouts=stereo',
          'aresample=async=1',
        ];
        if (vc.volumePercent !== 100) {
          aSteps.push(`volume=${(vc.volumePercent / 100).toFixed(2)}`);
        }
        if (vc.speed === 0.5) {
          aSteps.push('atempo=0.5');
        } else if (vc.speed === 1.5) {
          aSteps.push('atempo=1.5');
        } else if (vc.speed === 2) {
          aSteps.push('atempo=2.0');
        }
        if (vc.fadeInSeconds > 0) {
          aSteps.push(`afade=t=in:st=0:d=${formatSecondsArg(vc.fadeInSeconds)}`);
        }
        if (vc.fadeOutSeconds > 0) {
          const st = Math.max(0, vc.duration - vc.fadeOutSeconds);
          aSteps.push(`afade=t=out:st=${formatSecondsArg(st)}:d=${formatSecondsArg(vc.fadeOutSeconds)}`);
        }
        filterParts.push(`[${mapped.inputIdx}:a]${aSteps.join(',')}${lbl}`);
      } else {
        // Insert silence matching this clip's timeline duration
        filterParts.push(
          `anullsrc=r=44100:cl=stereo:d=${formatSecondsArg(vc.duration)}${lbl}`
        );
      }

      segAudioLabels.push(lbl);
      aCursor = Math.max(aCursor, vc.start + vc.duration);
    });

    if (segAudioLabels.length === 1) {
      audioMixInputs.push(segAudioLabels[0]);
    } else if (segAudioLabels.length > 1) {
      filterParts.push(
        `${segAudioLabels.join('')}concat=n=${segAudioLabels.length}:v=0:a=1[aorig]`
      );
      audioMixInputs.push('[aorig]');
    }
  }

  activeAudioEntries.forEach((entry, idx) => {
    const { clip, inputIdx } = entry;
    const steps: string[] = ['aformat=sample_rates=44100:channel_layouts=stereo'];
    if (clip.loop) {
      steps.push(`atrim=0:${formatSecondsArg(clip.duration)}`, 'asetpts=PTS-STARTPTS');
    } else {
      const aStart = Math.max(0, clip.sourceOffset);
      const aEnd = Math.min(clip.sourceDuration, clip.sourceOffset + clip.duration);
      steps.push(
        `atrim=start=${formatSecondsArg(aStart)}:end=${formatSecondsArg(aEnd)}`,
        'asetpts=PTS-STARTPTS'
      );
    }

    if (clip.volumePercent !== 100) {
      steps.push(`volume=${(clip.volumePercent / 100).toFixed(2)}`);
    }
    if (clip.fadeInSeconds > 0) {
      steps.push(`afade=t=in:st=0:d=${formatSecondsArg(clip.fadeInSeconds)}`);
    }
    if (clip.fadeOutSeconds > 0) {
      const fadeOutSt = Math.max(0, clip.duration - clip.fadeOutSeconds);
      steps.push(`afade=t=out:st=${formatSecondsArg(fadeOutSt)}:d=${formatSecondsArg(clip.fadeOutSeconds)}`);
    }
    const delayMs = Math.round(clip.start * 1000);
    if (delayMs > 0) {
      steps.push(`adelay=${delayMs}|${delayMs}`);
    }

    const lbl = `[atrk${idx}]`;
    filterParts.push(`[${inputIdx}:a]${steps.join(',')}${lbl}`);
    audioMixInputs.push(lbl);
  });

  let finalAudioLabel: string | null = null;
  if (audioMixInputs.length === 1) {
    filterParts.push(
      `${audioMixInputs[0]}atrim=0:${formatSecondsArg(projectDuration)},asetpts=PTS-STARTPTS[afinal]`
    );
    finalAudioLabel = '[afinal]';
  } else if (audioMixInputs.length > 1) {
    filterParts.push(
      `${audioMixInputs.join('')}amix=inputs=${audioMixInputs.length}:duration=longest:dropout_transition=0:normalize=0,atrim=0:${formatSecondsArg(projectDuration)},asetpts=PTS-STARTPTS[afinal]`
    );
    finalAudioLabel = '[afinal]';
  }

  if (isAudioOnly && !finalAudioLabel) {
    throw new Error(
      'No audio stream is available to export as MP3 (video track audio is muted or silent, and no audio clips exist).'
    );
  }

  if (filterParts.length > 0) {
    args.push('-filter_complex', filterParts.join(';'));
  }

  if (isAudioOnly) {
    args.push(
      '-vn',
      '-map',
      finalAudioLabel!,
      '-c:a',
      'libmp3lame',
      '-b:a',
      quality.mp3Bitrate,
      INTERNAL_OUTPUT_AUDIO_FILENAME
    );

    return {
      args,
      textFiles: [],
      extraMediaFiles,
      requiresFont: false,
      effectiveMode: 'precise',
      forcedPrecise: project.exportMode !== 'precise',
      outputDuration: projectDuration,
      isAudioOnly: true,
    };
  }

  if (videoLabel) {
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
    args.push('-map', finalAudioLabel, '-c:a', 'aac', '-b:a', quality.aacBitrate);
  }

  args.push('-movflags', '+faststart', INTERNAL_OUTPUT_FILENAME);

  return {
    args,
    textFiles,
    extraMediaFiles,
    requiresFont: textFiles.length > 0,
    effectiveMode: 'precise',
    forcedPrecise: project.exportMode !== 'precise',
    outputDuration: projectDuration,
    isAudioOnly: false,
  };
}
