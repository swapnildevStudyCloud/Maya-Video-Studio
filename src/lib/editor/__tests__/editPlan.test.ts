import { describe, expect, it } from 'vitest';
import {
  buildExampleEditPlanJson,
  canRedo,
  canUndo,
  compileProjectToFfmpegPlan,
  createInitialEditorState,
  createVideoClipFromMeta,
  EDIT_PLAN_CAPTIONS_NOTICE,
  EXAMPLE_EDIT_PLAN_JSON,
  getProjectDuration,
  hasTimelineContent,
  MAX_EDIT_PLAN_BYTES,
  MAX_EDIT_PLAN_ERRORS,
  MAX_EDIT_PLAN_TEXTS,
  MAX_TEXT_CLIP_LENGTH,
  MAX_VIDEO_TRACK_CLIPS,
  prepareAndVerifyEditPlanImport,
  projectReducer,
  validateAndParseEditPlan,
  type MediaAsset,
  type TextClip,
  type VideoClip,
} from '../index';

function makeVideoAsset(
  id: string,
  name: string,
  duration: number,
  width = 1920,
  height = 1080
): Extract<MediaAsset, { kind: 'video' }> {
  const file = new File([new Uint8Array(128)], name, { type: 'video/mp4' });
  return {
    id,
    kind: 'video',
    name,
    size: 5_000_000,
    extension: 'mp4',
    file,
    objectUrl: `blob:test-${id}`,
    thumbnailUrl: undefined,
    duration,
    width,
    height,
  };
}

function makeAudioAsset(id: string, name: string, duration = 30): MediaAsset {
  return {
    id,
    kind: 'audio',
    name,
    size: 100_000,
    file: new File([new Uint8Array(64)], name, { type: 'audio/mpeg' }),
    objectUrl: `blob:aud-${id}`,
    format: 'mp3',
    duration,
    waveform: [0.2, 0.5, 0.3],
  };
}

function makeDefaultAssets(): Map<string, MediaAsset> {
  const map = new Map<string, MediaAsset>();
  map.set('vid_intro', makeVideoAsset('vid_intro', 'intro.mp4', 12));
  map.set('vid_scene1', makeVideoAsset('vid_scene1', 'ai_scene1.mp4', 15));
  return map;
}

