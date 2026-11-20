import type { TimelineClip, TimelineTrack } from './types';

const TIME_EPSILON = 1e-4;

export function getSnapTargets(
  tracks: TimelineTrack[],
  playhead: number,
  excludeClipId?: string
): number[] {
  const targets = new Set<number>([0]);
  if (Number.isFinite(playhead) && playhead >= 0) {
    targets.add(playhead);
  }
  for (const track of tracks) {
    for (const clip of track.clips) {
      if (clip.id === excludeClipId) continue;
      targets.add(clip.start);
      targets.add(clip.start + clip.duration);
    }
  }
  return Array.from(targets).sort((a, b) => a - b);
}

export function snapTime(
  candidateTime: number,
  targets: number[],
  toleranceSeconds: number
): { time: number; snappedTo: number | null } {
  if (!Number.isFinite(candidateTime) || toleranceSeconds <= 0) {
    return { time: candidateTime, snappedTo: null };
  }

  let bestTarget: number | null = null;
  let bestDist = toleranceSeconds;

  for (const target of targets) {
    const dist = Math.abs(candidateTime - target);
    if (dist <= bestDist) {
      bestDist = dist;
      bestTarget = target;
    }
  }

  if (bestTarget !== null) {
    return { time: bestTarget, snappedTo: bestTarget };
  }
  return { time: candidateTime, snappedTo: null };
}

/**
 * Snaps either the leading edge or trailing edge of a clip being moved.
 */
export function snapClipMoveStart(params: {
  desiredStart: number;
  duration: number;
  targets: number[];
  toleranceSeconds: number;
}): { start: number; snappedTo: number | null } {
  const { desiredStart, duration, targets, toleranceSeconds } = params;
  const clampedStart = Math.max(0, desiredStart);
  const startSnap = snapTime(clampedStart, targets, toleranceSeconds);
  const endSnap = snapTime(clampedStart + duration, targets, toleranceSeconds);

  if (startSnap.snappedTo !== null && endSnap.snappedTo !== null) {
    const startDist = Math.abs(clampedStart - startSnap.snappedTo);
    const endDist = Math.abs(clampedStart + duration - endSnap.snappedTo);
    if (startDist <= endDist) {
      return { start: startSnap.time, snappedTo: startSnap.snappedTo };
    }
    return {
      start: Math.max(0, endSnap.time - duration),
      snappedTo: endSnap.snappedTo,
    };
  }

  if (startSnap.snappedTo !== null) {
    return { start: startSnap.time, snappedTo: startSnap.snappedTo };
  }

  if (endSnap.snappedTo !== null) {
    return {
      start: Math.max(0, endSnap.time - duration),
      snappedTo: endSnap.snappedTo,
    };
  }

  return { start: clampedStart, snappedTo: null };
}

export function hasOverlapOnTrack(
  clips: TimelineClip[],
  start: number,
  duration: number,
  excludeClipId?: string
): boolean {
  const end = start + duration;
  return clips.some((other) => {
    if (other.id === excludeClipId) return false;
    const otherEnd = other.start + other.duration;
    return start < otherEnd - TIME_EPSILON && end > other.start + TIME_EPSILON;
  });
}

/**
 * Given a desired start and fixed duration on a single track, resolves the nearest
 * non-overlapping start >= 0 (clamping into adjacent free gap if possible).
 */
export function resolveNonOverlappingStart(
  clips: TimelineClip[],
  desiredStart: number,
  duration: number,
  excludeClipId?: string
): number | null {
  const clampedDesired = Math.max(0, desiredStart);
  const others = clips
    .filter((c) => c.id !== excludeClipId)
    .sort((a, b) => a.start - b.start);

  if (others.length === 0) {
    return clampedDesired;
  }

  if (!hasOverlapOnTrack(others, clampedDesired, duration)) {
    return clampedDesired;
  }

  // Build valid candidate slots [gapStart, gapEnd - duration]
  const candidates: number[] = [];
  let cursor = 0;

  for (const other of others) {
    if (other.start - cursor >= duration - TIME_EPSILON) {
      const slotMin = cursor;
      const slotMax = other.start - duration;
      const clamped = Math.max(slotMin, Math.min(slotMax, clampedDesired));
      if (!hasOverlapOnTrack(others, clamped, duration)) {
        candidates.push(clamped);
      }
    }
    cursor = Math.max(cursor, other.start + other.duration);
  }

  // Trailing open slot after the last clip
  const afterLast = Math.max(cursor, clampedDesired);
  candidates.push(afterLast);

  // Pick closest candidate that matches user drag direction cleanly
  let best = candidates[0];
  let bestDist = Math.abs(best - clampedDesired);
  for (const cand of candidates) {
    const dist = Math.abs(cand - clampedDesired);
    if (dist < bestDist) {
      bestDist = dist;
      best = cand;
    }
  }
  return best;
}

/**
 * Returns [minStart, maxEnd] open boundaries around an existing clip on its track
 * so resizing left or right edges never overlaps neighbors.
 */
export function getClipNeighborBounds(
  clips: TimelineClip[],
  clipId: string
): { minStart: number; maxEnd: number } {
  const sorted = [...clips].sort((a, b) => a.start - b.start);
  const idx = sorted.findIndex((c) => c.id === clipId);
  if (idx < 0) {
    return { minStart: 0, maxEnd: Number.POSITIVE_INFINITY };
  }
  const prev = idx > 0 ? sorted[idx - 1] : null;
  const next = idx < sorted.length - 1 ? sorted[idx + 1] : null;
  return {
    minStart: prev ? prev.start + prev.duration : 0,
    maxEnd: next ? next.start : Number.POSITIVE_INFINITY,
  };
}
