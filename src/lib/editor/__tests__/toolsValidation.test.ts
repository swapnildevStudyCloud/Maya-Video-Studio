import { describe, expect, it } from 'vitest';
import {
  hasActiveEditingTools,
  validateAddedAudioConfig,
  validateAudioSettings,
  validateColorFilterConfig,
  validateCropAspect,
  validateEditToolsConfig,
  validateExportSettings,
  validateFadeSettings,
  validateFontBytes,
  validateImageOverlayConfig,
  validatePlaybackSpeed,
  validateRotationAndFlip,
  validateTextOverlays,
} from '../toolsValidation';
import {
  createDefaultAddedAudio,
  createDefaultEditTools,
  createDefaultImageOverlay,
  MAX_TEXT_OVERLAY_LENGTH,
  MIN_FONT_SIZE_BYTES,
} from '../types';

describe('toolsValidation', () => {
  it('recognizes default tools as inactive and any active tool as active', () => {
    const base = createDefaultEditTools();
    expect(hasActiveEditingTools(base)).toBe(false);
    expect(hasActiveEditingTools({ ...base, speed: 2 })).toBe(true);
    expect(hasActiveEditingTools({ ...base, cropAspect: '9:16' })).toBe(true);
    expect(hasActiveEditingTools({ ...base, rotationDegrees: 90 })).toBe(true);
    expect(hasActiveEditingTools({ ...base, flipHorizontal: true })).toBe(true);
    expect(hasActiveEditingTools({ ...base, audio: { muted: true, volumePercent: 100 } })).toBe(true);
    expect(hasActiveEditingTools({ ...base, audio: { muted: false, volumePercent: 150 } })).toBe(true);
    expect(hasActiveEditingTools({ ...base, fade: { fadeInSeconds: 0.5, fadeOutSeconds: 0 } })).toBe(true);
    expect(
      hasActiveEditingTools({
        ...base,
        colorFilter: { preset: 'warm', brightness: 0, contrast: 1, saturation: 1 },
      })
    ).toBe(true);
    expect(
      hasActiveEditingTools({
        ...base,
        colorFilter: { preset: 'none', brightness: 0.1, contrast: 1, saturation: 1 },
      })
    ).toBe(true);
    expect(
      hasActiveEditingTools({
        ...base,
        exportSettings: { resolution: '720p', quality: 'balanced', audioOnlyMp3: false },
      })
    ).toBe(true);
    expect(
      hasActiveEditingTools({
        ...base,
        exportSettings: { resolution: 'original', quality: 'balanced', audioOnlyMp3: true },
      })
    ).toBe(true);
    expect(
      hasActiveEditingTools({
        ...base,
        burnCaptions: true,
        captions: [{ id: 'c1', start: 0, end: 1, text: 'Hi' }],
      })
    ).toBe(true);
  });

  it('throws "font file missing" when font.ttf is missing or smaller than 1 KB', () => {
    expect(() => validateFontBytes(null)).toThrow(/font file missing/i);
    expect(() => validateFontBytes(new Uint8Array(0))).toThrow(/font file missing/i);
    expect(() => validateFontBytes(new Uint8Array(MIN_FONT_SIZE_BYTES - 1))).toThrow(
      /font file missing/i
    );
    expect(() => validateFontBytes(new Uint8Array(MIN_FONT_SIZE_BYTES))).not.toThrow();
  });

  it('validates playback speed from fixed list', () => {
    expect(validatePlaybackSpeed(0.5).ok).toBe(true);
    expect(validatePlaybackSpeed(1).ok).toBe(true);
    expect(validatePlaybackSpeed(1.5).ok).toBe(true);
    expect(validatePlaybackSpeed(2).ok).toBe(true);
    expect(validatePlaybackSpeed(1.25).ok).toBe(false);
    expect(validatePlaybackSpeed(Number.NaN).ok).toBe(false);
  });

  it('validates audio mute and 0-200% volume', () => {
    expect(validateAudioSettings({ muted: false, volumePercent: 0 }).ok).toBe(true);
    expect(validateAudioSettings({ muted: true, volumePercent: 200 }).ok).toBe(true);
    expect(validateAudioSettings({ muted: false, volumePercent: -1 }).ok).toBe(false);
    expect(validateAudioSettings({ muted: false, volumePercent: 201 }).ok).toBe(false);
    expect(validateAudioSettings({ muted: false, volumePercent: Number.NaN }).ok).toBe(false);
  });

  it('validates added audio offset, volume, and 0-3s fades', () => {
    const dummyAudioFile = new File([new Uint8Array(16)], 'music.mp3', { type: 'audio/mpeg' });
    const base = {
      ...createDefaultAddedAudio(),
      file: dummyAudioFile,
      name: 'music.mp3',
      format: 'mp3' as const,
      startOffsetSeconds: 2,
      volumePercent: 120,
      loopToVideo: true,
      fadeInSeconds: 1.5,
      fadeOutSeconds: 3,
    };

    expect(validateAddedAudioConfig(base, 10).ok).toBe(true);
    expect(validateAddedAudioConfig({ ...base, startOffsetSeconds: -0.5 }, 10).ok).toBe(false);
    expect(validateAddedAudioConfig({ ...base, startOffsetSeconds: 10 }, 10).ok).toBe(false);
    expect(validateAddedAudioConfig({ ...base, volumePercent: 201 }, 10).ok).toBe(false);
    expect(validateAddedAudioConfig({ ...base, fadeOutSeconds: 3.1 }, 10).ok).toBe(false);
  });

  it('validates image overlay size (5-50%), opacity, position, and timing', () => {
    const dummyImgFile = new File([new Uint8Array(16)], 'logo.png', { type: 'image/png' });
    const base = {
      ...createDefaultImageOverlay(),
      file: dummyImgFile,
      name: 'logo.png',
      format: 'png' as const,
      position: 'bottom-right' as const,
      sizePercent: 25,
      opacityPercent: 80,
      start: 0.5,
      end: 5,
    };

    expect(validateImageOverlayConfig(base, 10).ok).toBe(true);
    expect(validateImageOverlayConfig({ ...base, sizePercent: 4 }, 10).ok).toBe(false);
    expect(validateImageOverlayConfig({ ...base, sizePercent: 51 }, 10).ok).toBe(false);
    expect(validateImageOverlayConfig({ ...base, opacityPercent: 101 }, 10).ok).toBe(false);
    expect(validateImageOverlayConfig({ ...base, start: 5, end: 5 }, 10).ok).toBe(false);
    expect(validateImageOverlayConfig({ ...base, end: 11 }, 10).ok).toBe(false);
  });

  it('validates color filters and export settings presets', () => {
    expect(
      validateColorFilterConfig({ preset: 'bw', brightness: 0.2, contrast: 1.2, saturation: 0.5 })
        .ok
    ).toBe(true);
    expect(
      validateColorFilterConfig({ preset: 'none', brightness: 0.6, contrast: 1, saturation: 1 }).ok
    ).toBe(false);
    expect(
      validateColorFilterConfig({ preset: 'none', brightness: 0, contrast: 0.4, saturation: 1 }).ok
    ).toBe(false);
    expect(
      validateColorFilterConfig({ preset: 'none', brightness: 0, contrast: 1, saturation: 2.5 }).ok
    ).toBe(false);

    expect(
      validateExportSettings({ resolution: '1080p', quality: 'high', audioOnlyMp3: false }).ok
    ).toBe(true);
    expect(
      validateExportSettings({ resolution: '4k' as never, quality: 'high', audioOnlyMp3: false }).ok
    ).toBe(false);
  });

  it('validates rotation and flip', () => {
    expect(validateRotationAndFlip(0, false).ok).toBe(true);
    expect(validateRotationAndFlip(90, true).ok).toBe(true);
    expect(validateRotationAndFlip(270, false).ok).toBe(true);
    expect(validateRotationAndFlip(45, false).ok).toBe(false);
  });

  it('validates crop aspect ratio', () => {
    expect(validateCropAspect('original').ok).toBe(true);
    expect(validateCropAspect('9:16').ok).toBe(true);
    expect(validateCropAspect('1:1').ok).toBe(true);
    expect(validateCropAspect('16:9').ok).toBe(true);
    expect(validateCropAspect('4:3').ok).toBe(false);
  });

  it('validates fade in and fade out within 0-2s and clip length', () => {
    expect(validateFadeSettings({ fadeInSeconds: 2, fadeOutSeconds: 2 }, 5).ok).toBe(true);
    expect(validateFadeSettings({ fadeInSeconds: -0.1, fadeOutSeconds: 0 }, 5).ok).toBe(false);
    expect(validateFadeSettings({ fadeInSeconds: 2.1, fadeOutSeconds: 0 }, 5).ok).toBe(false);
    expect(validateFadeSettings({ fadeInSeconds: 2, fadeOutSeconds: 2 }, 3).ok).toBe(false);
  });

  it('validates text overlays count, length, bounds, and enums', () => {
    const valid = validateTextOverlays(
      [
        {
          id: '1',
          text: 'Hello World',
          start: 0,
          end: 3,
          position: 'top',
          size: 'medium',
          color: 'yellow',
        },
      ],
      10
    );
    expect(valid.ok).toBe(true);

    // > 5 overlays rejected
    const six = Array.from({ length: 6 }, (_, i) => ({
      id: `${i}`,
      text: 'Hi',
      start: 0,
      end: 1,
      position: 'center' as const,
      size: 'small' as const,
      color: 'white' as const,
    }));
    expect(validateTextOverlays(six, 10).ok).toBe(false);

    // > 80 chars rejected
    expect(
      validateTextOverlays(
        [
          {
            id: '1',
            text: 'a'.repeat(MAX_TEXT_OVERLAY_LENGTH + 1),
            start: 0,
            end: 2,
            position: 'bottom',
            size: 'large',
            color: 'black',
          },
        ],
        10
      ).ok
    ).toBe(false);

    // Empty text rejected
    expect(
      validateTextOverlays(
        [
          {
            id: '1',
            text: '   ',
            start: 0,
            end: 2,
            position: 'bottom',
            size: 'large',
            color: 'white',
          },
        ],
        10
      ).ok
    ).toBe(false);

    // Beyond output duration rejected
    expect(
      validateTextOverlays(
        [
          {
            id: '1',
            text: 'Late',
            start: 1,
            end: 6,
            position: 'top',
            size: 'small',
            color: 'white',
          },
        ],
        5
      ).ok
    ).toBe(false);
  });

  it('validates combined tools against speed-adjusted output duration', () => {
    const tools = createDefaultEditTools();
    tools.speed = 2; // 10s clip becomes 5s output
    tools.textOverlays = [
      {
        id: '1',
        text: 'Too late at 2x',
        start: 0,
        end: 8,
        position: 'center',
        size: 'medium',
        color: 'white',
      },
    ];
    expect(validateEditToolsConfig(tools, 10).ok).toBe(false);

    tools.textOverlays[0].end = 4.5;
    expect(validateEditToolsConfig(tools, 10).ok).toBe(true);
  });
});
