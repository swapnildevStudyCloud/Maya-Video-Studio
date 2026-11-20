import {
  ALLOWED_COLOR_PRESETS,
  ALLOWED_CROP_ASPECTS,
  ALLOWED_EXPORT_QUALITIES,
  ALLOWED_EXPORT_RESOLUTIONS,
  ALLOWED_IMAGE_POSITIONS,
  ALLOWED_OVERLAY_COLORS,
  ALLOWED_OVERLAY_POSITIONS,
  ALLOWED_OVERLAY_SIZES,
  ALLOWED_ROTATIONS,
  ALLOWED_SPEEDS,
  MAX_ADDED_AUDIO_FADE_SECONDS,
  MAX_CAPTION_SEGMENTS,
  MAX_CAPTION_TEXT_LENGTH,
  MAX_FADE_SECONDS,
  MAX_IMAGE_SIZE_PERCENT,
  MAX_TEXT_OVERLAY_LENGTH,
  MAX_TEXT_OVERLAYS,
  MAX_VOLUME_PERCENT,
  MIN_FONT_SIZE_BYTES,
  MIN_IMAGE_SIZE_PERCENT,
  MIN_VOLUME_PERCENT,
  type AddedAudioConfig,
  type AudioSettings,
  type CaptionSegment,
  type ColorFilterConfig,
  type CropAspectRatio,
  type EditToolsConfig,
  type ExportSettings,
  type FadeSettings,
  type ImageOverlayConfig,
  type PlaybackSpeed,
  type RotationDegrees,
  type TextOverlay,
  type ValidationResult,
} from './types';

export function validateFontBytes(bytes: Uint8Array | null | undefined): void {
  if (!bytes || bytes.byteLength < MIN_FONT_SIZE_BYTES) {
    throw new Error('font file missing: public/ffmpeg/font.ttf is missing or smaller than 1 KB.');
  }
}

export function hasActiveColorFilter(color: ColorFilterConfig): boolean {
  return (
    color.preset !== 'none' ||
    Math.abs(color.brightness) > 1e-6 ||
    Math.abs(color.contrast - 1) > 1e-6 ||
    Math.abs(color.saturation - 1) > 1e-6
  );
}

export function hasActiveEditingTools(tools: EditToolsConfig): boolean {
  if (tools.textOverlays.length > 0) return true;
  if (tools.speed !== 1) return true;
  if (tools.audio.muted || tools.audio.volumePercent !== 100) return true;
  if (tools.addedAudio.file !== null) return true;
  if (tools.imageOverlay.file !== null) return true;
  if (hasActiveColorFilter(tools.colorFilter)) return true;
  if (tools.rotationDegrees !== 0 || tools.flipHorizontal) return true;
  if (tools.cropAspect !== 'original') return true;
  if (tools.fade.fadeInSeconds > 0 || tools.fade.fadeOutSeconds > 0) return true;
  if (tools.burnCaptions && tools.captions.length > 0) return true;
  if (tools.exportSettings.resolution !== 'original') return true;
  if (tools.exportSettings.quality !== 'balanced') return true;
  if (tools.exportSettings.audioOnlyMp3) return true;
  return false;
}

export function sanitizeOverlayText(raw: string): string {
  return raw
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, ' ')
    .replace(/\r\n?/g, '\n')
    .slice(0, MAX_TEXT_OVERLAY_LENGTH);
}

export function validatePlaybackSpeed(speed: number): ValidationResult<PlaybackSpeed> {
  if (!ALLOWED_SPEEDS.includes(speed as PlaybackSpeed)) {
    return {
      ok: false,
      code: 'INVALID_TOOL_CONFIG',
      error: 'Speed must be 0.5x, 1x, 1.5x, or 2x.',
    };
  }
  return { ok: true, value: speed as PlaybackSpeed };
}

