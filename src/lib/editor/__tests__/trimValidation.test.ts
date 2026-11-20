import { describe, expect, it } from 'vitest';
import { formatTimecode, validateTrimRange } from '../trimValidation';

describe('validateTrimRange', () => {
  const duration = 30;

  it('accepts a valid trim range', () => {
    const result = validateTrimRange(2.5, 12.5, duration);
    expect(result).toEqual({
      ok: true,
      value: { start: 2.5, end: 12.5 },
    });
  });

  it('accepts a range of exact minimum length 0.5s including float boundaries', () => {
    expect(validateTrimRange(0, 0.5, duration).ok).toBe(true);
    // 0.7 - 0.2 === 0.49999999999999994 in IEEE-754
    expect(validateTrimRange(0.2, 0.7, duration).ok).toBe(true);
    expect(validateTrimRange(0, duration, duration).ok).toBe(true);
  });

  it('compares against real unrounded duration, allows 0.01s tolerance, and clamps End to actual duration', () => {
    // Unrounded duration 10.236s; rounded UI display "10.24" is within 0.01s tolerance
    const roundedUpInput = validateTrimRange(0, 10.24, 10.236);
    expect(roundedUpInput).toEqual({
      ok: true,
      value: { start: 0, end: 10.236 },
    });

    // Exact 0.01s boundary (including 10.1 + 0.01 IEEE-754 boundary)
    expect(validateTrimRange(0, 10.01, 10)).toEqual({
      ok: true,
      value: { start: 0, end: 10 },
    });
    expect(validateTrimRange(0, 10.11, 10.1)).toEqual({
      ok: true,
      value: { start: 0, end: 10.1 },
    });

    // Unrounded end equals unrounded duration
    expect(validateTrimRange(1.25, 10.236, 10.236)).toEqual({
      ok: true,
      value: { start: 1.25, end: 10.236 },
    });

    // Clamping End must still enforce minimum clip duration and start < end
    const tooShortAfterClamp = validateTrimRange(9.75, 10.24, 10.236);
    expect(tooShortAfterClamp.ok).toBe(false);
    if (!tooShortAfterClamp.ok) expect(tooShortAfterClamp.code).toBe('CLIP_TOO_SHORT');

    const invalidOrderAfterClamp = validateTrimRange(10.005, 10.008, 10);
    expect(invalidOrderAfterClamp.ok).toBe(false);
    if (!invalidOrderAfterClamp.ok) expect(invalidOrderAfterClamp.code).toBe('INVALID_ORDER');
  });

  it('rejects negative start or end times', () => {
    const negStart = validateTrimRange(-1, 10, duration);
    expect(negStart.ok).toBe(false);
    if (!negStart.ok) expect(negStart.code).toBe('NEGATIVE_TIME');

    const negEnd = validateTrimRange(0, -0.5, duration);
    expect(negEnd.ok).toBe(false);
    if (!negEnd.ok) expect(negEnd.code).toBe('NEGATIVE_TIME');
  });

  it('rejects NaN, Infinity, and -Infinity', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const r1 = validateTrimRange(bad, 10, duration);
      expect(r1.ok).toBe(false);
      if (!r1.ok) expect(r1.code).toBe('INVALID_NUMBER');

      const r2 = validateTrimRange(0, bad, duration);
      expect(r2.ok).toBe(false);
      if (!r2.ok) expect(r2.code).toBe('INVALID_NUMBER');
    }
  });

  it('rejects start >= end', () => {
    const equal = validateTrimRange(10, 10, duration);
    expect(equal.ok).toBe(false);
    if (!equal.ok) expect(equal.code).toBe('INVALID_ORDER');

    const reversed = validateTrimRange(15, 10, duration);
    expect(reversed.ok).toBe(false);
    if (!reversed.ok) expect(reversed.code).toBe('INVALID_ORDER');
  });

  it('rejects start or end beyond video duration + 0.01s tolerance', () => {
    const endBeyond = validateTrimRange(5, 30.02, duration);
    expect(endBeyond.ok).toBe(false);
    if (!endBeyond.ok) expect(endBeyond.code).toBe('OUT_OF_BOUNDS');

    const unroundedBeyond = validateTrimRange(0, 10.25, 10.236);
    expect(unroundedBeyond.ok).toBe(false);
    if (!unroundedBeyond.ok) expect(unroundedBeyond.code).toBe('OUT_OF_BOUNDS');

    const startBeyond = validateTrimRange(31, 35, duration);
    expect(startBeyond.ok).toBe(false);
    if (!startBeyond.ok) expect(startBeyond.code).toBe('OUT_OF_BOUNDS');
  });

  it('rejects clips shorter than 0.5 seconds', () => {
    const tooShort = validateTrimRange(5, 5.49, duration);
    expect(tooShort.ok).toBe(false);
    if (!tooShort.ok) expect(tooShort.code).toBe('CLIP_TOO_SHORT');
  });

  it('rejects invalid video duration', () => {
    expect(validateTrimRange(0, 5, 0).ok).toBe(false);
    expect(validateTrimRange(0, 5, Number.NaN).ok).toBe(false);
  });
});

describe('formatTimecode', () => {
  it('formats seconds as MM:SS.cc', () => {
    expect(formatTimecode(0)).toBe('00:00.00');
    expect(formatTimecode(65.5)).toBe('01:05.50');
    expect(formatTimecode(-3)).toBe('00:00.00');
  });
});
