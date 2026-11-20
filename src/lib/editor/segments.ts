import { MIN_TRIM_DURATION_SECONDS, type ValidationResult, type VideoSegment } from './types';

let segmentCounter = 0;

function nextSegmentId(): string {
  segmentCounter += 1;
  return `seg_${segmentCounter}`;
}

export function createInitialSegments(duration: number): VideoSegment[] {
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  return [
    {
      id: nextSegmentId(),
      start: 0,
      end: safeDuration,
      deleted: false,
    },
  ];
}

export function getKeptSegments(segments: VideoSegment[]): VideoSegment[] {
  return segments.filter((seg) => !seg.deleted);
}

export function getTotalKeptDuration(segments: VideoSegment[]): number {
  return getKeptSegments(segments).reduce((sum, seg) => sum + Math.max(0, seg.end - seg.start), 0);
}

export function splitSegmentAtTime(
  segments: VideoSegment[],
  splitTime: number,
  minPieceSeconds = 0.1
): VideoSegment[] | null {
  if (!Number.isFinite(splitTime)) return null;

  const targetIndex = segments.findIndex(
    (seg) =>
      !seg.deleted &&
      splitTime >= seg.start + minPieceSeconds &&
      splitTime <= seg.end - minPieceSeconds
  );

  if (targetIndex < 0) return null;

  const target = segments[targetIndex];
  const left: VideoSegment = {
    id: nextSegmentId(),
    start: target.start,
    end: splitTime,
    deleted: false,
  };
  const right: VideoSegment = {
    id: nextSegmentId(),
    start: splitTime,
    end: target.end,
    deleted: false,
  };

  return [
    ...segments.slice(0, targetIndex),
    left,
    right,
    ...segments.slice(targetIndex + 1),
  ];
}

export function toggleSegmentDeleted(
  segments: VideoSegment[],
  segmentId: string,
  deleted: boolean
): VideoSegment[] {
  return segments.map((seg) => (seg.id === segmentId ? { ...seg, deleted } : seg));
}

export function moveSegment(
  segments: VideoSegment[],
  segmentId: string,
  direction: 'up' | 'down'
): VideoSegment[] {
  const idx = segments.findIndex((seg) => seg.id === segmentId);
  if (idx < 0) return segments;
  const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (targetIdx < 0 || targetIdx >= segments.length) return segments;

  const copy = [...segments];
  const [moved] = copy.splice(idx, 1);
  copy.splice(targetIdx, 0, moved);
  return copy;
}

export function reorderSegments(
  segments: VideoSegment[],
  fromIndex: number,
  toIndex: number
): VideoSegment[] {
  if (
    fromIndex < 0 ||
    fromIndex >= segments.length ||
    toIndex < 0 ||
    toIndex >= segments.length ||
    fromIndex === toIndex
  ) {
    return segments;
  }
  const copy = [...segments];
  const [moved] = copy.splice(fromIndex, 1);
  copy.splice(toIndex, 0, moved);
  return copy;
}

export function validateSegments(
  segments: VideoSegment[],
  duration: number
): ValidationResult<VideoSegment[]> {
  if (!Number.isFinite(duration) || duration <= 0) {
    return {
      ok: false,
      code: 'METADATA_UNREADABLE',
      error: 'Video duration is unavailable.',
    };
  }

  const kept = getKeptSegments(segments);
  if (kept.length === 0) {
    return {
      ok: false,
      code: 'INVALID_SEGMENTS',
      error: 'At least one kept segment of 0.5 seconds or more is required.',
    };
  }

  for (let i = 0; i < kept.length; i++) {
    const seg = kept[i];
    if (!Number.isFinite(seg.start) || !Number.isFinite(seg.end)) {
      return {
        ok: false,
        code: 'INVALID_SEGMENTS',
        error: `Segment #${i + 1} has invalid timestamps.`,
      };
    }
    if (seg.start < 0 || seg.end > duration + 0.01) {
      return {
        ok: false,
        code: 'INVALID_SEGMENTS',
        error: `Segment #${i + 1} is outside the video duration.`,
      };
    }
    if (seg.end <= seg.start) {
      return {
        ok: false,
        code: 'INVALID_SEGMENTS',
        error: `Segment #${i + 1} start time must be earlier than end time.`,
      };
    }
  }

  const hasMinLengthSegment = kept.some(
    (seg) => Math.round((seg.end - seg.start) * 1000) >= Math.round(MIN_TRIM_DURATION_SECONDS * 1000)
  );

  if (!hasMinLengthSegment) {
    return {
      ok: false,
      code: 'INVALID_SEGMENTS',
      error: `At least one kept segment must be at least ${MIN_TRIM_DURATION_SECONDS} seconds long.`,
    };
  }

  return {
    ok: true,
    value: kept.map((seg) => ({
      ...seg,
      end: Math.min(seg.end, duration),
    })),
  };
}