export function validateAudioSettings(audio: AudioSettings): ValidationResult<AudioSettings> {
  if (typeof audio.muted !== 'boolean') {
    return {
      ok: false,
      code: 'INVALID_TOOL_CONFIG',
      error: 'Audio mute setting must be a boolean.',
    };
  }
  if (
    !Number.isFinite(audio.volumePercent) ||
    audio.volumePercent < MIN_VOLUME_PERCENT ||
    audio.volumePercent > MAX_VOLUME_PERCENT
  ) {
    return {
      ok: false,
      code: 'INVALID_TOOL_CONFIG',
      error: `Audio volume must be between ${MIN_VOLUME_PERCENT}% and ${MAX_VOLUME_PERCENT}%.`,
    };
  }
  return {
    ok: true,
    value: {
      muted: audio.muted,
      volumePercent: Math.round(audio.volumePercent),
    },
  };
}

export function validateAddedAudioConfig(
  addedAudio: AddedAudioConfig,
  outputDuration: number
): ValidationResult<AddedAudioConfig> {
  if (!addedAudio.file || !addedAudio.format) {
    return { ok: true, value: addedAudio };
  }
  if (!Number.isFinite(addedAudio.startOffsetSeconds) || addedAudio.startOffsetSeconds < 0) {
    return {
      ok: false,
      code: 'INVALID_TOOL_CONFIG',
      error: 'Added sound start offset must be 0 or greater.',
    };
  }
  if (addedAudio.startOffsetSeconds >= outputDuration) {
    return {
      ok: false,
      code: 'INVALID_TOOL_CONFIG',
      error: `Added sound start offset must be earlier than the output length (${outputDuration.toFixed(2)} s).`,
    };
  }
  if (
    !Number.isFinite(addedAudio.volumePercent) ||
    addedAudio.volumePercent < MIN_VOLUME_PERCENT ||
    addedAudio.volumePercent > MAX_VOLUME_PERCENT
  ) {
    return {
      ok: false,
      code: 'INVALID_TOOL_CONFIG',
      error: 'Added sound volume must be between 0% and 200%.',
    };
  }
  if (
    !Number.isFinite(addedAudio.fadeInSeconds) ||
    !Number.isFinite(addedAudio.fadeOutSeconds) ||
    addedAudio.fadeInSeconds < 0 ||
    addedAudio.fadeInSeconds > MAX_ADDED_AUDIO_FADE_SECONDS ||
    addedAudio.fadeOutSeconds < 0 ||
    addedAudio.fadeOutSeconds > MAX_ADDED_AUDIO_FADE_SECONDS
  ) {
    return {
      ok: false,
      code: 'INVALID_TOOL_CONFIG',
      error: `Added sound fade in and fade out must each be between 0 and ${MAX_ADDED_AUDIO_FADE_SECONDS} seconds.`,
    };
  }
  return {
    ok: true,
    value: {
      ...addedAudio,
      volumePercent: Math.round(addedAudio.volumePercent),
    },
  };
}

export function validateImageOverlayConfig(
  imageOverlay: ImageOverlayConfig,
  outputDuration: number
): ValidationResult<ImageOverlayConfig> {
  if (!imageOverlay.file || !imageOverlay.format) {
    return { ok: true, value: imageOverlay };
  }
  if (!ALLOWED_IMAGE_POSITIONS.includes(imageOverlay.position)) {
    return {
      ok: false,
      code: 'INVALID_TOOL_CONFIG',
      error: 'Image overlay position must be a corner or center.',
    };
  }
  if (
    !Number.isFinite(imageOverlay.sizePercent) ||
    imageOverlay.sizePercent < MIN_IMAGE_SIZE_PERCENT ||
    imageOverlay.sizePercent > MAX_IMAGE_SIZE_PERCENT
  ) {
    return {
      ok: false,
      code: 'INVALID_TOOL_CONFIG',
      error: `Image overlay size must be between ${MIN_IMAGE_SIZE_PERCENT}% and ${MAX_IMAGE_SIZE_PERCENT}% of width.`,
    };
  }
  if (
    !Number.isFinite(imageOverlay.opacityPercent) ||
    imageOverlay.opacityPercent < 0 ||
    imageOverlay.opacityPercent > 100
  ) {
    return {
      ok: false,
      code: 'INVALID_TOOL_CONFIG',
      error: 'Image overlay opacity must be between 0% and 100%.',
    };
  }
  if (!Number.isFinite(imageOverlay.start) || !Number.isFinite(imageOverlay.end)) {
    return {
      ok: false,
      code: 'INVALID_TOOL_CONFIG',
      error: 'Image overlay start and end times must be finite numbers.',
    };
  }
  if (imageOverlay.start < 0 || imageOverlay.end < 0 || imageOverlay.start >= imageOverlay.end) {
    return {
      ok: false,
      code: 'INVALID_TOOL_CONFIG',
      error: 'Image overlay start time must be less than end time.',
    };
  }
  if (imageOverlay.end > outputDuration + 0.01) {
    return {
      ok: false,
      code: 'INVALID_TOOL_CONFIG',
      error: `Image overlay end time exceeds the output clip duration (${outputDuration.toFixed(2)} s).`,
    };
  }
  return {
    ok: true,
    value: {
      ...imageOverlay,
      end: Math.min(imageOverlay.end, outputDuration),
    },
  };
}