describe('editPlan validation and import', () => {
  it('validates a v1 plan and applies trimmed clips + texts into normal timeline tracks in one undoable step', () => {
    const assets = makeDefaultAssets();
    const raw = JSON.stringify({
      version: 1,
      clips: [
        { file: 'intro.mp4', start: 2, end: 7 },
        { file: 'ai_scene1.mp4', start: 1.5, end: 9.5 },
      ],
      texts: [
        { text: 'GTA 6 news', start: 0, end: 3 },
        { text: 'Breaking update', start: 1, end: 5 },
      ],
      captions: false,
    });

    const validation = validateAndParseEditPlan(raw, assets);
    expect(validation.ok).toBe(true);
    if (!validation.ok) return;

    expect(validation.plan.totalDuration).toBeCloseTo(13, 6);
    expect(validation.plan.captionsNotice).toBeNull();

    const initial = createInitialEditorState();
    expect(hasTimelineContent(initial)).toBe(false);

    const { actions, nextState } = prepareAndVerifyEditPlanImport({
      editorState: initial,
      plan: validation.plan,
      assets,
      replaceExisting: false,
    });
    expect(actions[0]?.type).toBe('BEGIN_EDIT_TRANSACTION');
    expect(nextState.playhead).toBe(0);
    expect(hasTimelineContent(nextState)).toBe(true);

    const videoTrack = nextState.history.present.tracks.find((t) => t.kind === 'video');
    expect(videoTrack?.clips).toHaveLength(2);
    const vClips = videoTrack?.clips as VideoClip[];
    expect(vClips[0].assetId).toBe('vid_intro');
    expect(vClips[0].sourceOffset).toBe(2);
    expect(vClips[0].start).toBe(0);
    expect(vClips[0].duration).toBe(5);
    expect(vClips[1].assetId).toBe('vid_scene1');
    expect(vClips[1].sourceOffset).toBe(1.5);
    expect(vClips[1].start).toBe(5);
    expect(vClips[1].duration).toBe(8);

    // Overlapping texts stack across Text rows cleanly with default style
    const textClips = nextState.history.present.tracks
      .filter((t) => t.kind === 'text')
      .flatMap((t) => t.clips as TextClip[]);
    expect(textClips).toHaveLength(2);
    expect(textClips[0]).toMatchObject({
      text: 'GTA 6 news',
      start: 0,
      duration: 3,
      size: 'medium',
      color: 'white',
      backgroundBox: false,
      align: 'center',
      xPercent: 50,
      yPercent: 50,
    });
    expect(textClips[1]).toMatchObject({
      text: 'Breaking update',
      start: 1,
      duration: 4,
    });

    // Compiles through the existing export compiler pipeline
    expect(getProjectDuration(nextState.history.present)).toBeCloseTo(13, 4);
    const exportPlan = compileProjectToFfmpegPlan({
      project: nextState.history.present,
      assets,
    });
    expect(exportPlan.textFiles).toHaveLength(2);
    expect(exportPlan.extraMediaFiles).toHaveLength(2);

    // Single Undo reverts the whole import, single Redo restores it
    expect(canUndo(nextState.history)).toBe(true);
    const undone = projectReducer(nextState, { type: 'UNDO' });
    expect(hasTimelineContent(undone)).toBe(false);
    expect(canRedo(undone.history)).toBe(true);

    const redone = projectReducer(undone, { type: 'REDO' });
    expect(redone.history.present.tracks.find((t) => t.kind === 'video')?.clips).toHaveLength(2);
  });

  it('replaces existing timeline content in a single undoable step while preserving assets', () => {
    const assets = makeDefaultAssets();
    let state = createInitialEditorState();
    const oldClip = createVideoClipFromMeta(
      {
        name: 'intro.mp4',
        size: 5_000_000,
        mimeType: 'video/mp4',
        extension: 'mp4',
        duration: 12,
        width: 1920,
        height: 1080,
      },
      'vid_intro',
      0
    );
    state = projectReducer(state, { type: 'ADD_CLIP', clip: oldClip });
    state = projectReducer(state, { type: 'ADD_TRACK_ROW', kind: 'text' });

    const raw = JSON.stringify({
      version: 1,
      clips: [{ file: 'ai_scene1.mp4', start: 0, end: 6 }],
      texts: [{ text: 'Replaced', start: 1, end: 4 }],
    });
    const parsed = validateAndParseEditPlan(raw, assets);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const { nextState } = prepareAndVerifyEditPlanImport({
      editorState: state,
      plan: parsed.plan,
      assets,
      replaceExisting: true,
    });

    const vClips = nextState.history.present.tracks.find((t) => t.kind === 'video')?.clips ?? [];
    expect(vClips).toHaveLength(1);
    expect((vClips[0] as VideoClip).assetId).toBe('vid_scene1');

    // Undo reverts both the replace-delete and the new plan in one step
    const undone = projectReducer(nextState, { type: 'UNDO' });
    const restoredClips =
      undone.history.present.tracks.find((t) => t.kind === 'video')?.clips ?? [];
    expect(restoredClips).toHaveLength(1);
    expect(restoredClips[0].id).toBe(oldClip.id);
  });

  it('accepts captions: true and provides the AI tab notice without modifying captions track', () => {
    const assets = makeDefaultAssets();
    const raw = JSON.stringify({
      version: 1,
      clips: [{ file: 'intro.mp4', start: 0, end: 4 }],
      captions: true,
    });
    const res = validateAndParseEditPlan(raw, assets);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.plan.captions).toBe(true);
    expect(res.plan.captionsNotice).toBe(EDIT_PLAN_CAPTIONS_NOTICE);
    expect(res.plan.texts).toEqual([]);
  });

  it('rejects wrong version and unknown fields naming field paths', () => {
    const assets = makeDefaultAssets();
    const raw = JSON.stringify({
      version: 2,
      extraTop: true,
      clips: [{ file: 'intro.mp4', start: 0, end: 4, music: 'bg.mp3' }],
      texts: [{ text: 'Title', start: 0, end: 2, font: 'Comic' }],
    });

    const res = validateAndParseEditPlan(raw, assets);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain('version must be 1');
    expect(res.error).toContain('Unknown field "extraTop"');
    expect(res.error).toContain('clips[0].music');
    expect(res.error).toContain('texts[0].font');
  });

  it('rejects missing files cleanly with "Upload <file> first" and rejects non-video assets', () => {
    const assets = makeDefaultAssets();
    assets.set('aud_1', makeAudioAsset('aud_1', 'voice.mp3'));

    const raw = JSON.stringify({
      version: 1,
      clips: [
        { file: 'missing_a.mp4', start: 0, end: 3 },
        { file: 'voice.mp3', start: 0, end: 3 },
        { file: 'missing_a.mp4', start: 3, end: 5 },
      ],
    });

    const res = validateAndParseEditPlan(raw, assets);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors.filter((e) => e === 'Upload missing_a.mp4 first')).toHaveLength(1);
    expect(res.error).toContain('Upload voice.mp3 first');
  });

  it('rejects ambiguous uploaded video names', () => {
    const assets = new Map<string, MediaAsset>();
    assets.set('v1', makeVideoAsset('v1', 'clip.mp4', 10));
    assets.set('v2', makeVideoAsset('v2', 'clip.mp4', 15));

    const res = validateAndParseEditPlan(
      JSON.stringify({
        version: 1,
        clips: [{ file: 'clip.mp4', start: 0, end: 5 }],
      }),
      assets
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain('ambiguous');
    expect(res.error).toContain('clip.mp4');
  });

  it('rejects clip end past real duration and invalid timing ranges', () => {
    const assets = makeDefaultAssets();
    const res = validateAndParseEditPlan(
      JSON.stringify({
        version: 1,
        clips: [
          { file: 'intro.mp4', start: 0, end: 25 },
          { file: 'ai_scene1.mp4', start: 5, end: 5 },
        ],
      }),
      assets
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain('intro.mp4');
    expect(res.error).toContain('12s');
    expect(res.error).toContain('clips[1].end must be greater than clips[1].start');
  });

  it('rejects empty clips, too many clips, and too many texts', () => {
    const assets = makeDefaultAssets();
    const emptyClipsRes = validateAndParseEditPlan(
      JSON.stringify({ version: 1, clips: [] }),
      assets
    );
    expect(emptyClipsRes.ok).toBe(false);

    const tooManyClips = Array.from({ length: MAX_VIDEO_TRACK_CLIPS + 1 }, () => ({
      file: 'intro.mp4',
      start: 0,
      end: 1,
    }));
    const tooManyTexts = Array.from({ length: MAX_EDIT_PLAN_TEXTS + 1 }, () => ({
      text: 'Hi',
      start: 0,
      end: 1,
    }));
    const overflowRes = validateAndParseEditPlan(
      JSON.stringify({ version: 1, clips: tooManyClips, texts: tooManyTexts }),
      assets
    );
    expect(overflowRes.ok).toBe(false);
    if (overflowRes.ok) return;
    expect(overflowRes.error).toContain(`between 1 and ${MAX_VIDEO_TRACK_CLIPS}`);
    expect(overflowRes.error).toContain(`at most ${MAX_EDIT_PLAN_TEXTS}`);
  });

  it('rejects text past 120 chars, blank text, and text end past total clips duration without echoing overlay text', () => {
    const assets = makeDefaultAssets();
    const secretText = 'SECRET_SENSITIVE_OVERLAY_' + 'X'.repeat(MAX_TEXT_CLIP_LENGTH);
    const res = validateAndParseEditPlan(
      JSON.stringify({
        version: 1,
        clips: [{ file: 'intro.mp4', start: 0, end: 5 }],
        texts: [
          { text: secretText, start: 0, end: 2 },
          { text: '   ', start: 0, end: 2 },
          { text: 'ANOTHER_SECRET', start: 1, end: 9 },
        ],
      }),
      assets
    );

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain(`at most ${MAX_TEXT_CLIP_LENGTH} characters`);
    expect(res.error).toContain('texts[1].text must be a non-empty string');
    expect(res.error).toContain('texts[2].end (9s) exceeds total clip duration (5s)');
    // Privacy rule: error messages must never echo user overlay text
    expect(res.error).not.toContain('SECRET_SENSITIVE_OVERLAY');
    expect(res.error).not.toContain('ANOTHER_SECRET');
  });

  it('rejects invalid JSON, oversized JSON (> 256 KB), and caps reported errors at 20', () => {
    const assets = makeDefaultAssets();
    const invalidJson = validateAndParseEditPlan('{ "version": 1, ', assets);
    expect(invalidJson.ok).toBe(false);
    if (!invalidJson.ok) expect(invalidJson.error).toContain('Invalid JSON');

    const bigPadding = 'a'.repeat(MAX_EDIT_PLAN_BYTES + 100);
    const oversized = validateAndParseEditPlan(
      JSON.stringify({ version: 1, clips: [{ file: bigPadding, start: 0, end: 1 }] }),
      assets
    );
    expect(oversized.ok).toBe(false);
    if (!oversized.ok) expect(oversized.error).toContain('Maximum size is 256 KB');

    // Generate 25 distinct missing files + invalid texts and verify cap at MAX_EDIT_PLAN_ERRORS (20)
    const manyBadTexts = Array.from({ length: 25 }, () => ({
      text: 'x',
      start: 5,
      end: 1,
    }));
    const capped = validateAndParseEditPlan(
      JSON.stringify({
        version: 2,
        clips: [{ file: 'intro.mp4', start: 0, end: 3 }],
        texts: manyBadTexts,
      }),
      assets
    );
    expect(capped.ok).toBe(false);
    if (!capped.ok) expect(capped.errors).toHaveLength(MAX_EDIT_PLAN_ERRORS);
  });

  it('does not mutate editorState if prepareAndVerifyEditPlanImport fails at apply time', () => {
    const assets = makeDefaultAssets();
    const initial = createInitialEditorState();
    const parsed = validateAndParseEditPlan(
      JSON.stringify({
        version: 1,
        clips: [{ file: 'intro.mp4', start: 0, end: 4 }],
      }),
      assets
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    // Remove the asset before apply step to simulate mid-apply failure / rollback guarantee
    assets.delete('vid_intro');
    expect(() =>
      prepareAndVerifyEditPlanImport({
        editorState: initial,
        plan: parsed.plan,
        assets,
        replaceExisting: false,
      })
    ).toThrow('Upload intro.mp4 first');
    expect(hasTimelineContent(initial)).toBe(false);
  });

  it('builds a valid downloadable example edit plan', () => {
    expect(JSON.parse(EXAMPLE_EDIT_PLAN_JSON)).toMatchObject({
      version: 1,
      captions: false,
    });

    const assets = makeDefaultAssets();
    const dynamicExample = buildExampleEditPlanJson(assets);
    const check = validateAndParseEditPlan(dynamicExample, assets);
    expect(check.ok).toBe(true);
  });
});
