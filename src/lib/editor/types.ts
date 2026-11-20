export type ExportMode = 'fast' | 'precise';

export type ValidationErrorCode =
  | 'EMPTY_FILE'
  | 'UNSUPPORTED_TYPE'
  | 'FILE_TOO_LARGE'
  | 'INVALID_CONTAINER'
  | 'METADATA_UNREADABLE'
  | 'DURATION_TOO_LONG'
  | 'INVALID_NUMBER'
  | 'NEGATIVE_TIME'
  | 'OUT_OF_BOUNDS'
  | 'INVALID_ORDER'
  | 'CLIP_TOO_SHORT'
  | 'INVALID_TOOL_CONFIG'
  | 'INVALID_SEGMENTS'
  | 'INVALID_PROJECT';

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; code: ValidationErrorCode };

export interface VideoFileMetadata {
  name: string;
  size: number;
  mimeType: string;
  duration: number;
  width: number;
  height: number;
  extension: 'mp4' | 'mov';
}

export interface TrimRange {
  start: number;
  end: number;
}

export interface VideoSegment {
  id: string;
  start: number;
  end: number;
  deleted: boolean;
}

export type TextOverlayPosition = 'top' | 'center' | 'bottom';
export type TextOverlaySize = 'small' | 'medium' | 'large';
export type TextOverlayColor = 'white' | 'yellow' | 'black';

export interface TextOverlay {
  id: string;
  text: string;
  start: number;
  end: number;
  position: TextOverlayPosition;
  size: TextOverlaySize;
  color: TextOverlayColor;
}

export type PlaybackSpeed = 0.5 | 1 | 1.5 | 2;
export type RotationDegrees = 0 | 90 | 180 | 270;
export type CropAspectRatio = 'original' | '9:16' | '1:1' | '16:9';

export interface AudioSettings {
  muted: boolean;
  volumePercent: number;
}

export type AddedAudioFormat = 'mp3' | 'wav' | 'm4a';

export interface AddedAudioConfig {
  file: File | null;
  name: string;
  format: AddedAudioFormat | null;
  startOffsetSeconds: number;
  volumePercent: number;
  loopToVideo: boolean;
  fadeInSeconds: number;
  fadeOutSeconds: number;
}

export type ImageOverlayPosition =
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'
  | 'center';

export type ImageOverlayFormat = 'png' | 'jpg';

export interface ImageOverlayConfig {
  file: File | null;
  name: string;
  format: ImageOverlayFormat | null;
  position: ImageOverlayPosition;
  sizePercent: number;
  opacityPercent: number;
  start: number;
  end: number;
}

export type ColorFilterPreset = 'none' | 'bw' | 'warm' | 'cool';

export interface ColorFilterConfig {
  preset: ColorFilterPreset;
  brightness: number; // -0.5 .. 0.5
  contrast: number; // 0.5 .. 1.5
  saturation: number; // 0 .. 2
}

export type ExportResolution = 'original' | '1080p' | '720p' | '480p';
export type ExportCanvasPreset = 'original' | '1080p-16:9' | '720p-16:9' | '9:16' | '1:1';
export type CanvasFitMode = 'fit' | 'fill';
export type ExportQuality = 'draft' | 'small' | 'balanced' | 'high';

export interface ExportSettings {
  resolution: ExportResolution;
  quality: ExportQuality;
  audioOnlyMp3: boolean;
  canvasPreset?: ExportCanvasPreset;
  canvasFit?: CanvasFitMode;
  fps?: number;
}

export interface FadeSettings {
  fadeInSeconds: number;
  fadeOutSeconds: number;
}

export interface CaptionSegment {
  id: string;
  start: number;
  end: number;
  text: string;
}

export interface EditToolsConfig {
  textOverlays: TextOverlay[];
  speed: PlaybackSpeed;
  audio: AudioSettings;
  addedAudio: AddedAudioConfig;
  imageOverlay: ImageOverlayConfig;
  colorFilter: ColorFilterConfig;
  rotationDegrees: RotationDegrees;
  flipHorizontal: boolean;
  cropAspect: CropAspectRatio;
  fade: FadeSettings;
  burnCaptions: boolean;
  captions: CaptionSegment[];
  exportSettings: ExportSettings;
}