export function validateColorFilterConfig(
  colorFilter: ColorFilterConfig
): ValidationResult<ColorFilterConfig> {
  if (!ALLOWED_COLOR_PRESETS.includes(colorFilter.preset)) {
    return {
      ok: false,
      code: 'INVALID_TOOL_CONFIG',
      error: 'Color filter preset must be none, bw, warm, or cool.',
    };
  }
  if (
    !Number.isFinite(colorFilter.brightness) ||
    colorFilter.brightness < -0.5 ||
    colorFilter.brightness > 0.5
  ) {
    return {
      ok: false,
      code: 'INVALID_TOOL_CONFIG',
      error: 'Brightness must be between -0.5 and 0.5.',
    };
  }
  if (
    !Number.isFinite(colorFilter.contrast) ||
    colorFilter.contrast < 0.5 ||
    colorFilter.contrast > 1.5
  ) {
    return {
      ok: false,
      code: 'INVALID_TOOL_CONFIG',
      error: 'Contrast must be between 0.5 and 1.5.',
    };
  }
  if (
    !Number.isFinite(colorFilter.saturation) ||
    colorFilter.saturation < 0 ||
    colorFilter.saturation > 2
  ) {
    return {
      ok: false,
      code: 'INVALID_TOOL_CONFIG',
      error: 'Saturation must be between 0 and 2.',
    };
  }
  return { ok: true, value: colorFilter };
}

export function validateExportSettings(
  settings: ExportSettings
): ValidationResult<ExportSettings> {
  if (!ALLOWED_EXPORT_RESOLUTIONS.includes(settings.resolution)) {
    return {
      ok: false,
      code: 'INVALID_TOOL_CONFIG',
      error: 'Export resolution must be original, 1080p, 720p, or 480p.',
    };
  }
  if (!ALLOWED_EXPORT_QUALITIES.includes(settings.quality)) {
    return {
      ok: false,
      code: 'INVALID_TOOL_CONFIG',
      error: 'Export quality must be small, balanced, or high.',
    };
  }
  return {
    ok: true,
    value: {
      resolution: settings.resolution,
      quality: settings.quality,
      audioOnlyMp3: Boolean(settings.audioOnlyMp3),
    },
  };
}

export function validateRotationAndFlip(
  rotationDegrees: number,
  flipHorizontal: boolean
): ValidationResult<{ rotationDegrees: RotationDegrees; flipHorizontal: boolean }> {
  if (!ALLOWED_ROTATIONS.includes(rotationDegrees as RotationDegrees)) {
    return {
      ok: false,
      code: 'INVALID_TOOL_CONFIG',
      error: 'Rotation must be 0, 90, 180, or 270 degrees.',
    };
  }
  if (typeof flipHorizontal !== 'boolean') {
    return {
      ok: false,
      code: 'INVALID_TOOL_CONFIG',
      error: 'Flip setting must be a boolean.',
    };
  }
  return {
    ok: true,
    value: {
      rotationDegrees: rotationDegrees as RotationDegrees,
      flipHorizontal,
    },
  };
}

export function validateCropAspect(cropAspect: string): ValidationResult<CropAspectRatio> {
  if (!ALLOWED_CROP_ASPECTS.includes(cropAspect as CropAspectRatio)) {
    return {
      ok: false,
      code: 'INVALID_TOOL_CONFIG',
      error: 'Crop aspect ratio must be original, 9:16, 1:1, or 16:9.',
    };
  }
  return { ok: true, value: cropAspect as CropAspectRatio };
}

