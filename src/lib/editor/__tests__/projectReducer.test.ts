import { describe, expect, it } from 'vitest';
import {
  canDeleteTrackRow,
  canRedo,
  canUndo,
  compileProjectToFfmpegPlan,
  createEffectClip,
  createInitialEditorState,
  createVideoClipFromMeta,
  findClipInProject,
  getDeleteTrackRowBlockReason,
  getProjectDuration,
  getSnapTargets,
  hasOverlapOnTrack,
  hasRemovableEmptyRows,
  MAX_TEXT_CLIP_LENGTH,
  MAX_VIDEO_TRACK_CLIPS,
  projectReducer,
  snapClipMoveStart,
  snapTime,
  type AudioClip,
  type ImageClip,
  type MediaAsset,
  type TextClip,
  type VideoFileMetadata,
} from '../index';

function makeMeta(overrides: Partial<VideoFileMetadata> = {}): VideoFileMetadata {
  return {
    name: 'sample.mp4',
    size: 5_000_000,
    mimeType: 'video/mp4',
    extension: 'mp4',
    duration: 20,
    width: 1920,
    height: 1080,
    ...overrides,
  };
}

function makeTextClip(id: string, start: number, duration = 3, text = 'Hello'): TextClip {
  return {
    id,
    type: 'text',
    name: text,
    start,
    duration,
    sourceOffset: 0,
    text,
    size: 'medium',
    color: 'white',
    backgroundBox: false,
    align: 'center',
    xPercent: 50,
    yPercent: 50,
  };
}

function makeImageClip(id: string, start: number, duration = 3): ImageClip {
  return {
    id,
    type: 'image',
    assetId: 'asset_img_1',
    name: 'logo.png',
    format: 'png',
    start,
    duration,
    sourceOffset: 0,
    xPercent: 85,
    yPercent: 15,
    sizePercent: 20,
    opacityPercent: 100,
  };
}

function makeAudioClip(id: string, start: number, duration = 6, sourceDuration = 12): AudioClip {
  return {
    id,
    type: 'audio',
    assetId: 'asset_aud_1',
    name: 'music.mp3',
    format: 'mp3',
    start,
    duration,
    sourceOffset: 0,
    sourceDuration,
    volumePercent: 100,
    muted: false,
    loop: false,
    fadeInSeconds: 0,
    fadeOutSeconds: 0,
  };
}