// ---------------------------------------------------------------------------
// Timeline Project Data Model (CapCut/Premiere-style NLE)
// ---------------------------------------------------------------------------

export type TrackKind = 'video' | 'effects' | 'captions' | 'text' | 'image' | 'audio';
export type TextClipAlign = 'left' | 'center' | 'right';

export type TextAnimationType =
  | 'none'
  | 'fade'
  | 'slide-up'
  | 'slide-down'
  | 'slide-left'
  | 'slide-right'
  | 'pop';

export type VideoEffectType =
  | 'blur'
  | 'sharpen'
  | 'vignette'
  | 'film-grain'
  | 'glitch-rgb'
  | 'camera-shake'
  | 'bw'
  | 'sepia'
  | 'invert'
  | 'pixelate'
  | 'mirror'
  | 'flash';

export type VideoTransitionType =
  | 'none'
  | 'fade'
  | 'dissolve'
  | 'wipe-left'
  | 'wipe-right'
  | 'slide-left'
  | 'slide-right';

export interface VideoTransition {
  type: VideoTransitionType;
  duration: number;
}

export interface VideoClip {
  id: string;
  type: 'video';
  assetId: string;
  name: string;
  start: number;
  duration: number;
  sourceOffset: number;
  sourceDuration: number;
  speed: PlaybackSpeed;
  volumePercent: number;
  muted: boolean;
  rotationDegrees: RotationDegrees;
  flipHorizontal: boolean;
  cropAspect: CropAspectRatio;
  colorFilter: ColorFilterConfig;
  fadeInSeconds: number;
  fadeOutSeconds: number;
  transitionOut?: VideoTransition;
}

export interface EffectClip {
  id: string;
  type: 'effect';
  name: string;
  effectType: VideoEffectType;
  start: number;
  duration: number;
  sourceOffset: number;
  intensity: number; // 0 .. 100
}

export interface TextClip {
  id: string;
  type: 'text';
  name: string;
  start: number;
  duration: number;
  sourceOffset: number;
  text: string;
  size: TextOverlaySize;
  color: TextOverlayColor;
  backgroundBox: boolean;
  align: TextClipAlign;
  xPercent: number; // 0 .. 100
  yPercent: number; // 0 .. 100
  animInType?: TextAnimationType;
  animInDuration?: number;
  animOutType?: TextAnimationType;
  animOutDuration?: number;
}

export interface ImageClip {
  id: string;
  type: 'image';
  assetId: string;
  name: string;
  format: ImageOverlayFormat;
  start: number;
  duration: number;
  sourceOffset: number;
  sizePercent: number; // 5 .. 50
  opacityPercent: number; // 0 .. 100
  xPercent: number; // 0 .. 100
  yPercent: number; // 0 .. 100
}

export interface AudioClip {
  id: string;
  type: 'audio';
  assetId: string;
  name: string;
  format: AddedAudioFormat;
  start: number;
  duration: number;
  sourceOffset: number;
  sourceDuration: number;
  volumePercent: number;
  muted: boolean;
  loop: boolean;
  fadeInSeconds: number;
  fadeOutSeconds: number;
}

export type TimelineClip = VideoClip | EffectClip | TextClip | ImageClip | AudioClip;

export interface TimelineTrack {
  id: string;
  kind: TrackKind;
  name: string;
  muted: boolean;
  hidden: boolean;
  clips: TimelineClip[];
}

export type MediaAsset =
  | {
      id: string;
      kind: 'video';
      name: string;
      file: File;
      size: number;
      extension: 'mp4' | 'mov';
      duration: number;
      width: number;
      height: number;
      objectUrl: string;
      thumbnailUrl?: string;
    }
  | {
      id: string;
      kind: 'audio';
      name: string;
      file: File;
      size: number;
      format: AddedAudioFormat;
      duration: number;
      waveform: number[];
      objectUrl: string;
    }
  | {
      id: string;
      kind: 'image';
      name: string;
      file: File;
      size: number;
      format: ImageOverlayFormat;
      width: number;
      height: number;
      objectUrl: string;
    };

export interface ProjectState {
  name: string;
  tracks: TimelineTrack[];
  exportMode: ExportMode;
  exportSettings: ExportSettings;
}