export function validateFadeSettings(
  fade: FadeSettings,
  outputDuration: number
): ValidationResult<FadeSettings> {
  if (!Number.isFinite(fade.fadeInSeconds) || !Number.isFinite(fade.fadeOutSeconds)) {
    return {
      ok: false,
      code: 'INVALID_TOOL_CONFIG',
      error: 'Fade durations must be finite numbers.',
    };
  }
  if (
    fade.fadeInSeconds < 0 ||
    fade.fadeInSeconds > MAX_FADE_SECONDS ||
    fade.fadeOutSeconds < 0 ||
    fade.fadeOutSeconds > MAX_FADE_SECONDS
  ) {
    return {
      ok: false,
      code: 'INVALID_TOOL_CONFIG',
      error: `Fade in and fade out must each be between 0 and ${MAX_FADE_SECONDS} seconds.`,
    };
  }
  if (fade.fadeInSeconds + fade.fadeOutSeconds > outputDuration + 1e-6) {
    return {
      ok: false,
      code: 'INVALID_TOOL_CONFIG',
      error: `Combined fade in/out (${(fade.fadeInSeconds + fade.fadeOutSeconds).toFixed(2)} s) cannot exceed the output clip length (${outputDuration.toFixed(2)} s).`,
    };
  }
  return {
    ok: true,
    value: {
      fadeInSeconds: fade.fadeInSeconds,
      fadeOutSeconds: fade.fadeOutSeconds,
    },
  };
}

export function validateTextOverlays(
  overlays: TextOverlay[],
  outputDuration: number
): ValidationResult<TextOverlay[]> {
  if (overlays.length > MAX_TEXT_OVERLAYS) {
    return {
      ok: false,
      code: 'INVALID_TOOL_CONFIG',
      error: `At most ${MAX_TEXT_OVERLAYS} text overlays are allowed.`,
    };
  }

  const validated: TextOverlay[] = [];
  for (let i = 0; i < overlays.length; i++) {
    const item = overlays[i];
    const label = `Text overlay #${i + 1}`;
    const cleanedText = sanitizeOverlayText(item.text).trim();

    if (cleanedText.length === 0) {
      return {
        ok: false,
        code: 'INVALID_TOOL_CONFIG',
        error: `${label} cannot be empty.`,
      };
    }

    if (item.text.length > MAX_TEXT_OVERLAY_LENGTH) {
      return {
        ok: false,
        code: 'INVALID_TOOL_CONFIG',
        error: `${label} cannot exceed ${MAX_TEXT_OVERLAY_LENGTH} characters.`,
      };
    }

    if (!Number.isFinite(item.start) || !Number.isFinite(item.end)) {
      return {
        ok: false,
        code: 'INVALID_TOOL_CONFIG',
        error: `${label} start and end times must be finite numbers.`,
      };
    }

    if (item.start < 0 || item.end < 0) {
      return {
        ok: false,
        code: 'INVALID_TOOL_CONFIG',
        error: `${label} times cannot be negative.`,
      };
    }

    if (item.start >= item.end) {
      return {
        ok: false,
        code: 'INVALID_TOOL_CONFIG',
        error: `${label} start time must be less than end time.`,
      };
    }

    if (item.end > outputDuration + 0.01) {
      return {
        ok: false,
        code: 'INVALID_TOOL_CONFIG',
        error: `${label} end time exceeds the output clip duration (${outputDuration.toFixed(2)} s).`,
      };
    }

    if (!ALLOWED_OVERLAY_POSITIONS.includes(item.position)) {
      return {
        ok: false,
        code: 'INVALID_TOOL_CONFIG',
        error: `${label} position must be top, center, or bottom.`,
      };
    }

    if (!ALLOWED_OVERLAY_SIZES.includes(item.size)) {
      return {
        ok: false,
        code: 'INVALID_TOOL_CONFIG',
        error: `${label} size must be small, medium, or large.`,
      };
    }

    if (!ALLOWED_OVERLAY_COLORS.includes(item.color)) {
      return {
        ok: false,
        code: 'INVALID_TOOL_CONFIG',
        error: `${label} color must be white, yellow, or black.`,
      };
    }

    validated.push({
      ...item,
      text: cleanedText,
      end: Math.min(item.end, outputDuration),
    });
  }

  return { ok: true, value: validated };
}