describe('projectReducer', () => {
  it('loads a video project and sets initial video clip on the Video track', () => {
    let state = createInitialEditorState();
    state = projectReducer(state, {
      type: 'LOAD_VIDEO_PROJECT',
      meta: makeMeta({ name: 'vacation.mov', duration: 15 }),
      assetId: 'asset_v1',
    });

    const project = state.history.present;
    expect(project.name).toBe('vacation');
    expect(getProjectDuration(project)).toBe(15);
    const videoTrack = project.tracks.find((t) => t.kind === 'video');
    expect(videoTrack?.clips).toHaveLength(1);
    expect(state.selectedClipId).toBe(videoTrack?.clips[0].id);
  });

  it('maintains ripple Video track when adding, inserting, reordering, deleting, and removing assets', () => {
    let state = createInitialEditorState();
    const c1 = createVideoClipFromMeta(makeMeta({ name: 'a.mp4', duration: 4 }), 'asset_1');
    const c2 = createVideoClipFromMeta(makeMeta({ name: 'b.mp4', duration: 6 }), 'asset_2');
    const c3 = createVideoClipFromMeta(makeMeta({ name: 'c.mp4', duration: 3 }), 'asset_3');

    state = projectReducer(state, { type: 'ADD_CLIP', clip: c1 });
    state = projectReducer(state, { type: 'ADD_CLIP', clip: c2 });
    state = projectReducer(state, { type: 'ADD_CLIP', clip: c3, insertIndex: 1 });

    let videoClips = state.history.present.tracks.find((t) => t.kind === 'video')!.clips;
    expect(videoClips.map((c) => [c.name, c.start, c.duration])).toEqual([
      ['a.mp4', 0, 4],
      ['c.mp4', 4, 3],
      ['b.mp4', 7, 6],
    ]);

    // Drag reorder via MOVE_CLIP (move b.mp4 before a.mp4)
    state = projectReducer(state, { type: 'MOVE_CLIP', clipId: c2.id, start: 0 });
    videoClips = state.history.present.tracks.find((t) => t.kind === 'video')!.clips;
    expect(videoClips.map((c) => [c.name, c.start, c.duration])).toEqual([
      ['b.mp4', 0, 6],
      ['a.mp4', 6, 4],
      ['c.mp4', 10, 3],
    ]);

    // Explicit REORDER_VIDEO_CLIP moves c.mp4 back to index 0
    state = projectReducer(state, { type: 'REORDER_VIDEO_CLIP', clipId: c3.id, toIndex: 0 });
    videoClips = state.history.present.tracks.find((t) => t.kind === 'video')!.clips;
    expect(videoClips.map((c) => [c.name, c.start])).toEqual([
      ['c.mp4', 0],
      ['b.mp4', 3],
      ['a.mp4', 9],
    ]);

    // Removing asset_2 deletes all its clips and ripples remaining clips without gaps
    state = projectReducer(state, { type: 'REMOVE_ASSET_CLIPS', assetId: 'asset_2' });
    videoClips = state.history.present.tracks.find((t) => t.kind === 'video')!.clips;
    expect(videoClips.map((c) => [c.name, c.start])).toEqual([
      ['c.mp4', 0],
      ['a.mp4', 3],
    ]);
  });

  it('enforces the 20-clip maximum on the Video track across add, split, and duplicate', () => {
    let state = createInitialEditorState();
    for (let i = 0; i < MAX_VIDEO_TRACK_CLIPS + 3; i++) {
      const clip = createVideoClipFromMeta(makeMeta({ name: `v${i}.mp4`, duration: 4 }), `asset_${i}`);
      state = projectReducer(state, { type: 'ADD_CLIP', clip });
    }

    const videoTrack = state.history.present.tracks.find((t) => t.kind === 'video')!;
    expect(videoTrack.clips).toHaveLength(MAX_VIDEO_TRACK_CLIPS);

    // Split and duplicate must also respect the 20-clip limit
    state = projectReducer(state, { type: 'SET_PLAYHEAD', time: 2 });
    state = projectReducer(state, {
      type: 'SPLIT_CLIP_AT_PLAYHEAD',
      clipId: videoTrack.clips[0].id,
    });
    expect(state.history.present.tracks.find((t) => t.kind === 'video')!.clips).toHaveLength(
      MAX_VIDEO_TRACK_CLIPS
    );

    state = projectReducer(state, { type: 'DUPLICATE_CLIP', clipId: videoTrack.clips[0].id });
    expect(state.history.present.tracks.find((t) => t.kind === 'video')!.clips).toHaveLength(
      MAX_VIDEO_TRACK_CLIPS
    );
  });

  it('auto-stacks overlapping text and image clips onto new track rows', () => {
    let state = createInitialEditorState();
    state = projectReducer(state, {
      type: 'ADD_CLIP',
      clip: makeTextClip('t1', 2, 4, 'First'),
    });
    state = projectReducer(state, {
      type: 'ADD_CLIP',
      clip: makeTextClip('t2', 3, 4, 'Second'),
    });

    const textTracks = state.history.present.tracks.filter((t) => t.kind === 'text');
    expect(textTracks).toHaveLength(2);
    expect(textTracks[0].clips.map((c) => c.id)).toEqual(['t1']);
    expect(textTracks[1].clips.map((c) => c.id)).toEqual(['t2']);

    state = projectReducer(state, {
      type: 'ADD_CLIP',
      clip: makeImageClip('i1', 0, 5),
    });
    state = projectReducer(state, {
      type: 'ADD_CLIP',
      clip: makeImageClip('i2', 2, 5),
    });
    const imgTracks = state.history.present.tracks.filter((t) => t.kind === 'image');
    expect(imgTracks).toHaveLength(2);
  });

  it('prevents overlapping clips on the same audio track during move', () => {
    let state = createInitialEditorState();
    state = projectReducer(state, {
      type: 'ADD_CLIP',
      clip: makeAudioClip('a1', 0, 4, 10),
    });
    state = projectReducer(state, {
      type: 'ADD_CLIP',
      clip: makeAudioClip('a2', 6, 4, 10),
    });

    // Try moving a2 into [2, 6] overlapping a1 [0, 4]
    state = projectReducer(state, {
      type: 'MOVE_CLIP',
      clipId: 'a2',
      start: 2,
    });

    const a2 = findClipInProject(state.history.present, 'a2')?.clip;
    expect(a2).toBeDefined();
    expect(a2!.start).toBeGreaterThanOrEqual(4 - 1e-4);

    const audioTrack = state.history.present.tracks.find((t) => t.kind === 'audio')!;
    expect(hasOverlapOnTrack(audioTrack.clips, a2!.start, a2!.duration, a2!.id)).toBe(false);
  });

  it('resizes left and right edges on ripple Video track while adjusting sourceOffset and packing from 0', () => {
    let state = createInitialEditorState();
    state = projectReducer(state, {
      type: 'LOAD_VIDEO_PROJECT',
      meta: makeMeta({ duration: 20 }),
      assetId: 'asset_v1',
    });
    const vidId = state.selectedClipId!;

    // Speed 2x -> timeline duration becomes 10s
    state = projectReducer(state, {
      type: 'UPDATE_CLIP_PROPS',
      clipId: vidId,
      patch: { speed: 2 },
    });
    let vc = findClipInProject(state.history.present, vidId)!.clip;
    expect(vc.type === 'video' && vc.duration).toBeCloseTo(10, 4);

    // Trim left edge from 0s to 2s -> sourceOffset advances by 2 * 2 = 4s, duration = 8s, ripple keeps start = 0
    state = projectReducer(state, {
      type: 'RESIZE_CLIP',
      clipId: vidId,
      edge: 'left',
      time: 2,
    });
    vc = findClipInProject(state.history.present, vidId)!.clip;
    expect(vc.start).toBeCloseTo(0, 4);
    expect(vc.duration).toBeCloseTo(8, 4);
    expect(vc.sourceOffset).toBeCloseTo(4, 4);

    // Trim right edge to 5s -> duration = 5s
    state = projectReducer(state, {
      type: 'RESIZE_CLIP',
      clipId: vidId,
      edge: 'right',
      time: 5,
    });
    vc = findClipInProject(state.history.present, vidId)!.clip;
    expect(vc.duration).toBeCloseTo(5, 4);
  });

  it('splits a video clip at the playhead and advances right clip sourceOffset', () => {
    let state = createInitialEditorState();
    state = projectReducer(state, {
      type: 'LOAD_VIDEO_PROJECT',
      meta: makeMeta({ duration: 12 }),
      assetId: 'asset_v1',
    });
    state = projectReducer(state, { type: 'SET_PLAYHEAD', time: 5 });
    state = projectReducer(state, { type: 'SPLIT_CLIP_AT_PLAYHEAD' });

    const videoTrack = state.history.present.tracks.find((t) => t.kind === 'video')!;
    expect(videoTrack.clips).toHaveLength(2);
    expect(videoTrack.clips[0].start).toBe(0);
    expect(videoTrack.clips[0].duration).toBe(5);
    expect(videoTrack.clips[1].start).toBe(5);
    expect(videoTrack.clips[1].duration).toBe(7);
    expect(videoTrack.clips[1].sourceOffset).toBe(5);
  });

  it('duplicates and deletes clips cleanly', () => {
    let state = createInitialEditorState();
    state = projectReducer(state, {
      type: 'ADD_CLIP',
      clip: makeTextClip('t1', 1, 3, 'Title'),
    });
    state = projectReducer(state, { type: 'DUPLICATE_CLIP', clipId: 't1' });

    const textTrack = state.history.present.tracks.find((t) => t.kind === 'text')!;
    expect(textTrack.clips).toHaveLength(2);
    expect(textTrack.clips[1].start).toBe(4);

    const dupId = textTrack.clips[1].id;
    state = projectReducer(state, { type: 'DELETE_CLIP', clipId: dupId });
    expect(state.history.present.tracks.find((t) => t.kind === 'text')!.clips).toHaveLength(1);
    expect(state.selectedClipId).toBeNull();
  });

  it('sanitizes text clip length and coalesces drag transactions into single undo/redo steps', () => {
    let state = createInitialEditorState();
    state = projectReducer(state, {
      type: 'ADD_CLIP',
      clip: makeTextClip('t1', 0, 3, 'Initial'),
    });

    const tooLong = 'x'.repeat(MAX_TEXT_CLIP_LENGTH + 40);
    state = projectReducer(state, {
      type: 'UPDATE_CLIP_PROPS',
      clipId: 't1',
      patch: { text: tooLong },
    });
    const updated = findClipInProject(state.history.present, 't1')!.clip;
    expect(updated.type === 'text' && updated.text.length).toBe(MAX_TEXT_CLIP_LENGTH);

    // Drag transaction coalescing
    state = projectReducer(state, { type: 'BEGIN_EDIT_TRANSACTION' });
    state = projectReducer(state, { type: 'MOVE_CLIP', clipId: 't1', start: 1 });
    state = projectReducer(state, { type: 'MOVE_CLIP', clipId: 't1', start: 2 });
    state = projectReducer(state, { type: 'MOVE_CLIP', clipId: 't1', start: 4 });
    state = projectReducer(state, { type: 'COMMIT_EDIT_TRANSACTION' });

    expect(findClipInProject(state.history.present, 't1')!.clip.start).toBe(4);
    expect(canUndo(state.history)).toBe(true);

    // One undo reverts the entire drag from 4 -> 0
    state = projectReducer(state, { type: 'UNDO' });
    expect(findClipInProject(state.history.present, 't1')!.clip.start).toBe(0);
    expect(canRedo(state.history)).toBe(true);

    state = projectReducer(state, { type: 'REDO' });
    expect(findClipInProject(state.history.present, 't1')!.clip.start).toBe(4);
  });

  it('populates Captions track via SET_CAPTION_CLIPS', () => {
    let state = createInitialEditorState();
    state = projectReducer(state, {
      type: 'SET_CAPTION_CLIPS',
      timelineOffset: 2,
      captions: [
        { id: 'c1', start: 0, end: 1.5, text: 'Hello world' },
        { id: 'c2', start: 2, end: 4, text: 'Timeline captions' },
      ],
    });
    const capTrack = state.history.present.tracks.find((t) => t.kind === 'captions');
    expect(capTrack).toBeDefined();
    expect(capTrack!.clips).toHaveLength(2);
    expect(capTrack!.clips[0].start).toBe(2);
    expect(capTrack!.clips[1].start).toBe(4);
  });
});