export type RenderPhase = 'loading' | 'preparing' | 'processing' | 'finalizing';

export interface RenderProgress {
  phase: RenderPhase;
  /** Normalized progress from 0 to 1 */
  progress: number;
  /** Processed time in seconds when reported by ffmpeg */
  timeSeconds?: number;
  /** Human-readable status text (e.g., core download byte progress) */
  statusText?: string;
}

export interface RenderResult {
  blob: Blob;
  size: number;
  duration: number;
  mode: ExportMode;
  suggestedFilename: string;
  isAudioOnly: boolean;
}

export interface ExtractedAudioResult {
  bytes: Uint8Array;
  mimeType: 'audio/mp3';
  duration: number;
}

export const MAX_FILE_SIZE_BYTES = 200 * 1024 * 1024; // 200 MB
export const MAX_TOTAL_VIDEO_SIZE_BYTES = 400 * 1024 * 1024; // 400 MB total across imported videos
export const MAX_VIDEO_TRACK_CLIPS = 20;
export const MAX_AUDIO_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB
export const MAX_IMAGE_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
export const MAX_DURATION_SECONDS = 10 * 60; // 10 minutes
export const MIN_TRIM_DURATION_SECONDS = 0.5;
export const MIN_CLIP_DURATION_SECONDS = 0.2;
export const DEFAULT_TEXT_CLIP_DURATION = 3;
export const DEFAULT_IMAGE_CLIP_DURATION = 3;
export const DEFAULT_EFFECT_CLIP_DURATION = 3;
export const DEFAULT_EXPORT_FPS = 30;
export const DRAFT_EXPORT_FPS = 24;
export const DRAFT_MAX_SHORT_SIDE = 480;
export const TRIM_BOUNDS_TOLERANCE_SECONDS = 0.01;
export const SLOW_REENCODE_WARNING_SECONDS = 120; // 2 minutes
export const HEAVY_EFFECTS_WARNING_SECONDS = 60; // 1 minute
export const HEAVY_EFFECTS_MIN_COUNT = 3;
export const MIN_FONT_SIZE_BYTES = 1024; // 1 KB

export const MIN_TEXT_ANIMATION_SECONDS = 0.1;
export const MAX_TEXT_ANIMATION_SECONDS = 2;
export const DEFAULT_TEXT_ANIMATION_SECONDS = 0.5;
export const TEXT_SLIDE_HORIZONTAL_PCT = 20;
export const TEXT_SLIDE_VERTICAL_PCT = 12;

export const MIN_EFFECT_INTENSITY = 0;
export const MAX_EFFECT_INTENSITY = 100;

export const MIN_TRANSITION_DURATION_SECONDS = 0.2;
export const MAX_TRANSITION_DURATION_SECONDS = 2;
export const DEFAULT_TRANSITION_DURATION_SECONDS = 0.6;

export const MAX_TEXT_OVERLAYS = 5;
export const MAX_TEXT_OVERLAY_LENGTH = 80;
export const MAX_TEXT_CLIP_LENGTH = 120;
export const MAX_FADE_SECONDS = 2;
export const MAX_ADDED_AUDIO_FADE_SECONDS = 3;
export const MIN_VOLUME_PERCENT = 0;
export const MAX_VOLUME_PERCENT = 200;
export const MIN_IMAGE_SIZE_PERCENT = 5;
export const MAX_IMAGE_SIZE_PERCENT = 50;

export const MAX_CAPTION_SEGMENTS = 120;
export const MAX_CAPTION_TEXT_LENGTH = 160;
export const MAX_GEMINI_INLINE_BYTES = 15 * 1024 * 1024; // ~15 MB safety ceiling

