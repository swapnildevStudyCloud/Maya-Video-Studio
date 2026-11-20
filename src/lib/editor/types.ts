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
  | 'CLIP_TOO_SHORT';

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

export type RenderPhase = 'loading' | 'preparing' | 'processing' | 'finalizing';

export interface RenderProgress {
  phase: RenderPhase;
  /** Normalized progress from 0 to 1 */
  progress: number;
  /** Processed time in seconds when reported by ffmpeg */
  timeSeconds?: number;
}

export interface RenderResult {
  blob: Blob;
  size: number;
  duration: number;
  mode: ExportMode;
  suggestedFilename: string;
}

export const MAX_FILE_SIZE_BYTES = 200 * 1024 * 1024; // 200 MB
export const MAX_DURATION_SECONDS = 10 * 60; // 10 minutes
export const MIN_TRIM_DURATION_SECONDS = 0.5;
export const TRIM_BOUNDS_TOLERANCE_SECONDS = 0.01;

export const INTERNAL_INPUT_FILENAME = 'input.mp4';
export const INTERNAL_OUTPUT_FILENAME = 'output.mp4';
