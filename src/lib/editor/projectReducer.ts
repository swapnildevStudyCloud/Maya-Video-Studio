import {
  clampEffectIntensity,
  clampTextAnimationDuration,
  getEffectiveTransitionDuration,
  isSlideTextAnimation,
  normalizeVideoTransition,
} from './effectsAndAnimations';
import {
  canRedo,
  canUndo,
  createHistory,
  pushHistory,
  redoHistory,
  undoHistory,
  type HistoryState,
} from './history';
import {
  getClipNeighborBounds,
  hasOverlapOnTrack,
  resolveNonOverlappingStart,
} from './snap';
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
  ALLOWED_TEXT_ANIMATIONS,
  ALLOWED_VIDEO_EFFECTS,
  createDefaultColorFilter,
  createDefaultExportSettings,
  DEFAULT_EXPORT_FPS,
  DEFAULT_TEXT_ANIMATION_SECONDS,
  MAX_ADDED_AUDIO_FADE_SECONDS,
  MAX_FADE_SECONDS,
  MAX_IMAGE_SIZE_PERCENT,
  MAX_TEXT_CLIP_LENGTH,
  MAX_VIDEO_TRACK_CLIPS,
  MAX_VOLUME_PERCENT,
  MIN_CLIP_DURATION_SECONDS,
  MIN_IMAGE_SIZE_PERCENT,
  MIN_VOLUME_PERCENT,
  type AudioClip,
  type CaptionSegment,
  type EffectClip,
  type ExportMode,
  type ExportSettings,
  type ImageClip,
  type PlaybackSpeed,
  type ProjectState,
  type TextAnimationType,
  type TextClip,
  type TimelineClip,
  type TimelineTrack,
  type TrackKind,
  type VideoClip,
  type VideoFileMetadata,
  type VideoTransition,
} from './types';

export const MIN_TIMELINE_ZOOM = 15;
export const MAX_TIMELINE_ZOOM = 240;
export const DEFAULT_TIMELINE_ZOOM = 60;

export interface ProjectEditorState {
  history: HistoryState<ProjectState>;
  dragBaseProject: ProjectState | null;
  selectedClipId: string | null;
  playhead: number;
  zoomPxPerSec: number;
  snapEnabled: boolean;
}