describe('snap utilities', () => {
  it('collects snap targets from playhead and other clip edges and snaps within tolerance', () => {
    let state = createInitialEditorState();
    state = projectReducer(state, {
      type: 'ADD_CLIP',
      clip: makeTextClip('t1', 4, 3, 'Anchor'),
    });
    state = projectReducer(state, {
      type: 'ADD_CLIP',
      clip: makeTextClip('t2', 10, 2, 'Mover'),
    });

    const targets = getSnapTargets(state.history.present.tracks, 2.5, 't2');
    expect(targets).toContain(0);
    expect(targets).toContain(2.5);
    expect(targets).toContain(4);
    expect(targets).toContain(7);

    expect(snapTime(6.92, targets, 0.15)).toEqual({ time: 7, snappedTo: 7 });
    // Trailing edge snap: desiredStart 1.95 + duration 2 = 3.95 -> snaps to 4 -> start 2
    expect(
      snapClipMoveStart({
        desiredStart: 1.95,
        duration: 2,
        targets,
        toleranceSeconds: 0.1,
      })
    ).toEqual({ start: 2, snappedTo: 4 });
  });
});

describe('timeline row deletion & empty row cleanup', () => {
  it('protects the Video track and the last remaining row of every other kind (Effects, Text, Overlay, Audio, Captions)', () => {
    let state = createInitialEditorState();
    state = projectReducer(state, {
      type: 'SET_CAPTION_CLIPS',
      captions: [{ id: 'c1', start: 0, end: 2, text: 'Hi' }],
    });

    const tracks = state.history.present.tracks;
    expect(tracks.map((t) => t.kind)).toEqual([
      'video',
      'captions',
      'effects',
      'text',
      'image',
      'audio',
    ]);

    for (const track of tracks) {
      expect(canDeleteTrackRow(tracks, track.id)).toBe(false);
      const reason = getDeleteTrackRowBlockReason(tracks, track.id);
      if (track.kind === 'video') {
        expect(reason).toBe('The Video track cannot be deleted');
      } else {
        expect(reason).toBe('At least one row of this kind is required');
      }

      const next = projectReducer(state, { type: 'DELETE_TRACK_ROW', trackId: track.id });
      expect(next).toBe(state);
    }
  });

  it('deletes an empty extra row, renumbers remaining rows of that kind, and supports single-step Undo/Redo', () => {
    let state = createInitialEditorState();
    state = projectReducer(state, { type: 'ADD_TRACK_ROW', kind: 'effects' });
    state = projectReducer(state, { type: 'ADD_TRACK_ROW', kind: 'effects' });

    let effectRows = state.history.present.tracks.filter((t) => t.kind === 'effects');
    expect(effectRows.map((t) => t.name)).toEqual(['Effects', 'Effects 2', 'Effects 3']);

    // Delete the first row (empty) -> Effects 2 and Effects 3 renumber to Effects and Effects 2
    const firstRowId = effectRows[0].id;
    expect(canDeleteTrackRow(state.history.present.tracks, firstRowId)).toBe(true);
    state = projectReducer(state, { type: 'DELETE_TRACK_ROW', trackId: firstRowId });

    effectRows = state.history.present.tracks.filter((t) => t.kind === 'effects');
    expect(effectRows.map((t) => t.name)).toEqual(['Effects', 'Effects 2']);

    // Undo restores all 3 rows and original names in one step
    state = projectReducer(state, { type: 'UNDO' });
    effectRows = state.history.present.tracks.filter((t) => t.kind === 'effects');
    expect(effectRows.map((t) => t.name)).toEqual(['Effects', 'Effects 2', 'Effects 3']);

    // Redo deletes the row and renumbers again
    state = projectReducer(state, { type: 'REDO' });
    effectRows = state.history.present.tracks.filter((t) => t.kind === 'effects');
    expect(effectRows.map((t) => t.name)).toEqual(['Effects', 'Effects 2']);
  });

  it('deletes a non-empty row with its clips, clears selection only if selected clip was in that row, and undoes/redoes in one step', () => {
    let state = createInitialEditorState();
    state = projectReducer(state, {
      type: 'ADD_CLIP',
      clip: makeTextClip('t_keep', 0, 3, 'Keep me'),
    });
    state = projectReducer(state, {
      type: 'ADD_CLIP',
      clip: makeTextClip('t_del', 1, 3, 'Delete me'),
    });

    const textRowsBefore = state.history.present.tracks.filter((t) => t.kind === 'text');
    expect(textRowsBefore).toHaveLength(2);
    expect(textRowsBefore.map((t) => t.name)).toEqual(['Text', 'Text 2']);

    // Selected clip is in Text 2 (auto-selected on ADD_CLIP) -> deleting Text 2 clears selection
    expect(state.selectedClipId).toBe('t_del');
    state = projectReducer(state, { type: 'DELETE_TRACK_ROW', trackId: textRowsBefore[1].id });

    expect(state.selectedClipId).toBeNull();
    expect(findClipInProject(state.history.present, 't_del')).toBeNull();
    expect(findClipInProject(state.history.present, 't_keep')).not.toBeNull();
    expect(state.history.present.tracks.filter((t) => t.kind === 'text')).toHaveLength(1);

    // Undo restores Text 2 and its clip in one step
    state = projectReducer(state, { type: 'UNDO' });
    expect(findClipInProject(state.history.present, 't_del')).not.toBeNull();
    expect(state.history.present.tracks.filter((t) => t.kind === 'text')).toHaveLength(2);

    // If selection is on t_keep (row 1) and we delete row 2, selection stays on t_keep
    state = projectReducer(state, { type: 'SELECT_CLIP', clipId: 't_keep' });
    state = projectReducer(state, { type: 'DELETE_TRACK_ROW', trackId: textRowsBefore[1].id });
    expect(state.selectedClipId).toBe('t_keep');
    expect(findClipInProject(state.history.present, 't_del')).toBeNull();

    // Redo check after another undo
    state = projectReducer(state, { type: 'UNDO' });
    expect(findClipInProject(state.history.present, 't_del')).not.toBeNull();
    state = projectReducer(state, { type: 'REDO' });
    expect(findClipInProject(state.history.present, 't_del')).toBeNull();
  });

  it('removes all empty extra rows across kinds in one undoable REMOVE_EMPTY_TRACK_ROWS step while preserving last row of each kind', () => {
    let state = createInitialEditorState();
    expect(hasRemovableEmptyRows(state.history.present.tracks)).toBe(false);

    // No-op when no empty extra rows exist
    const unchanged = projectReducer(state, { type: 'REMOVE_EMPTY_TRACK_ROWS' });
    expect(unchanged).toBe(state);

    // Add 2 extra Effects rows (all empty), 2 extra Text rows (put clip in Text 2 only), 1 extra Overlay row (empty)
    state = projectReducer(state, { type: 'ADD_TRACK_ROW', kind: 'effects' });
    state = projectReducer(state, { type: 'ADD_TRACK_ROW', kind: 'effects' });
    state = projectReducer(state, { type: 'ADD_TRACK_ROW', kind: 'text' });
    state = projectReducer(state, { type: 'ADD_TRACK_ROW', kind: 'text' });
    const textRow2 = state.history.present.tracks.filter((t) => t.kind === 'text')[1];
    state = projectReducer(state, {
      type: 'ADD_CLIP',
      clip: makeTextClip('t_row2', 1, 2, 'Row 2'),
      trackId: textRow2.id,
    });
    state = projectReducer(state, { type: 'ADD_TRACK_ROW', kind: 'image' });

    expect(hasRemovableEmptyRows(state.history.present.tracks)).toBe(true);

    // Remove all empty extra rows at once
    state = projectReducer(state, { type: 'REMOVE_EMPTY_TRACK_ROWS' });

    const tracks = state.history.present.tracks;
    expect(tracks.filter((t) => t.kind === 'effects').map((t) => t.name)).toEqual(['Effects']);
    const textRows = tracks.filter((t) => t.kind === 'text');
    expect(textRows.map((t) => t.name)).toEqual(['Text']);
    expect(textRows[0].clips.map((c) => c.id)).toEqual(['t_row2']);
    expect(tracks.filter((t) => t.kind === 'image').map((t) => t.name)).toEqual(['Overlay']);
    expect(hasRemovableEmptyRows(tracks)).toBe(false);

    // One undo restores all removed empty rows
    state = projectReducer(state, { type: 'UNDO' });
    expect(state.history.present.tracks.filter((t) => t.kind === 'effects')).toHaveLength(3);
    expect(state.history.present.tracks.filter((t) => t.kind === 'text')).toHaveLength(3);
    expect(state.history.present.tracks.filter((t) => t.kind === 'image')).toHaveLength(2);

    // Redo removes them again in one step
    state = projectReducer(state, { type: 'REDO' });
    expect(state.history.present.tracks.filter((t) => t.kind === 'effects')).toHaveLength(1);
    expect(state.history.present.tracks.filter((t) => t.kind === 'text')).toHaveLength(1);
    expect(state.history.present.tracks.filter((t) => t.kind === 'image')).toHaveLength(1);
  });

  it('allows adding overlapping effects/text when 1 row remains and exports matching remaining timeline', () => {
    let state = createInitialEditorState();
    state = projectReducer(state, {
      type: 'LOAD_VIDEO_PROJECT',
      meta: makeMeta({ name: 'clip.mp4', duration: 8 }),
      assetId: 'asset_vid_1',
    });

    // Stack 2 effects, delete row 1 (leaving 1 row), then add an overlapping effect
    const e1 = createEffectClip({ id: 'efx_1', effectType: 'blur', start: 0, duration: 4 });
    const e2 = createEffectClip({ id: 'efx_2', effectType: 'bw', start: 1, duration: 4 });
    state = projectReducer(state, { type: 'ADD_CLIP', clip: e1 });
    state = projectReducer(state, { type: 'ADD_CLIP', clip: e2 });

    const effectRow1 = state.history.present.tracks.filter((t) => t.kind === 'effects')[0];
    state = projectReducer(state, { type: 'DELETE_TRACK_ROW', trackId: effectRow1.id });
    expect(state.history.present.tracks.filter((t) => t.kind === 'effects')).toHaveLength(1);

    // Adding an overlapping effect auto-creates Effects 2 cleanly
    const e3 = createEffectClip({ id: 'efx_3', effectType: 'vignette', start: 2, duration: 3 });
    state = projectReducer(state, { type: 'ADD_CLIP', clip: e3 });
    expect(
      state.history.present.tracks.filter((t) => t.kind === 'effects').map((t) => t.name)
    ).toEqual(['Effects', 'Effects 2']);

    const assets = new Map<string, MediaAsset>([
      [
        'asset_vid_1',
        {
          id: 'asset_vid_1',
          kind: 'video',
          name: 'clip.mp4',
          size: 5_000_000,
          extension: 'mp4',
          file: new File([new Uint8Array(16)], 'clip.mp4', { type: 'video/mp4' }),
          objectUrl: 'blob:vid',
          thumbnailUrl: undefined,
          duration: 8,
          width: 1920,
          height: 1080,
        },
      ],
    ]);

    const plan = compileProjectToFfmpegPlan({
      project: state.history.present,
      assets,
      hasSourceAudio: true,
    });
    const filterArgIdx = plan.args.indexOf('-filter_complex');
    expect(filterArgIdx).toBeGreaterThan(-1);
    const filterComplex = plan.args[filterArgIdx + 1];
    // Deleted efx_1 (blur) must be absent; remaining efx_2 (bw / hue=s=0) and efx_3 (vignette) must be exported
    expect(filterComplex).not.toContain('boxblur=');
    expect(filterComplex).toContain('hue=s=0');
    expect(filterComplex).toContain('vignette=');
  });
});
