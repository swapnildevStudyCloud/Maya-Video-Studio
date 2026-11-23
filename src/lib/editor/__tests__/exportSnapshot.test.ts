import { describe, expect, it } from 'vitest';
import {
  createEffectClip,
  createExportOutputFingerprint,
  createInitialEditorState,
  createVideoClipFromMeta,
  projectReducer,
  shouldInvalidateExportResult,
  type TextClip,
  type VideoFileMetadata,
} from '../index';

function makeVideoMeta(overrides: Partial<VideoFileMetadata> = {}): VideoFileMetadata {
  return {
    name: 'sample.mp4',
    size: 5_000_000,
    mimeType: 'video/mp4',
    extension: 'mp4',
    duration: 12,
    width: 1920,
    height: 1080,
    ...overrides,
  };
}

function buildBaselineEditorState() {
  let state = createInitialEditorState();
  const v1 = createVideoClipFromMeta(makeVideoMeta({ duration: 5 }), 'asset_1');
  const v2 = createVideoClipFromMeta(makeVideoMeta({ duration: 5 }), 'asset_2');
  state = projectReducer(state, { type: 'ADD_CLIP', clip: v1 });
  state = projectReducer(state, { type: 'ADD_CLIP', clip: v2 });

  const textClip: TextClip = {
    id: 'txt_1',
    type: 'text',
    name: 'Title',
    start: 1,
    duration: 3,
    sourceOffset: 0,
    text: 'Title',
    size: 'medium',
    color: 'white',
    backgroundBox: false,
    align: 'center',
    xPercent: 50,
    yPercent: 50,
  };
  state = projectReducer(state, { type: 'ADD_CLIP', clip: textClip });

  const effectClip = createEffectClip({
    id: 'efx_1',
    effectType: 'blur',
    start: 0.5,
    duration: 2,
    intensity: 50,
  });
  state = projectReducer(state, { type: 'ADD_CLIP', clip: effectClip });

  return { state, v1, v2, textClip, effectClip };
}