let idCounter = 0;
export function nextProjectId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${idCounter}`;
}

export function createEmptyProject(name = 'Untitled Project'): ProjectState {
  return {
    name,
    tracks: [
      { id: 'track-video', kind: 'video', name: 'Video', muted: false, hidden: false, clips: [] },
      { id: 'track-effects-1', kind: 'effects', name: 'Effects', muted: false, hidden: false, clips: [] },
      { id: 'track-text-1', kind: 'text', name: 'Text', muted: false, hidden: false, clips: [] },
      { id: 'track-image-1', kind: 'image', name: 'Overlay', muted: false, hidden: false, clips: [] },
      { id: 'track-audio-1', kind: 'audio', name: 'Audio', muted: false, hidden: false, clips: [] },
    ],
    exportMode: 'fast',
    exportSettings: createDefaultExportSettings(),
  };
}

export function createVideoClipFromMeta(
  meta: VideoFileMetadata,
  assetId: string,
  start = 0
): VideoClip {
  return {
    id: nextProjectId('vid'),
    type: 'video',
    assetId,
    name: meta.name,
    start,
    duration: meta.duration,
    sourceOffset: 0,
    sourceDuration: meta.duration,
    speed: 1,
    volumePercent: 100,
    muted: false,
    rotationDegrees: 0,
    flipHorizontal: false,
    cropAspect: 'original',
    colorFilter: createDefaultColorFilter(),
    fadeInSeconds: 0,
    fadeOutSeconds: 0,
  };
}

export function createProjectWithVideo(meta: VideoFileMetadata, assetId: string): ProjectState {
  const baseName = meta.name.replace(/\.(mp4|mov)$/i, '').trim() || 'Untitled Project';
  const base = createEmptyProject(baseName);
  const videoClip = createVideoClipFromMeta(meta, assetId, 0);
  return {
    ...base,
    tracks: base.tracks.map((track) =>
      track.kind === 'video' ? { ...track, clips: [videoClip] } : track
    ),
  };
}

export function createInitialEditorState(project = createEmptyProject()): ProjectEditorState {
  return {
    history: createHistory(project),
    dragBaseProject: null,
    selectedClipId: null,
    playhead: 0,
    zoomPxPerSec: DEFAULT_TIMELINE_ZOOM,
    snapEnabled: true,
  };
}

export function getProjectDuration(project: ProjectState): number {
  let maxEnd = 0;
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      const end = clip.start + clip.duration;
      if (end > maxEnd) maxEnd = end;
    }
  }
  return maxEnd;
}

export function findClipInProject(
  project: ProjectState,
  clipId: string | null
): { track: TimelineTrack; clip: TimelineClip } | null {
  if (!clipId) return null;
  for (const track of project.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return { track, clip };
  }
  return null;
}

export type ClipPropsPatch =
  | Partial<Omit<VideoClip, 'id' | 'type' | 'assetId'>>
  | Partial<Omit<EffectClip, 'id' | 'type'>>
  | Partial<Omit<TextClip, 'id' | 'type'>>
  | Partial<Omit<ImageClip, 'id' | 'type' | 'assetId' | 'format'>>
  | Partial<Omit<AudioClip, 'id' | 'type' | 'assetId' | 'format'>>;

export type ProjectAction =
  | { type: 'SET_PROJECT_NAME'; name: string }
  | { type: 'LOAD_VIDEO_PROJECT'; meta: VideoFileMetadata; assetId: string }
  | { type: 'ADD_CLIP'; clip: TimelineClip; trackId?: string; insertIndex?: number; atPlayhead?: boolean }
  | { type: 'ADD_TRACK_ROW'; kind: 'text' | 'image' | 'effects' }
  | { type: 'DELETE_TRACK_ROW'; trackId: string }
  | { type: 'REMOVE_EMPTY_TRACK_ROWS' }
  | { type: 'MOVE_CLIP'; clipId: string; start: number; targetTrackId?: string }
  | { type: 'REORDER_VIDEO_CLIP'; clipId: string; toIndex: number }
  | { type: 'RESIZE_CLIP'; clipId: string; edge: 'left' | 'right'; time: number }
  | { type: 'SPLIT_CLIP_AT_PLAYHEAD'; clipId?: string; time?: number }
  | { type: 'DUPLICATE_CLIP'; clipId?: string }
  | { type: 'DELETE_CLIP'; clipId: string }
  | { type: 'REMOVE_ASSET_CLIPS'; assetId: string }
  | { type: 'UPDATE_CLIP_PROPS'; clipId: string; patch: ClipPropsPatch }
  | { type: 'SET_VIDEO_TRANSITION'; clipId: string; transition: VideoTransition | undefined }
  | {
      type: 'APPLY_ANIMATION_TO_ALL_CAPTIONS';
      animInType: TextAnimationType;
      animInDuration: number;
      animOutType: TextAnimationType;
      animOutDuration: number;
      fadeWithSlide?: boolean;
    }
  | { type: 'TOGGLE_TRACK_MUTE'; trackId: string }
  | { type: 'TOGGLE_TRACK_HIDE'; trackId: string }
  | { type: 'SET_CAPTION_CLIPS'; captions: CaptionSegment[]; timelineOffset?: number }
  | { type: 'SET_EXPORT_MODE'; mode: ExportMode }
  | { type: 'SET_EXPORT_SETTINGS'; settings: ExportSettings }
  | { type: 'BEGIN_EDIT_TRANSACTION' }
  | { type: 'COMMIT_EDIT_TRANSACTION' }
  | { type: 'SELECT_CLIP'; clipId: string | null }
  | { type: 'SET_PLAYHEAD'; time: number }
  | { type: 'STEP_PLAYHEAD'; deltaSeconds: number }
  | { type: 'SET_ZOOM'; zoomPxPerSec: number }
  | { type: 'TOGGLE_SNAP'; enabled?: boolean }
  | { type: 'UNDO' }
  | { type: 'REDO' };

function sortClips(clips: TimelineClip[]): TimelineClip[] {
  return [...clips].sort((a, b) => a.start - b.start);
}

/**
 * Keeps Video track ripple-packed from t=0 with zero gaps and transition overlaps accounted for.
 */
export function normalizeRippleVideoTrack(clips: TimelineClip[]): TimelineClip[] {
  const result: VideoClip[] = [];
  for (let i = 0; i < clips.length; i++) {
    const raw = clips[i];
    if (raw.type !== 'video') continue;
    const isLast = i === clips.length - 1;
    const transitionOut = !isLast ? normalizeVideoTransition(raw.transitionOut) : undefined;
    const normalized: VideoClip = {
      ...raw,
      start: 0,
      transitionOut,
    };
    if (i > 0) {
      const prev = result[i - 1];
      const effOverlap = getEffectiveTransitionDuration(prev, normalized);
      normalized.start = Number(Math.max(0, prev.start + prev.duration - effOverlap).toFixed(4));
    }
    result.push(normalized);
  }
  return result;
}

function syncNonVideoTracksForCutShift(
  tracks: TimelineTrack[],
  cutTime: number,
  delta: number
): TimelineTrack[] {
  if (Math.abs(delta) <= 1e-4) return tracks;
  return tracks.map((t) => {
    if (t.kind === 'video') return t;
    const updatedClips = t.clips.map((clip) => {
      if (clip.start >= cutTime - 0.05) {
        return {
          ...clip,
          start: Math.max(0, Number((clip.start + delta).toFixed(4))),
        };
      }
      if (clip.start < cutTime - 0.05 && clip.start + clip.duration > cutTime + 0.05) {
        const nextDurRaw = clip.duration + delta;
        const maxDur =
          clip.type === 'audio' && !clip.loop
            ? Math.max(MIN_CLIP_DURATION_SECONDS, clip.sourceDuration - clip.sourceOffset)
            : Number.POSITIVE_INFINITY;
        return {
          ...clip,
          duration: Math.min(maxDur, Math.max(MIN_CLIP_DURATION_SECONDS, Number(nextDurRaw.toFixed(4)))),
        };
      }
      return clip;
    });
    return { ...t, clips: sortClips(updatedClips) };
  });
}

export function getVideoTrackInsertIndexAtTime(clips: TimelineClip[], time: number): number {
  const safeTime = Number.isFinite(time) ? Math.max(0, time) : 0;
  for (let i = 0; i < clips.length; i++) {
    const mid = clips[i].start + clips[i].duration / 2;
    if (safeTime < mid) {
      return i;
    }
  }
  return clips.length;
}

function getExpectedTrackKind(clip: TimelineClip): TrackKind {
  switch (clip.type) {
    case 'video':
      return 'video';
    case 'effect':
      return 'effects';
    case 'image':
      return 'image';
    case 'audio':
      return 'audio';
    case 'text':
      return 'text';
  }
}

function isTrackCompatibleWithClip(trackKind: TrackKind, clip: TimelineClip): boolean {
  if (clip.type === 'text') {
    return trackKind === 'text' || trackKind === 'captions';
  }
  return trackKind === getExpectedTrackKind(clip);
}

export function getTrackKindBaseLabel(kind: TrackKind): string {
  switch (kind) {
    case 'video':
      return 'Video';
    case 'effects':
      return 'Effects';
    case 'captions':
      return 'Captions';
    case 'text':
      return 'Text';
    case 'image':
      return 'Overlay';
    case 'audio':
      return 'Audio';
  }
}

export function renumberTrackRows(tracks: TimelineTrack[]): TimelineTrack[] {
  const counts = new Map<TrackKind, number>();
  return tracks.map((track) => {
    const nextNum = (counts.get(track.kind) ?? 0) + 1;
    counts.set(track.kind, nextNum);
    const base = getTrackKindBaseLabel(track.kind);
    const expectedName = nextNum === 1 ? base : `${base} ${nextNum}`;
    return track.name === expectedName ? track : { ...track, name: expectedName };
  });
}

export function getDeleteTrackRowBlockReason(
  tracks: TimelineTrack[],
  trackId: string
): string | null {
  const track = tracks.find((t) => t.id === trackId);
  if (!track) return 'Row not found';
  if (track.kind === 'video') {
    return 'The Video track cannot be deleted';
  }
  const sameKindCount = tracks.filter((t) => t.kind === track.kind).length;
  if (sameKindCount <= 1) {
    return 'At least one row of this kind is required';
  }
  return null;
}

export function canDeleteTrackRow(tracks: TimelineTrack[], trackId: string): boolean {
  return getDeleteTrackRowBlockReason(tracks, trackId) === null;
}

export function getRemovableEmptyRowIds(tracks: TimelineTrack[]): Set<string> {
  const removable = new Set<string>();
  const byKind = new Map<TrackKind, TimelineTrack[]>();
  for (const track of tracks) {
    if (track.kind === 'video') continue;
    const list = byKind.get(track.kind) ?? [];
    list.push(track);
    byKind.set(track.kind, list);
  }

  for (const kindTracks of byKind.values()) {
    if (kindTracks.length <= 1) continue;
    const hasNonEmpty = kindTracks.some((t) => t.clips.length > 0);
    if (hasNonEmpty) {
      for (const track of kindTracks) {
        if (track.clips.length === 0) {
          removable.add(track.id);
        }
      }
    } else {
      // Keep the first row so at least one row of this kind remains
      for (let i = 1; i < kindTracks.length; i++) {
        removable.add(kindTracks[i].id);
      }
    }
  }

  return removable;
}

export function hasRemovableEmptyRows(tracks: TimelineTrack[]): boolean {
  return getRemovableEmptyRowIds(tracks).size > 0;
}

function insertStackableTrack(
  tracks: TimelineTrack[],
  kind: 'text' | 'image' | 'effects',
  initialClips: TimelineClip[] = []
): { tracks: TimelineTrack[]; createdTrack: TimelineTrack } {
  const existingCount = tracks.filter((t) => t.kind === kind).length;
  const labelBase = getTrackKindBaseLabel(kind);
  const createdTrack: TimelineTrack = {
    id: nextProjectId(`track-${kind}`),
    kind,
    name: existingCount === 0 ? labelBase : `${labelBase} ${existingCount + 1}`,
    muted: false,
    hidden: false,
    clips: sortClips(initialClips),
  };

  // Keep logical DAW/NLE order: video -> effects -> captions -> text rows -> image rows -> audio
  const nextTracks = [...tracks];
  let insertIdx = nextTracks.length;
  if (kind === 'effects') {
    const lastEffects = nextTracks.map((t) => t.kind).lastIndexOf('effects');
    const videoIdx = nextTracks.findIndex((t) => t.kind === 'video');
    insertIdx = lastEffects >= 0 ? lastEffects + 1 : videoIdx >= 0 ? videoIdx + 1 : 0;
  } else if (kind === 'text') {
    const lastText = nextTracks.map((t) => t.kind).lastIndexOf('text');
    const captionsIdx = nextTracks.findIndex((t) => t.kind === 'captions');
    const lastEffects = nextTracks.map((t) => t.kind).lastIndexOf('effects');
    const videoIdx = nextTracks.findIndex((t) => t.kind === 'video');
    insertIdx =
      lastText >= 0
        ? lastText + 1
        : captionsIdx >= 0
          ? captionsIdx + 1
          : lastEffects >= 0
            ? lastEffects + 1
            : videoIdx >= 0
              ? videoIdx + 1
              : 0;
  } else {
    const lastImage = nextTracks.map((t) => t.kind).lastIndexOf('image');
    const audioIdx = nextTracks.findIndex((t) => t.kind === 'audio');
    insertIdx = lastImage >= 0 ? lastImage + 1 : audioIdx >= 0 ? audioIdx : nextTracks.length;
  }
  nextTracks.splice(insertIdx, 0, createdTrack);
  return { tracks: renumberTrackRows(nextTracks), createdTrack };
}

function ensureCaptionsTrack(tracks: TimelineTrack[], captionClips: TextClip[]): TimelineTrack[] {
  const existingIdx = tracks.findIndex((t) => t.kind === 'captions');
  if (existingIdx >= 0) {
    return tracks.map((t, idx) =>
      idx === existingIdx ? { ...t, hidden: false, clips: sortClips(captionClips) } : t
    );
  }
  const captionsTrack: TimelineTrack = {
    id: 'track-captions',
    kind: 'captions',
    name: 'Captions',
    muted: false,
    hidden: false,
    clips: sortClips(captionClips),
  };
  const next = [...tracks];
  const videoIdx = next.findIndex((t) => t.kind === 'video');
  next.splice(videoIdx >= 0 ? videoIdx + 1 : 0, 0, captionsTrack);
  return next;
}

function applyProjectMutation(
  state: ProjectEditorState,
  nextProject: ProjectState,
  nextSelectedClipId: string | null = state.selectedClipId
): ProjectEditorState {
  if (state.dragBaseProject !== null) {
    // Live edit inside an active pointer drag transaction: do not push intermediate undo steps
    return {
      ...state,
      history: {
        ...state.history,
        present: nextProject,
      },
      selectedClipId: nextSelectedClipId,
    };
  }
  return {
    ...state,
    history: pushHistory(state.history, nextProject),
    selectedClipId: nextSelectedClipId,
  };
}

function sanitizeClipPatch(
  clip: TimelineClip,
  patch: ClipPropsPatch,
  trackClips: TimelineClip[],
  isRippleTrack = false
): TimelineClip {
  const { minStart, maxEnd } = isRippleTrack
    ? { minStart: clip.start, maxEnd: Number.POSITIVE_INFINITY }
    : getClipNeighborBounds(trackClips, clip.id);

  if (clip.type === 'effect') {
    const p = patch as Partial<EffectClip>;
    const start =
      typeof p.start === 'number' && Number.isFinite(p.start)
        ? Math.max(minStart, p.start)
        : clip.start;
    const maxAllowedDur = Math.max(MIN_CLIP_DURATION_SECONDS, maxEnd - start);
    const duration =
      typeof p.duration === 'number' && Number.isFinite(p.duration)
        ? Math.min(maxAllowedDur, Math.max(MIN_CLIP_DURATION_SECONDS, p.duration))
        : Math.min(maxAllowedDur, clip.duration);

    return {
      ...clip,
      effectType:
        p.effectType && ALLOWED_VIDEO_EFFECTS.includes(p.effectType)
          ? p.effectType
          : clip.effectType,
      start,
      duration,
      intensity:
        typeof p.intensity === 'number' && Number.isFinite(p.intensity)
          ? clampEffectIntensity(p.intensity)
          : clip.intensity,
    };
  }

  if (clip.type === 'text') {
    const p = patch as Partial<TextClip>;
    const start =
      typeof p.start === 'number' && Number.isFinite(p.start)
        ? Math.max(minStart, p.start)
        : clip.start;
    const maxAllowedDur = Math.max(MIN_CLIP_DURATION_SECONDS, maxEnd - start);
    const duration =
      typeof p.duration === 'number' && Number.isFinite(p.duration)
        ? Math.min(maxAllowedDur, Math.max(MIN_CLIP_DURATION_SECONDS, p.duration))
        : Math.min(maxAllowedDur, clip.duration);

    const nextInType =
      p.animInType && ALLOWED_TEXT_ANIMATIONS.includes(p.animInType)
        ? p.animInType
        : (clip.animInType ?? 'none');
    const nextOutType =
      p.animOutType && ALLOWED_TEXT_ANIMATIONS.includes(p.animOutType)
        ? p.animOutType
        : (clip.animOutType ?? 'none');
    const hadSlide =
      isSlideTextAnimation(clip.animInType) || isSlideTextAnimation(clip.animOutType);
    const hasSlide =
      isSlideTextAnimation(nextInType) || isSlideTextAnimation(nextOutType);
    const nextFadeWithSlide =
      typeof p.fadeWithSlide === 'boolean'
        ? p.fadeWithSlide
        : !hadSlide && hasSlide && clip.fadeWithSlide === undefined
          ? true
          : clip.fadeWithSlide;

    return {
      ...clip,
      text:
        typeof p.text === 'string'
          ? p.text.replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, ' ').slice(0, MAX_TEXT_CLIP_LENGTH)
          : clip.text,
      name:
        typeof p.text === 'string'
          ? p.text.trim().slice(0, 24) || 'Text'
          : clip.name,
      start,
      duration,
      size:
        p.size && ALLOWED_OVERLAY_SIZES.includes(p.size) ? p.size : clip.size,
      color:
        p.color && ALLOWED_OVERLAY_COLORS.includes(p.color) ? p.color : clip.color,
      backgroundBox:
        typeof p.backgroundBox === 'boolean' ? p.backgroundBox : clip.backgroundBox,
      align:
        p.align && ALLOWED_TEXT_ALIGNS.includes(p.align) ? p.align : clip.align,
      xPercent:
        typeof p.xPercent === 'number' && Number.isFinite(p.xPercent)
          ? Math.max(5, Math.min(95, p.xPercent))
          : clip.xPercent,
      yPercent:
        typeof p.yPercent === 'number' && Number.isFinite(p.yPercent)
          ? Math.max(5, Math.min(95, p.yPercent))
          : clip.yPercent,
      animInType: nextInType,
      animInDuration:
        typeof p.animInDuration === 'number'
          ? clampTextAnimationDuration(p.animInDuration)
          : (clip.animInDuration ?? DEFAULT_TEXT_ANIMATION_SECONDS),
      animOutType: nextOutType,
      animOutDuration:
        typeof p.animOutDuration === 'number'
          ? clampTextAnimationDuration(p.animOutDuration)
          : (clip.animOutDuration ?? DEFAULT_TEXT_ANIMATION_SECONDS),
      fadeWithSlide: nextFadeWithSlide,
    };
  }

  if (clip.type === 'image') {
    const p = patch as Partial<ImageClip>;
    const start =
      typeof p.start === 'number' && Number.isFinite(p.start)
        ? Math.max(minStart, p.start)
        : clip.start;
    const maxAllowedDur = Math.max(MIN_CLIP_DURATION_SECONDS, maxEnd - start);
    const duration =
      typeof p.duration === 'number' && Number.isFinite(p.duration)
        ? Math.min(maxAllowedDur, Math.max(MIN_CLIP_DURATION_SECONDS, p.duration))
        : Math.min(maxAllowedDur, clip.duration);

    return {
      ...clip,
      start,
      duration,
      sizePercent:
        typeof p.sizePercent === 'number' && Number.isFinite(p.sizePercent)
          ? Math.max(MIN_IMAGE_SIZE_PERCENT, Math.min(MAX_IMAGE_SIZE_PERCENT, Math.round(p.sizePercent)))
          : clip.sizePercent,
      opacityPercent:
        typeof p.opacityPercent === 'number' && Number.isFinite(p.opacityPercent)
          ? Math.max(0, Math.min(100, Math.round(p.opacityPercent)))
          : clip.opacityPercent,
      xPercent:
        typeof p.xPercent === 'number' && Number.isFinite(p.xPercent)
          ? Math.max(0, Math.min(100, p.xPercent))
          : clip.xPercent,
      yPercent:
        typeof p.yPercent === 'number' && Number.isFinite(p.yPercent)
          ? Math.max(0, Math.min(100, p.yPercent))
          : clip.yPercent,
    };
  }

  if (clip.type === 'audio') {
    const p = patch as Partial<AudioClip>;
    const loop = typeof p.loop === 'boolean' ? p.loop : clip.loop;
    const start =
      typeof p.start === 'number' && Number.isFinite(p.start)
        ? Math.max(minStart, p.start)
        : clip.start;
    const maxBySource = loop ? Number.POSITIVE_INFINITY : Math.max(MIN_CLIP_DURATION_SECONDS, clip.sourceDuration - clip.sourceOffset);
    const maxAllowedDur = Math.max(MIN_CLIP_DURATION_SECONDS, Math.min(maxEnd - start, maxBySource));
    const duration =
      typeof p.duration === 'number' && Number.isFinite(p.duration)
        ? Math.min(maxAllowedDur, Math.max(MIN_CLIP_DURATION_SECONDS, p.duration))
        : Math.min(maxAllowedDur, clip.duration);

    return {
      ...clip,
      start,
      duration,
      loop,
      muted: typeof p.muted === 'boolean' ? p.muted : clip.muted,
      volumePercent:
        typeof p.volumePercent === 'number' && Number.isFinite(p.volumePercent)
          ? Math.max(MIN_VOLUME_PERCENT, Math.min(MAX_VOLUME_PERCENT, Math.round(p.volumePercent)))
          : clip.volumePercent,
      fadeInSeconds:
        typeof p.fadeInSeconds === 'number' && Number.isFinite(p.fadeInSeconds)
          ? Math.max(0, Math.min(MAX_ADDED_AUDIO_FADE_SECONDS, p.fadeInSeconds))
          : clip.fadeInSeconds,
      fadeOutSeconds:
        typeof p.fadeOutSeconds === 'number' && Number.isFinite(p.fadeOutSeconds)
          ? Math.max(0, Math.min(MAX_ADDED_AUDIO_FADE_SECONDS, p.fadeOutSeconds))
          : clip.fadeOutSeconds,
    };
  }

  // Video clip (ripple track allows extending/shrinking freely up to source bounds)
  const p = patch as Partial<VideoClip>;
  const speed: PlaybackSpeed =
    p.speed && ALLOWED_SPEEDS.includes(p.speed) ? p.speed : clip.speed;
  const start = isRippleTrack
    ? clip.start
    : typeof p.start === 'number' && Number.isFinite(p.start)
      ? Math.max(minStart, p.start)
      : clip.start;

  const sourceSpan = Math.max(0, clip.sourceDuration - clip.sourceOffset);
  const currentSourceConsumed = Math.min(sourceSpan, clip.duration * clip.speed);
  const baseDur =
    speed !== clip.speed
      ? currentSourceConsumed / speed
      : typeof p.duration === 'number' && Number.isFinite(p.duration)
        ? p.duration
        : clip.duration;

  const maxBySource = Math.max(MIN_CLIP_DURATION_SECONDS, sourceSpan / speed);
  const maxAllowedDur = isRippleTrack
    ? maxBySource
    : Math.max(MIN_CLIP_DURATION_SECONDS, Math.min(maxEnd - start, maxBySource));
  const duration = Math.min(maxAllowedDur, Math.max(MIN_CLIP_DURATION_SECONDS, baseDur));

  const colorPatch = p.colorFilter ?? clip.colorFilter;
  const colorFilter = {
    preset: ALLOWED_COLOR_PRESETS.includes(colorPatch.preset)
      ? colorPatch.preset
      : clip.colorFilter.preset,
    brightness: Number.isFinite(colorPatch.brightness)
      ? Math.max(-0.5, Math.min(0.5, colorPatch.brightness))
      : clip.colorFilter.brightness,
    contrast: Number.isFinite(colorPatch.contrast)
      ? Math.max(0.5, Math.min(1.5, colorPatch.contrast))
      : clip.colorFilter.contrast,
    saturation: Number.isFinite(colorPatch.saturation)
      ? Math.max(0, Math.min(2, colorPatch.saturation))
      : clip.colorFilter.saturation,
  };

  return {
    ...clip,
    start,
    duration,
    speed,
    volumePercent:
      typeof p.volumePercent === 'number' && Number.isFinite(p.volumePercent)
        ? Math.max(MIN_VOLUME_PERCENT, Math.min(MAX_VOLUME_PERCENT, Math.round(p.volumePercent)))
        : clip.volumePercent,
    muted: typeof p.muted === 'boolean' ? p.muted : clip.muted,
    rotationDegrees:
      p.rotationDegrees !== undefined && ALLOWED_ROTATIONS.includes(p.rotationDegrees)
        ? p.rotationDegrees
        : clip.rotationDegrees,
    flipHorizontal:
      typeof p.flipHorizontal === 'boolean' ? p.flipHorizontal : clip.flipHorizontal,
    cropAspect:
      p.cropAspect && ALLOWED_CROP_ASPECTS.includes(p.cropAspect)
        ? p.cropAspect
        : clip.cropAspect,
    colorFilter,
    fadeInSeconds:
      typeof p.fadeInSeconds === 'number' && Number.isFinite(p.fadeInSeconds)
        ? Math.max(0, Math.min(MAX_FADE_SECONDS, p.fadeInSeconds))
        : clip.fadeInSeconds,
    fadeOutSeconds:
      typeof p.fadeOutSeconds === 'number' && Number.isFinite(p.fadeOutSeconds)
        ? Math.max(0, Math.min(MAX_FADE_SECONDS, p.fadeOutSeconds))
        : clip.fadeOutSeconds,
    transitionOut:
      'transitionOut' in p
        ? normalizeVideoTransition(p.transitionOut)
        : clip.transitionOut,
  };
}

export function projectReducer(
  state: ProjectEditorState,
  action: ProjectAction
): ProjectEditorState {
  const project = state.history.present;

  switch (action.type) {
    case 'SELECT_CLIP':
      return { ...state, selectedClipId: action.clipId };

    case 'SET_PLAYHEAD': {
      const safe = Number.isFinite(action.time) ? Math.max(0, action.time) : 0;
      return { ...state, playhead: safe };
    }

    case 'STEP_PLAYHEAD': {
      const maxDur = Math.max(getProjectDuration(project), state.playhead);
      const next = Math.max(0, Math.min(maxDur, state.playhead + action.deltaSeconds));
      return { ...state, playhead: next };
    }

    case 'SET_ZOOM': {
      const clamped = Math.max(
        MIN_TIMELINE_ZOOM,
        Math.min(MAX_TIMELINE_ZOOM, Math.round(action.zoomPxPerSec))
      );
      return { ...state, zoomPxPerSec: clamped };
    }

    case 'TOGGLE_SNAP':
      return {
        ...state,
        snapEnabled: action.enabled !== undefined ? action.enabled : !state.snapEnabled,
      };

    case 'BEGIN_EDIT_TRANSACTION':
      return {
        ...state,
        dragBaseProject: state.history.present,
      };

    case 'COMMIT_EDIT_TRANSACTION': {
      const base = state.dragBaseProject;
      if (!base) return state;
      if (Object.is(base, state.history.present)) {
        return { ...state, dragBaseProject: null };
      }
      const nextHistory = pushHistory(
        {
          ...state.history,
          present: base,
        },
        state.history.present
      );
      return {
        ...state,
        history: nextHistory,
        dragBaseProject: null,
      };
    }

    case 'UNDO': {
      if (!canUndo(state.history)) return state;
      const nextHist = undoHistory(state.history);
      const stillSelected = findClipInProject(nextHist.present, state.selectedClipId)
        ? state.selectedClipId
        : null;
      return {
        ...state,
        history: nextHist,
        dragBaseProject: null,
        selectedClipId: stillSelected,
      };
    }

    case 'REDO': {
      if (!canRedo(state.history)) return state;
      const nextHist = redoHistory(state.history);
      const stillSelected = findClipInProject(nextHist.present, state.selectedClipId)
        ? state.selectedClipId
        : null;
      return {
        ...state,
        history: nextHist,
        dragBaseProject: null,
        selectedClipId: stillSelected,
      };
    }

    case 'SET_PROJECT_NAME': {
      const trimmed = action.name.slice(0, 60);
      return applyProjectMutation(state, { ...project, name: trimmed });
    }

    case 'LOAD_VIDEO_PROJECT': {
      const nextProject = createProjectWithVideo(action.meta, action.assetId);
      const firstClip = nextProject.tracks[0]?.clips[0] ?? null;
      return {
        history: createHistory(nextProject),
        dragBaseProject: null,
        selectedClipId: firstClip ? firstClip.id : null,
        playhead: 0,
        zoomPxPerSec: state.zoomPxPerSec,
        snapEnabled: state.snapEnabled,
      };
    }

    case 'ADD_TRACK_ROW': {
      const { tracks } = insertStackableTrack(project.tracks, action.kind);
      return applyProjectMutation(state, { ...project, tracks });
    }

    case 'DELETE_TRACK_ROW': {
      if (!canDeleteTrackRow(project.tracks, action.trackId)) {
        return state;
      }
      const targetTrack = project.tracks.find((t) => t.id === action.trackId);
      if (!targetTrack) return state;

      const selectedWasInRow = targetTrack.clips.some((c) => c.id === state.selectedClipId);
      const nextSelected = selectedWasInRow ? null : state.selectedClipId;
      const remaining = project.tracks.filter((t) => t.id !== action.trackId);
      const nextTracks = renumberTrackRows(remaining);

      return applyProjectMutation(state, { ...project, tracks: nextTracks }, nextSelected);
    }

    case 'REMOVE_EMPTY_TRACK_ROWS': {
      const removableIds = getRemovableEmptyRowIds(project.tracks);
      if (removableIds.size === 0) return state;
      const remaining = project.tracks.filter((t) => !removableIds.has(t.id));
      const nextTracks = renumberTrackRows(remaining);
      return applyProjectMutation(state, { ...project, tracks: nextTracks });
    }

    case 'ADD_CLIP': {
      const incoming = {
        ...action.clip,
        start: Math.max(0, action.clip.start),
        duration: Math.max(MIN_CLIP_DURATION_SECONDS, action.clip.duration),
      };

      const targetKind = getExpectedTrackKind(incoming);
      const requestedTrack = action.trackId
        ? project.tracks.find((t) => t.id === action.trackId && isTrackCompatibleWithClip(t.kind, incoming))
        : undefined;

      // For text, image, or effects clips, look for a non-overlapping row or stack a new row
      if (targetKind === 'text' || targetKind === 'image' || targetKind === 'effects') {
        const compatibleTracks = requestedTrack
          ? [requestedTrack, ...project.tracks.filter((t) => t.kind === targetKind && t.id !== requestedTrack.id)]
          : project.tracks.filter((t) => t.kind === targetKind);

        const freeTrack = compatibleTracks.find(
          (t) => !hasOverlapOnTrack(t.clips, incoming.start, incoming.duration)
        );

        if (freeTrack) {
          const nextTracks = project.tracks.map((t) =>
            t.id === freeTrack.id
              ? { ...t, clips: sortClips([...t.clips, incoming]) }
              : t
          );
          return applyProjectMutation(state, { ...project, tracks: nextTracks }, incoming.id);
        }

        const { tracks } = insertStackableTrack(project.tracks, targetKind, [incoming]);
        return applyProjectMutation(state, { ...project, tracks }, incoming.id);
      }

      // Ripple Video track: enforce max 20 clips, insert at requested index/playhead or end, pack without gaps
      if (targetKind === 'video') {
        const videoTrack = requestedTrack ?? project.tracks.find((t) => t.kind === 'video');
        if (!videoTrack) return state;
        if (videoTrack.clips.length >= MAX_VIDEO_TRACK_CLIPS) {
          return state;
        }
        const currentClips = [...videoTrack.clips];
        let insertIdx = currentClips.length;
        if (typeof action.insertIndex === 'number' && Number.isFinite(action.insertIndex)) {
          insertIdx = Math.max(0, Math.min(currentClips.length, Math.round(action.insertIndex)));
        } else if (action.atPlayhead) {
          insertIdx = getVideoTrackInsertIndexAtTime(currentClips, incoming.start);
        }
        currentClips.splice(insertIdx, 0, incoming);
        const rippled = normalizeRippleVideoTrack(currentClips);
        const nextProjectName =
          project.name === 'Untitled Project' && videoTrack.clips.length === 0
            ? incoming.name.replace(/\.(mp4|mov)$/i, '').trim() || 'Untitled Project'
            : project.name;
        const nextTracks = project.tracks.map((t) =>
          t.id === videoTrack.id ? { ...t, clips: rippled } : t
        );
        return applyProjectMutation(
          state,
          { ...project, name: nextProjectName, tracks: nextTracks },
          incoming.id
        );
      }

      // Audio track: place cleanly without overlap
      const track = requestedTrack ?? project.tracks.find((t) => t.kind === targetKind);
      if (!track) return state;
      const safeStart =
        resolveNonOverlappingStart(track.clips, incoming.start, incoming.duration) ?? incoming.start;
      const placed = { ...incoming, start: safeStart };
      const nextTracks = project.tracks.map((t) =>
        t.id === track.id ? { ...t, clips: sortClips([...t.clips, placed]) } : t
      );
      return applyProjectMutation(state, { ...project, tracks: nextTracks }, placed.id);
    }

    case 'REORDER_VIDEO_CLIP': {
      const videoTrack = project.tracks.find((t) => t.kind === 'video');
      if (!videoTrack) return state;
      const fromIndex = videoTrack.clips.findIndex((c) => c.id === action.clipId);
      if (fromIndex < 0) return state;
      const clampedTo = Math.max(0, Math.min(videoTrack.clips.length - 1, Math.round(action.toIndex)));
      if (clampedTo === fromIndex) return state;

      const reordered = [...videoTrack.clips];
      const [moved] = reordered.splice(fromIndex, 1);
      reordered.splice(clampedTo, 0, moved);
      const rippled = normalizeRippleVideoTrack(reordered);

      const nextTracks = project.tracks.map((t) =>
        t.id === videoTrack.id ? { ...t, clips: rippled } : t
      );
      return applyProjectMutation(state, { ...project, tracks: nextTracks });
    }

    case 'MOVE_CLIP': {
      const found = findClipInProject(project, action.clipId);
      if (!found) return state;

      const { track: srcTrack, clip } = found;

      // Ripple Video track: reorder clip by leading/trailing edge relative to neighbor midpoints, pack with no gaps
      if (srcTrack.kind === 'video') {
        const desiredStart = Math.max(0, action.start);
        if (Math.abs(desiredStart - clip.start) < 1e-6) {
          return state;
        }
        const movingLeft = desiredStart < clip.start;
        const others = srcTrack.clips.filter((c) => c.id !== clip.id);
        let insertIdx = others.length;

        if (movingLeft) {
          for (let i = 0; i < others.length; i++) {
            const otherMid = others[i].start + others[i].duration / 2;
            if (desiredStart < otherMid) {
              insertIdx = i;
              break;
            }
          }
        } else {
          const desiredEnd = desiredStart + clip.duration;
          insertIdx = 0;
          for (let i = 0; i < others.length; i++) {
            const otherMid = others[i].start + others[i].duration / 2;
            if (desiredEnd > otherMid) {
              insertIdx = i + 1;
            }
          }
        }

        const reordered = [...others];
        reordered.splice(insertIdx, 0, clip);
        const rippled = normalizeRippleVideoTrack(reordered);
        const nextTracks = project.tracks.map((t) =>
          t.id === srcTrack.id ? { ...t, clips: rippled } : t
        );
        return applyProjectMutation(state, { ...project, tracks: nextTracks });
      }

      const requestedTarget = action.targetTrackId
        ? project.tracks.find((t) => t.id === action.targetTrackId)
        : srcTrack;
      const destTrack =
        requestedTarget && isTrackCompatibleWithClip(requestedTarget.kind, clip)
          ? requestedTarget
          : srcTrack;

      const desiredStart = Math.max(0, action.start);
      const resolvedStart = resolveNonOverlappingStart(
        destTrack.clips,
        desiredStart,
        clip.duration,
        clip.id
      );
      if (resolvedStart === null) return state;

      const updatedClip: TimelineClip = { ...clip, start: resolvedStart };

      const nextTracks = project.tracks.map((t) => {
        if (t.id === srcTrack.id && t.id === destTrack.id) {
          return {
            ...t,
            clips: sortClips(t.clips.map((c) => (c.id === clip.id ? updatedClip : c))),
          };
        }
        if (t.id === srcTrack.id) {
          return { ...t, clips: t.clips.filter((c) => c.id !== clip.id) };
        }
        if (t.id === destTrack.id) {
          return { ...t, clips: sortClips([...t.clips, updatedClip]) };
        }
        return t;
      });

      return applyProjectMutation(state, { ...project, tracks: nextTracks });
    }

    case 'RESIZE_CLIP': {
      const found = findClipInProject(project, action.clipId);
      if (!found) return state;
      const { track, clip } = found;
      if (!Number.isFinite(action.time)) return state;

      const isRippleVideo = track.kind === 'video';
      const { minStart, maxEnd } = isRippleVideo
        ? { minStart: 0, maxEnd: Number.POSITIVE_INFINITY }
        : getClipNeighborBounds(track.clips, clip.id);
      const clipEnd = clip.start + clip.duration;
      let updated: TimelineClip = clip;

      if (action.edge === 'left') {
        let earliestBySource = 0;
        if (clip.type === 'video') {
          earliestBySource = clip.start - clip.sourceOffset / clip.speed;
        } else if (clip.type === 'audio' && !clip.loop) {
          earliestBySource = clip.start - clip.sourceOffset;
        }
        const earliest = Math.max(0, minStart, earliestBySource);
        const latest = clipEnd - MIN_CLIP_DURATION_SECONDS;
        if (latest < earliest) return state;

        const nextStart = Math.max(earliest, Math.min(latest, action.time));
        const delta = nextStart - clip.start;
        const nextDuration = clipEnd - nextStart;

        if (clip.type === 'video') {
          updated = {
            ...clip,
            start: nextStart,
            duration: nextDuration,
            sourceOffset: Math.max(0, clip.sourceOffset + delta * clip.speed),
          };
        } else if (clip.type === 'audio') {
          updated = {
            ...clip,
            start: nextStart,
            duration: nextDuration,
            sourceOffset: clip.loop ? clip.sourceOffset : Math.max(0, clip.sourceOffset + delta),
          };
        } else {
          updated = {
            ...clip,
            start: nextStart,
            duration: nextDuration,
          };
        }
      } else {
        const earliestEnd = clip.start + MIN_CLIP_DURATION_SECONDS;
        let maxBySource = Number.POSITIVE_INFINITY;
        if (clip.type === 'video') {
          maxBySource = clip.start + Math.max(0, clip.sourceDuration - clip.sourceOffset) / clip.speed;
        } else if (clip.type === 'audio' && !clip.loop) {
          maxBySource = clip.start + Math.max(0, clip.sourceDuration - clip.sourceOffset);
        }
        const latestEnd = Math.min(maxEnd, maxBySource);
        if (latestEnd < earliestEnd) return state;

        const nextEnd = Math.max(earliestEnd, Math.min(latestEnd, action.time));
        updated = {
          ...clip,
          duration: nextEnd - clip.start,
        };
      }

      const nextTracks = project.tracks.map((t) => {
        if (t.id !== track.id) return t;
        const replaced = t.clips.map((c) => (c.id === clip.id ? updated : c));
        return {
          ...t,
          clips: isRippleVideo ? normalizeRippleVideoTrack(replaced) : sortClips(replaced),
        };
      });
      return applyProjectMutation(state, { ...project, tracks: nextTracks });
    }

    case 'SPLIT_CLIP_AT_PLAYHEAD': {
      const splitTime = action.time ?? state.playhead;
      if (!Number.isFinite(splitTime)) return state;

      let target = action.clipId ? findClipInProject(project, action.clipId) : null;
      if (!target && state.selectedClipId) {
        target = findClipInProject(project, state.selectedClipId);
      }
      const canSplitClip = (c: TimelineClip) =>
        splitTime >= c.start + MIN_CLIP_DURATION_SECONDS &&
        splitTime <= c.start + c.duration - MIN_CLIP_DURATION_SECONDS;

      if (!target || !canSplitClip(target.clip)) {
        // Fallback: split whichever clip is under playhead (preferring video track)
        for (const t of project.tracks) {
          const hit = t.clips.find(canSplitClip);
          if (hit) {
            target = { track: t, clip: hit };
            break;
          }
        }
      }

      if (!target || !canSplitClip(target.clip)) {
        return state;
      }

      const { track, clip } = target;
      if (track.kind === 'video' && track.clips.length >= MAX_VIDEO_TRACK_CLIPS) {
        return state;
      }

      const leftDuration = splitTime - clip.start;
      const rightDuration = clip.duration - leftDuration;

      let left: TimelineClip;
      let right: TimelineClip;

      if (clip.type === 'video') {
        left = {
          ...clip,
          id: nextProjectId('vid'),
          duration: leftDuration,
          fadeOutSeconds: 0,
          transitionOut: undefined,
        };
        right = {
          ...clip,
          id: nextProjectId('vid'),
          start: splitTime,
          duration: rightDuration,
          sourceOffset: clip.sourceOffset + leftDuration * clip.speed,
          fadeInSeconds: 0,
          transitionOut: clip.transitionOut,
        };
      } else if (clip.type === 'audio') {
        left = {
          ...clip,
          id: nextProjectId('aud'),
          duration: leftDuration,
          fadeOutSeconds: 0,
        };
        right = {
          ...clip,
          id: nextProjectId('aud'),
          start: splitTime,
          duration: rightDuration,
          sourceOffset: clip.loop ? clip.sourceOffset : clip.sourceOffset + leftDuration,
          fadeInSeconds: 0,
        };
      } else if (clip.type === 'effect') {
        left = { ...clip, id: nextProjectId('efx'), duration: leftDuration };
        right = { ...clip, id: nextProjectId('efx'), start: splitTime, duration: rightDuration };
      } else if (clip.type === 'image') {
        left = { ...clip, id: nextProjectId('img'), duration: leftDuration };
        right = { ...clip, id: nextProjectId('img'), start: splitTime, duration: rightDuration };
      } else {
        left = { ...clip, id: nextProjectId('txt'), duration: leftDuration };
        right = { ...clip, id: nextProjectId('txt'), start: splitTime, duration: rightDuration };
      }

      const nextTracks = project.tracks.map((t) => {
        if (t.id !== track.id) return t;
        if (t.kind === 'video') {
          const idx = t.clips.findIndex((c) => c.id === clip.id);
          const next = [...t.clips];
          next.splice(idx, 1, left, right);
          return { ...t, clips: normalizeRippleVideoTrack(next) };
        }
        return {
          ...t,
          clips: sortClips([
            ...t.clips.filter((c) => c.id !== clip.id),
            left,
            right,
          ]),
        };
      });

      return applyProjectMutation(state, { ...project, tracks: nextTracks }, right.id);
    }

    case 'DUPLICATE_CLIP': {
      const targetId = action.clipId ?? state.selectedClipId;
      const found = findClipInProject(project, targetId);
      if (!found) return state;

      const { track, clip } = found;
      if (track.kind === 'video') {
        if (track.clips.length >= MAX_VIDEO_TRACK_CLIPS) {
          return state;
        }
        const copy: VideoClip = {
          ...(clip as VideoClip),
          id: nextProjectId('vid'),
          start: clip.start + clip.duration,
          transitionOut: undefined,
        };
        const idx = track.clips.findIndex((c) => c.id === clip.id);
        const next = [...track.clips];
        next.splice(idx + 1, 0, copy);
        const rippled = normalizeRippleVideoTrack(next);
        const nextTracks = project.tracks.map((t) =>
          t.id === track.id ? { ...t, clips: rippled } : t
        );
        return applyProjectMutation(state, { ...project, tracks: nextTracks }, copy.id);
      }

      const prefix =
        clip.type === 'audio'
          ? 'aud'
          : clip.type === 'image'
            ? 'img'
            : clip.type === 'effect'
              ? 'efx'
              : 'txt';
      const preferredStart = clip.start + clip.duration;

      if (!hasOverlapOnTrack(track.clips, preferredStart, clip.duration)) {
        const copy: TimelineClip = {
          ...clip,
          id: nextProjectId(prefix),
          start: preferredStart,
        };
        const nextTracks = project.tracks.map((t) =>
          t.id === track.id ? { ...t, clips: sortClips([...t.clips, copy]) } : t
        );
        return applyProjectMutation(state, { ...project, tracks: nextTracks }, copy.id);
      }

      if (track.kind === 'text' || track.kind === 'image' || track.kind === 'effects') {
        const stackKind = track.kind;
        const otherRow = project.tracks.find(
          (t) =>
            t.kind === stackKind &&
            t.id !== track.id &&
            !hasOverlapOnTrack(t.clips, clip.start, clip.duration)
        );
        const copy: TimelineClip = {
          ...clip,
          id: nextProjectId(prefix),
          start: clip.start,
        };
        if (otherRow) {
          const nextTracks = project.tracks.map((t) =>
            t.id === otherRow.id ? { ...t, clips: sortClips([...t.clips, copy]) } : t
          );
          return applyProjectMutation(state, { ...project, tracks: nextTracks }, copy.id);
        }
        const { tracks } = insertStackableTrack(project.tracks, stackKind, [copy]);
        return applyProjectMutation(state, { ...project, tracks }, copy.id);
      }

      const fallbackStart =
        resolveNonOverlappingStart(track.clips, preferredStart, clip.duration) ?? preferredStart;
      const copy: TimelineClip = {
        ...clip,
        id: nextProjectId(prefix),
        start: fallbackStart,
      };
      const nextTracks = project.tracks.map((t) =>
        t.id === track.id ? { ...t, clips: sortClips([...t.clips, copy]) } : t
      );
      return applyProjectMutation(state, { ...project, tracks: nextTracks }, copy.id);
    }

    case 'DELETE_CLIP': {
      const found = findClipInProject(project, action.clipId);
      if (!found) return state;

      const nextTracks = project.tracks.map((t) => {
        if (t.id !== found.track.id) return t;
        const filtered = t.clips.filter((c) => c.id !== action.clipId);
        return {
          ...t,
          clips: t.kind === 'video' ? normalizeRippleVideoTrack(filtered) : filtered,
        };
      });
      const nextSelected = state.selectedClipId === action.clipId ? null : state.selectedClipId;
      return applyProjectMutation(state, { ...project, tracks: nextTracks }, nextSelected);
    }

    case 'REMOVE_ASSET_CLIPS': {
      let removedSelected = false;
      const nextTracks = project.tracks.map((t) => {
        const filtered = t.clips.filter((c) => {
          const matchesAsset = 'assetId' in c && c.assetId === action.assetId;
          if (matchesAsset && c.id === state.selectedClipId) {
            removedSelected = true;
          }
          return !matchesAsset;
        });
        return {
          ...t,
          clips: t.kind === 'video' ? normalizeRippleVideoTrack(filtered) : filtered,
        };
      });
      return applyProjectMutation(
        state,
        { ...project, tracks: nextTracks },
        removedSelected ? null : state.selectedClipId
      );
    }

    case 'UPDATE_CLIP_PROPS': {
      const found = findClipInProject(project, action.clipId);
      if (!found) return state;
      const { track, clip } = found;
      const isRippleVideo = track.kind === 'video';
      const updated = sanitizeClipPatch(clip, action.patch, track.clips, isRippleVideo);

      const nextTracks = project.tracks.map((t) => {
        if (t.id !== track.id) return t;
        const mapped = t.clips.map((c) => (c.id === clip.id ? updated : c));
        return {
          ...t,
          clips: isRippleVideo ? normalizeRippleVideoTrack(mapped) : sortClips(mapped),
        };
      });
      return applyProjectMutation(state, { ...project, tracks: nextTracks });
    }

    case 'SET_VIDEO_TRANSITION': {
      const videoTrack = project.tracks.find((t) => t.kind === 'video');
      if (!videoTrack) return state;
      const idx = videoTrack.clips.findIndex((c) => c.id === action.clipId);
      if (idx < 0 || idx >= videoTrack.clips.length - 1) return state;

      const oldNextStart = videoTrack.clips[idx + 1].start;
      const normalizedTr = normalizeVideoTransition(action.transition);
      const updatedRaw = videoTrack.clips.map((c, i) =>
        i === idx && c.type === 'video' ? { ...c, transitionOut: normalizedTr } : c
      );
      const rippled = normalizeRippleVideoTrack(updatedRaw);
      const newNextStart = rippled[idx + 1].start;
      const delta = newNextStart - oldNextStart;

      let nextTracks = project.tracks.map((t) =>
        t.id === videoTrack.id ? { ...t, clips: rippled } : t
      );
      nextTracks = syncNonVideoTracksForCutShift(nextTracks, oldNextStart, delta);

      const newProjectDur = getProjectDuration({ ...project, tracks: nextTracks });
      const nextPlayhead = Math.min(state.playhead, Math.max(0, newProjectDur));
      const mutated = applyProjectMutation(state, { ...project, tracks: nextTracks });
      return { ...mutated, playhead: nextPlayhead };
    }

    case 'APPLY_ANIMATION_TO_ALL_CAPTIONS': {
      const animInType = ALLOWED_TEXT_ANIMATIONS.includes(action.animInType)
        ? action.animInType
        : 'none';
      const animOutType = ALLOWED_TEXT_ANIMATIONS.includes(action.animOutType)
        ? action.animOutType
        : 'none';
      const animInDuration = clampTextAnimationDuration(action.animInDuration);
      const animOutDuration = clampTextAnimationDuration(action.animOutDuration);
      const fadeWithSlide =
        typeof action.fadeWithSlide === 'boolean' ? action.fadeWithSlide : true;

      const nextTracks = project.tracks.map((t) => {
        if (t.kind !== 'captions') return t;
        return {
          ...t,
          clips: t.clips.map((c) =>
            c.type === 'text'
              ? {
                  ...c,
                  animInType,
                  animInDuration,
                  animOutType,
                  animOutDuration,
                  fadeWithSlide,
                }
              : c
          ),
        };
      });
      return applyProjectMutation(state, { ...project, tracks: nextTracks });
    }

    case 'TOGGLE_TRACK_MUTE': {
      const nextTracks = project.tracks.map((t) =>
        t.id === action.trackId ? { ...t, muted: !t.muted } : t
      );
      return applyProjectMutation(state, { ...project, tracks: nextTracks });
    }

    case 'TOGGLE_TRACK_HIDE': {
      const nextTracks = project.tracks.map((t) =>
        t.id === action.trackId ? { ...t, hidden: !t.hidden } : t
      );
      return applyProjectMutation(state, { ...project, tracks: nextTracks });
    }

    case 'SET_CAPTION_CLIPS': {
      const offset = action.timelineOffset ?? 0;
      const built: TextClip[] = [];
      let prevEnd = 0;

      const sorted = [...action.captions].sort((a, b) => a.start - b.start);
      for (const cap of sorted) {
        const rawStart = Math.max(prevEnd, offset + cap.start);
        const rawEnd = offset + cap.end;
        const duration = Math.max(MIN_CLIP_DURATION_SECONDS, rawEnd - rawStart);
        if (rawEnd <= rawStart && rawEnd - rawStart < 0.05) continue;
        const text = cap.text.trim().slice(0, MAX_TEXT_CLIP_LENGTH);
        if (!text) continue;
        built.push({
          id: nextProjectId('cap'),
          type: 'text',
          name: text.slice(0, 24),
          start: rawStart,
          duration,
          sourceOffset: 0,
          text,
          size: 'small',
          color: 'white',
          backgroundBox: true,
          align: 'center',
          xPercent: 50,
          yPercent: 86,
        });
        prevEnd = rawStart + duration;
      }

      const nextTracks = ensureCaptionsTrack(project.tracks, built);
      return applyProjectMutation(state, { ...project, tracks: nextTracks });
    }

    case 'SET_EXPORT_MODE':
      return applyProjectMutation(state, { ...project, exportMode: action.mode });

    case 'SET_EXPORT_SETTINGS': {
      const { resolution, quality, audioOnlyMp3, canvasPreset, canvasFit, fps } = action.settings;
      const safeSettings: ExportSettings = {
        resolution: ALLOWED_EXPORT_RESOLUTIONS.includes(resolution)
          ? resolution
          : project.exportSettings.resolution,
        quality: ALLOWED_EXPORT_QUALITIES.includes(quality)
          ? quality
          : project.exportSettings.quality,
        audioOnlyMp3: Boolean(audioOnlyMp3),
        canvasPreset:
          canvasPreset && ALLOWED_CANVAS_PRESETS.includes(canvasPreset)
            ? canvasPreset
            : (project.exportSettings.canvasPreset ?? 'original'),
        canvasFit:
          canvasFit && ALLOWED_CANVAS_FIT_MODES.includes(canvasFit)
            ? canvasFit
            : (project.exportSettings.canvasFit ?? 'fit'),
        fps:
          typeof fps === 'number' && Number.isFinite(fps) && fps >= 15 && fps <= 60
            ? Math.round(fps)
            : (project.exportSettings.fps ?? DEFAULT_EXPORT_FPS),
      };
      return applyProjectMutation(state, { ...project, exportSettings: safeSettings });
    }
  }
}