export function validateCaptionSegmentsForBurn(
  captions: CaptionSegment[],
  clipDuration: number
): ValidationResult<CaptionSegment[]> {
  if (captions.length > MAX_CAPTION_SEGMENTS) {
    return {
      ok: false,
      code: 'INVALID_TOOL_CONFIG',
      error: `At most ${MAX_CAPTION_SEGMENTS} caption segments can be burned into video.`,
    };
  }

  const sanitized: CaptionSegment[] = [];
  for (let i = 0; i < captions.length; i++) {
    const seg = captions[i];
    const label = `Caption #${i + 1}`;
    const cleaned = seg.text
      .replace(/[\u0000-\u001F\u007F]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_CAPTION_TEXT_LENGTH);

    if (!cleaned) {
      continue;
    }

    if (!Number.isFinite(seg.start) || !Number.isFinite(seg.end)) {
      return {
        ok: false,
        code: 'INVALID_TOOL_CONFIG',
        error: `${label} start and end must be finite numbers.`,
      };
    }

    const start = Math.max(0, Math.min(clipDuration, seg.start));
    const end = Math.max(0, Math.min(clipDuration, seg.end));
    if (start >= end) {
      return {
        ok: false,
        code: 'INVALID_TOOL_CONFIG',
        error: `${label} start time must be less than end time.`,
      };
    }

    sanitized.push({
      id: seg.id,
      start,
      end,
      text: cleaned,
    });
  }

  return { ok: true, value: sanitized };
}

export function validateEditToolsConfig(
  tools: EditToolsConfig,
  clipDuration: number
): ValidationResult<EditToolsConfig> {
  const speedRes = validatePlaybackSpeed(tools.speed);
  if (!speedRes.ok) return speedRes;

  const audioRes = validateAudioSettings(tools.audio);
  if (!audioRes.ok) return audioRes;

  const rotFlipRes = validateRotationAndFlip(tools.rotationDegrees, tools.flipHorizontal);
  if (!rotFlipRes.ok) return rotFlipRes;

  const cropRes = validateCropAspect(tools.cropAspect);
  if (!cropRes.ok) return cropRes;

  const colorRes = validateColorFilterConfig(tools.colorFilter);
  if (!colorRes.ok) return colorRes;

  const exportRes = validateExportSettings(tools.exportSettings);
  if (!exportRes.ok) return exportRes;

  const outputDuration = clipDuration / speedRes.value;

  const addedAudioRes = validateAddedAudioConfig(tools.addedAudio, outputDuration);
  if (!addedAudioRes.ok) return addedAudioRes;

  const imageOverlayRes = validateImageOverlayConfig(tools.imageOverlay, outputDuration);
  if (!imageOverlayRes.ok) return imageOverlayRes;

  const fadeRes = validateFadeSettings(tools.fade, outputDuration);
  if (!fadeRes.ok) return fadeRes;

  const overlayRes = validateTextOverlays(tools.textOverlays, outputDuration);
  if (!overlayRes.ok) return overlayRes;

  let validatedCaptions: CaptionSegment[] = tools.captions;
  if (tools.burnCaptions && tools.captions.length > 0) {
    const capRes = validateCaptionSegmentsForBurn(tools.captions, clipDuration);
    if (!capRes.ok) return capRes;
    validatedCaptions = capRes.value;
  }

  return {
    ok: true,
    value: {
      textOverlays: overlayRes.value,
      speed: speedRes.value,
      audio: audioRes.value,
      addedAudio: addedAudioRes.value,
      imageOverlay: imageOverlayRes.value,
      colorFilter: colorRes.value,
      rotationDegrees: rotFlipRes.value.rotationDegrees,
      flipHorizontal: rotFlipRes.value.flipHorizontal,
      cropAspect: cropRes.value,
      fade: fadeRes.value,
      burnCaptions: Boolean(tools.burnCaptions),
      captions: validatedCaptions,
      exportSettings: exportRes.value,
    },
  };
}
