import { describe, expect, it } from 'vitest';
import {
  canRedo,
  canUndo,
  createHistory,
  MAX_HISTORY_ENTRIES,
  pushHistory,
  redoHistory,
  undoHistory,
} from '../history';
import {
  createInitialSegments,
  getKeptSegments,
  getTotalKeptDuration,
  moveSegment,
  reorderSegments,
  splitSegmentAtTime,
  toggleSegmentDeleted,
  validateSegments,
} from '../segments';

describe('segments logic', () => {
  it('splits at playhead, deletes middle segment, restores, reorders, and calculates final length', () => {
    const initial = createInitialSegments(30);
    expect(initial).toHaveLength(1);
    expect(getTotalKeptDuration(initial)).toBe(30);

    // Split at 10s -> [0..10, 10..30]
    const afterFirstSplit = splitSegmentAtTime(initial, 10);
    expect(afterFirstSplit).not.toBeNull();
    expect(afterFirstSplit).toHaveLength(2);

    // Split second segment at 20s -> [0..10, 10..20, 20..30]
    const afterSecondSplit = splitSegmentAtTime(afterFirstSplit!, 20);
    expect(afterSecondSplit).not.toBeNull();
    expect(afterSecondSplit).toHaveLength(3);
    expect(getTotalKeptDuration(afterSecondSplit!)).toBe(30);

    // Delete middle segment (10..20)
    const middleId = afterSecondSplit![1].id;
    const afterDelete = toggleSegmentDeleted(afterSecondSplit!, middleId, true);
    expect(getKeptSegments(afterDelete)).toHaveLength(2);
    expect(getTotalKeptDuration(afterDelete)).toBe(20);

    // Restore middle segment
    const afterRestore = toggleSegmentDeleted(afterDelete, middleId, false);
    expect(getKeptSegments(afterRestore)).toHaveLength(3);
    expect(getTotalKeptDuration(afterRestore)).toBe(30);

    // Move middle segment up and down
    const movedUp = moveSegment(afterRestore, middleId, 'up');
    expect(movedUp[0].id).toBe(middleId);
    expect(movedUp[1].id).toBe(afterRestore[0].id);

    const movedDown = moveSegment(movedUp, middleId, 'down');
    expect(movedDown[1].id).toBe(middleId);

    // Reorder via drag indices (move index 2 to index 0)
    const dragged = reorderSegments(movedDown, 2, 0);
    expect(dragged[0].id).toBe(movedDown[2].id);
    expect(dragged[1].id).toBe(movedDown[0].id);
  });

  it('rejects splitting near segment edges or inside deleted segments', () => {
    const segs = [
      { id: 'a', start: 0, end: 10, deleted: false },
      { id: 'b', start: 10, end: 20, deleted: true },
    ];
    expect(splitSegmentAtTime(segs, 0.05)).toBeNull();
    expect(splitSegmentAtTime(segs, 9.95)).toBeNull();
    expect(splitSegmentAtTime(segs, 15)).toBeNull();
    expect(splitSegmentAtTime(segs, Number.NaN)).toBeNull();
  });

  it('validates segments requiring at least one kept segment of >= 0.5s and clamps end tolerance', () => {
    // All deleted
    const allDeleted = [{ id: 'a', start: 0, end: 10, deleted: true }];
    expect(validateSegments(allDeleted, 10).ok).toBe(false);

    // Only short kept segments (< 0.5s)
    const tooShort = [{ id: 'a', start: 0, end: 0.49, deleted: false }];
    expect(validateSegments(tooShort, 10).ok).toBe(false);

    // Out of bounds (> duration + 0.01)
    const outOfBounds = [{ id: 'a', start: 0, end: 10.05, deleted: false }];
    expect(validateSegments(outOfBounds, 10).ok).toBe(false);

    // Within 0.01s tolerance clamps to exact unrounded duration
    const slightRound = [{ id: 'a', start: 0, end: 10.24, deleted: false }];
    const res = validateSegments(slightRound, 10.236);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value[0].end).toBe(10.236);
    }
  });
});

describe('history (undo/redo)', () => {
  it('supports push, undo, redo, clearing future on new edit, and capping at MAX_HISTORY_ENTRIES', () => {
    let h = createHistory(0);
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(false);

    h = pushHistory(h, 1);
    h = pushHistory(h, 2);
    expect(h.present).toBe(2);
    expect(canUndo(h)).toBe(true);
    expect(canRedo(h)).toBe(false);

    // No-op if identical reference
    expect(pushHistory(h, 2)).toBe(h);

    h = undoHistory(h);
    expect(h.present).toBe(1);
    expect(canUndo(h)).toBe(true);
    expect(canRedo(h)).toBe(true);

    h = undoHistory(h);
    expect(h.present).toBe(0);
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(true);

    // Redo back to 1
    h = redoHistory(h);
    expect(h.present).toBe(1);

    // New edit clears redo future stack
    h = pushHistory(h, 99);
    expect(h.present).toBe(99);
    expect(canRedo(h)).toBe(false);

    // Cap past length at MAX_HISTORY_ENTRIES
    let capped = createHistory(0);
    for (let i = 1; i <= MAX_HISTORY_ENTRIES + 15; i++) {
      capped = pushHistory(capped, i);
    }
    expect(capped.past.length).toBe(MAX_HISTORY_ENTRIES);
    expect(capped.present).toBe(MAX_HISTORY_ENTRIES + 15);
  });
});
