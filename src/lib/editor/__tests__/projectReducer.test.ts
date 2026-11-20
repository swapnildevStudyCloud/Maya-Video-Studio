import { describe, expect, it } from 'vitest';
import {
  canRedo,
  canUndo,
  createInitialEditorState,
  createVideoClipFromMeta,
  findClipInProject,
  getProjectDuration,
  getSnapTargets,
  hasOverlapOnTrack,
  MAX_TEXT_CLIP_LENGTH,
  MAX_VIDEO_TRACK_CLIPS,
  projectReducer,
  snapClipMoveStart,
  snapTime,
  type AudioClip,
  type ImageClip,
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