describe('Stale export result invalidation logic', () => {
  it('keeps the export result on selection, playhead, and zoom changes', () => {
    const { state: initialState, v1 } = buildBaselineEditorState();
    const exportedFingerprint = createExportOutputFingerprint(initialState.history.present);

    let next = projectReducer(initialState, { type: 'SELECT_CLIP', clipId: v1.id });
    expect(
      shouldInvalidateExportResult({
        hasResult: true,
        isExporting: false,
        exportedFingerprint,
        currentProject: next.history.present,
      })
    ).toBe(false);

    next = projectReducer(next, { type: 'SET_PLAYHEAD', time: 4.25 });
    next = projectReducer(next, { type: 'STEP_PLAYHEAD', deltaSeconds: 1 / 30 });
    expect(
      shouldInvalidateExportResult({
        hasResult: true,
        isExporting: false,
        exportedFingerprint,
        currentProject: next.history.present,
      })
    ).toBe(false);

    next = projectReducer(next, { type: 'SET_ZOOM', zoomPxPerSec: 120 });
    next = projectReducer(next, { type: 'TOGGLE_SNAP' });
    expect(
      shouldInvalidateExportResult({
        hasResult: true,
        isExporting: false,
        exportedFingerprint,
        currentProject: next.history.present,
      })
    ).toBe(false);
  });

  it('invalidates immediately when clips, tracks, effects, text, transitions, or export settings change', () => {
    const { state: base, v1, textClip, effectClip } = buildBaselineEditorState();
    const exportedFingerprint = createExportOutputFingerprint(base.history.present);

    const mutations: Array<[string, typeof base]> = [
      [
        'text edit',
        projectReducer(base, {
          type: 'UPDATE_CLIP_PROPS',
          clipId: textClip.id,
          patch: { text: 'Edited Title' },
        }),
      ],
      [
        'effect intensity',
        projectReducer(base, {
          type: 'UPDATE_CLIP_PROPS',
          clipId: effectClip.id,
          patch: { intensity: 80 },
        }),
      ],
      [
        'clip resize',
        projectReducer(base, {
          type: 'RESIZE_CLIP',
          clipId: v1.id,
          edge: 'right',
          time: 4,
        }),
      ],
      [
        'video transition',
        projectReducer(base, {
          type: 'SET_VIDEO_TRANSITION',
          clipId: v1.id,
          transition: { type: 'fade', duration: 0.6 },
        }),
      ],
      [
        'audio clip added',
        projectReducer(base, {
          type: 'ADD_CLIP',
          clip: {
            id: 'aud_1',
            type: 'audio',
            assetId: 'asset_aud_1',
            name: 'bgm.mp3',
            format: 'mp3',
            start: 0,
            duration: 4,
            sourceOffset: 0,
            sourceDuration: 10,
            volumePercent: 80,
            muted: false,
            loop: false,
            fadeInSeconds: 0.5,
            fadeOutSeconds: 0.5,
          },
        }),
      ],
      [
        'track mute',
        projectReducer(base, {
          type: 'TOGGLE_TRACK_MUTE',
          trackId: base.history.present.tracks[0].id,
        }),
      ],
      [
        'track hide',
        projectReducer(base, {
          type: 'TOGGLE_TRACK_HIDE',
          trackId: base.history.present.tracks[1].id,
        }),
      ],
      [
        'export mode',
        projectReducer(base, {
          type: 'SET_EXPORT_MODE',
          mode: 'precise',
        }),
      ],
      [
        'export quality',
        projectReducer(base, {
          type: 'SET_EXPORT_SETTINGS',
          settings: {
            ...base.history.present.exportSettings,
            quality: 'draft',
          },
        }),
      ],
      [
        'export resolution',
        projectReducer(base, {
          type: 'SET_EXPORT_SETTINGS',
          settings: {
            ...base.history.present.exportSettings,
            resolution: '720p',
          },
        }),
      ],
      [
        'canvas preset & fit',
        projectReducer(base, {
          type: 'SET_EXPORT_SETTINGS',
          settings: {
            ...base.history.present.exportSettings,
            canvasPreset: '9:16',
            canvasFit: 'fill',
          },
        }),
      ],
      [
        'audio-only mp3',
        projectReducer(base, {
          type: 'SET_EXPORT_SETTINGS',
          settings: {
            ...base.history.present.exportSettings,
            audioOnlyMp3: true,
          },
        }),
      ],
    ];

    for (const [label, edited] of mutations) {
      expect(
        shouldInvalidateExportResult({
          hasResult: true,
          isExporting: false,
          exportedFingerprint,
          currentProject: edited.history.present,
        }),
        `expected ${label} to invalidate export result`
      ).toBe(true);
    }
  });

  it('ignores the staleness check while an export is running or when no result exists', () => {
    const { state: base, textClip } = buildBaselineEditorState();
    const exportedFingerprint = createExportOutputFingerprint(base.history.present);
    const edited = projectReducer(base, {
      type: 'UPDATE_CLIP_PROPS',
      clipId: textClip.id,
      patch: { text: 'Changed' },
    });

    expect(
      shouldInvalidateExportResult({
        hasResult: true,
        isExporting: true,
        exportedFingerprint,
        currentProject: edited.history.present,
      })
    ).toBe(false);

    expect(
      shouldInvalidateExportResult({
        hasResult: false,
        isExporting: false,
        exportedFingerprint,
        currentProject: edited.history.present,
      })
    ).toBe(false);
  });

  it('clears an old result and marks it stale when the dialog opens after a project edit', () => {
    const { state: base, textClip } = buildBaselineEditorState();

    // Simulate a finished export session
    let hasResult = true;
    let resultUrl: string | null = 'blob:old-export';
    let exportedFingerprint: string | null = createExportOutputFingerprint(base.history.present);
    let isStale = false;
    const revokedUrls: string[] = [];

    const clearExportResult = (markStale = false) => {
      if (resultUrl) {
        revokedUrls.push(resultUrl);
        resultUrl = null;
      }
      hasResult = false;
      exportedFingerprint = null;
      isStale = markStale;
    };

    // Selection/playhead/zoom do not clear on dialog open
    let current = projectReducer(base, { type: 'SELECT_CLIP', clipId: textClip.id });
    current = projectReducer(current, { type: 'SET_PLAYHEAD', time: 2.5 });
    current = projectReducer(current, { type: 'SET_ZOOM', zoomPxPerSec: 90 });

    if (
      shouldInvalidateExportResult({
        hasResult,
        isExporting: false,
        exportedFingerprint,
        currentProject: current.history.present,
      })
    ) {
      clearExportResult(true);
    }
    expect(hasResult).toBe(true);
    expect(resultUrl).toBe('blob:old-export');
    expect(isStale).toBe(false);

    // Now edit the project while dialog is closed, then reopen
    current = projectReducer(current, { type: 'DELETE_CLIP', clipId: textClip.id });
    if (
      shouldInvalidateExportResult({
        hasResult,
        isExporting: false,
        exportedFingerprint,
        currentProject: current.history.present,
      })
    ) {
      clearExportResult(true);
    }

    expect(hasResult).toBe(false);
    expect(resultUrl).toBeNull();
    expect(revokedUrls).toEqual(['blob:old-export']);
    expect(isStale).toBe(true);
  });
});
