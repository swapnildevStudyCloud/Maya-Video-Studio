import {
  MIN_TRIM_DURATION_SECONDS,
  TRIM_BOUNDS_TOLERANCE_SECONDS,
  type TrimRange,
  type ValidationResult,
} from './types';

export function validateTrimRange(
  start: number,
  end: number,
  duration: number
): ValidationResult<TrimRange> {
  if (!Number.isFinite(duration) || duration <= 0) {
    return {
      ok: false,
      code: 'METADATA_UNREADABLE',
      error: 'Video duration is unavailable.',
    };
  }

  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return {
      ok: false,
      code: 'INVALID_NUMBER',
      error: 'Start and end times must be finite numbers.',
    };
  }

  if (start < 0 || end < 0) {
    return {
      ok: false,
      code: 'NEGATIVE_TIME',
      error: 'Start and end times cannot be negative.',
    };
  }

  // Compare against the real unrounded duration with a 0.01 s tolerance,
  // then clamp End (and Start) to the actual duration.
  const maxAllowed = duration + TRIM_BOUNDS_TOLERANCE_SECONDS + 1e-9;
  if (start > maxAllowed || end > maxAllowed) {
    return {
      ok: false,
      code: 'OUT_OF_BOUNDS',
      error: `Start and end times must be within the video duration (0 to ${duration.toFixed(2)} s).`,
    };
  }

  const clampedStart = Math.min(start, duration);
  const clampedEnd = Math.min(end, duration);

  if (clampedStart >= clampedEnd) {
    return {
      ok: false,
      code: 'INVALID_ORDER',
      error: 'Start time must be less than end time.',
    };
  }

  // Compare at millisecond precision to avoid IEEE-754 inaccuracies (e.g., 0.7 - 0.2).
  const durationMs = Math.round((clampedEnd - clampedStart) * 1000);
  const minMs = Math.round(MIN_TRIM_DURATION_SECONDS * 1000);
  if (durationMs < minMs) {
    return {
      ok: false,
      code: 'CLIP_TOO_SHORT',
      error: `Trimmed duration must be at least ${MIN_TRIM_DURATION_SECONDS} seconds.`,
    };
  }

  return {
    ok: true,
    value: { start: clampedStart, end: clampedEnd },
  };
}

export function formatTimecode(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '00:00.00';
  }
  const mins = Math.floor(seconds / 60);
  const secs = seconds - mins * 60;
  const minsStr = String(mins).padStart(2, '0');
  const secsStr = secs.toFixed(2).padStart(5, '0');
  return `${minsStr}:${secsStr}`;
}
