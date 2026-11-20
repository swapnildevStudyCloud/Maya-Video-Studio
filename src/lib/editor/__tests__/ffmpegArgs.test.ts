import { describe, expect, it } from 'vitest';
import { buildFfmpegArgs } from '../ffmpegArgs';
import { INTERNAL_INPUT_FILENAME, INTERNAL_OUTPUT_FILENAME } from '../types';

describe('buildFfmpegArgs', () => {
  it('builds expected stream-copy arguments for Fast mode with fixed internal names', () => {
    const args = buildFfmpegArgs({
      start: 2.5,
      end: 12.5,
      duration: 30,
      mode: 'fast',
    });

    expect(args).toEqual([
      '-ss',
      '2.500',
      '-i',
      INTERNAL_INPUT_FILENAME,
      '-t',
      '10.000',
      '-c',
      'copy',
      '-avoid_negative_ts',
      'make_zero',
      '-movflags',
      '+faststart',
      INTERNAL_OUTPUT_FILENAME,
    ]);
  });

  it('builds expected H.264 + AAC arguments for Precise mode with fixed internal names', () => {
    const args = buildFfmpegArgs({
      start: 5,
      end: 15.25,
      duration: 45,
      mode: 'precise',
    });

    expect(args).toEqual([
      '-ss',
      '5.000',
      '-i',
      INTERNAL_INPUT_FILENAME,
      '-t',
      '10.250',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-crf',
      '23',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-movflags',
      '+faststart',
      INTERNAL_OUTPUT_FILENAME,
    ]);
  });

  it('rejects invalid numbers, negative values, out-of-bounds, and short clips', () => {
    expect(() =>
      buildFfmpegArgs({ start: Number.NaN, end: 10, duration: 30, mode: 'fast' })
    ).toThrow();
    expect(() =>
      buildFfmpegArgs({ start: 0, end: Number.POSITIVE_INFINITY, duration: 30, mode: 'precise' })
    ).toThrow();
    expect(() =>
      buildFfmpegArgs({ start: -1, end: 5, duration: 30, mode: 'fast' })
    ).toThrow();
    expect(() =>
      buildFfmpegArgs({ start: 10, end: 10, duration: 30, mode: 'fast' })
    ).toThrow();
    expect(() =>
      buildFfmpegArgs({ start: 10, end: 10.4, duration: 30, mode: 'precise' })
    ).toThrow();
    expect(() =>
      buildFfmpegArgs({ start: 0, end: 35, duration: 30, mode: 'fast' })
    ).toThrow();
  });
});