export const ALLOWED_SPEEDS: readonly PlaybackSpeed[] = [0.5, 1, 1.5, 2];
export const ALLOWED_ROTATIONS: readonly RotationDegrees[] = [0, 90, 180, 270];
export const ALLOWED_CROP_ASPECTS: readonly CropAspectRatio[] = [
  'original',
  '9:16',
  '1:1',
  '16:9',
];
export const ALLOWED_OVERLAY_POSITIONS: readonly TextOverlayPosition[] = [
  'top',
  'center',
  'bottom',
];
export const ALLOWED_OVERLAY_SIZES: readonly TextOverlaySize[] = ['small', 'medium', 'large'];
export const ALLOWED_OVERLAY_COLORS: readonly TextOverlayColor[] = ['white', 'yellow', 'black'];
export const ALLOWED_TEXT_ALIGNS: readonly TextClipAlign[] = ['left', 'center', 'right'];
export const ALLOWED_TEXT_ANIMATIONS: readonly TextAnimationType[] = [
  'none',
  'fade',
  'slide-up',
  'slide-down',
  'slide-left',
  'slide-right',
  'pop',
];
export const ALLOWED_VIDEO_EFFECTS: readonly VideoEffectType[] = [
  'blur',
  'sharpen',
  'vignette',
  'film-grain',
  'glitch-rgb',
  'camera-shake',
  'bw',
  'sepia',
  'invert',
  'pixelate',
  'mirror',
  'flash',
];
export const ALLOWED_VIDEO_TRANSITIONS: readonly VideoTransitionType[] = [
  'none',
  'fade',
  'dissolve',
  'wipe-left',
  'wipe-right',
  'slide-left',
  'slide-right',
];
export const ALLOWED_IMAGE_POSITIONS: readonly ImageOverlayPosition[] = [
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
  'center',
];
export const ALLOWED_COLOR_PRESETS: readonly ColorFilterPreset[] = ['none', 'bw', 'warm', 'cool'];
export const ALLOWED_EXPORT_RESOLUTIONS: readonly ExportResolution[] = [
  'original',
  '1080p',
  '720p',
  '480p',
];
export const ALLOWED_CANVAS_PRESETS: readonly ExportCanvasPreset[] = [
  'original',
  '1080p-16:9',
  '720p-16:9',
  '9:16',
  '1:1',
];
export const ALLOWED_CANVAS_FIT_MODES: readonly CanvasFitMode[] = ['fit', 'fill'];
export const ALLOWED_EXPORT_QUALITIES: readonly ExportQuality[] = [
  'draft',
  'small',
  'balanced',
  'high',
];

export const INTERNAL_INPUT_FILENAME = 'input.mp4';
export const INTERNAL_OUTPUT_FILENAME = 'output.mp4';
export const INTERNAL_OUTPUT_AUDIO_FILENAME = 'output.mp3';
export const INTERNAL_FONT_FILENAME = 'font.ttf';
export const INTERNAL_AUDIO_FILENAME = 'audio.mp3';

export function createDefaultAddedAudio(): AddedAudioConfig {
  return {
    file: null,
    name: '',
    format: null,
    startOffsetSeconds: 0,
    volumePercent: 100,
    loopToVideo: false,
    fadeInSeconds: 0,
    fadeOutSeconds: 0,
  };
}

export function createDefaultImageOverlay(): ImageOverlayConfig {
  return {
    file: null,
    name: '',
    format: null,
    position: 'top-right',
    sizePercent: 15,
    opacityPercent: 90,
    start: 0,
    end: 3,
  };
}

export function createDefaultColorFilter(): ColorFilterConfig {
  return {
    preset: 'none',
    brightness: 0,
    contrast: 1,
    saturation: 1,
  };
}

export function createDefaultExportSettings(): ExportSettings {
  return {
    resolution: 'original',
    quality: 'balanced',
    audioOnlyMp3: false,
    canvasPreset: 'original',
    canvasFit: 'fit',
    fps: DEFAULT_EXPORT_FPS,
  };
}

export function createDefaultEditTools(): EditToolsConfig {
  return {
    textOverlays: [],
    speed: 1,
    audio: {
      muted: false,
      volumePercent: 100,
    },
    addedAudio: createDefaultAddedAudio(),
    imageOverlay: createDefaultImageOverlay(),
    colorFilter: createDefaultColorFilter(),
    rotationDegrees: 0,
    flipHorizontal: false,
    cropAspect: 'original',
    fade: {
      fadeInSeconds: 0,
      fadeOutSeconds: 0,
    },
    burnCaptions: false,
    captions: [],
    exportSettings: createDefaultExportSettings(),
  };
}
