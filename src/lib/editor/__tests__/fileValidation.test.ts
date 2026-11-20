import { describe, expect, it } from 'vitest';
import {
  hasFtypBox,
  sanitizeExportFilename,
  validateDuration,
  validateFilePreMetadata,
} from '../fileValidation';
import { MAX_DURATION_SECONDS, MAX_FILE_SIZE_BYTES } from '../types';

function makeFtypHeader(brand = 'isom'): Uint8Array {
  const bytes = new Uint8Array(24);
  // Box size = 24 (big-endian)
  bytes[0] = 0x00;
  bytes[1] = 0x00;
  bytes[2] = 0x00;
  bytes[3] = 24;
  // "ftyp"
  bytes[4] = 0x66;
  bytes[5] = 0x74;
  bytes[6] = 0x79;
  bytes[7] = 0x70;
  // Major brand
  for (let i = 0; i < 4; i++) {
    bytes[8 + i] = brand.charCodeAt(i);
  }
  return bytes;
}

describe('hasFtypBox', () => {
  it('returns true for valid MP4 and MOV ftyp headers', () => {
    expect(hasFtypBox(makeFtypHeader('isom'))).toBe(true);
    expect(hasFtypBox(makeFtypHeader('qt  '))).toBe(true);
  });

  it('returns false for PNG, plain text, or truncated bytes', () => {
    const pngHeader = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    ]);
    expect(hasFtypBox(pngHeader)).toBe(false);

    const textBytes = new TextEncoder().encode('hello world not a video');
    expect(hasFtypBox(textBytes)).toBe(false);

    expect(hasFtypBox(new Uint8Array(8))).toBe(false);
  });

  it('returns false if ftyp box size is invalid (< 8 and not 1)', () => {
    const header = makeFtypHeader('isom');
    header[3] = 4;
    expect(hasFtypBox(header)).toBe(false);
  });
});

describe('validateFilePreMetadata', () => {
  const validMp4Header = makeFtypHeader('isom');
  const validMovHeader = makeFtypHeader('qt  ');

  it('accepts valid MP4 and MOV files', () => {
    expect(
      validateFilePreMetadata({
        name: 'clip.mp4',
        size: 1024 * 1024,
        type: 'video/mp4',
        headerBytes: validMp4Header,
      })
    ).toEqual({ ok: true, value: 'mp4' });

    // Some browsers omit MIME type for .mov
    expect(
      validateFilePreMetadata({
        name: 'camera.MOV',
        size: MAX_FILE_SIZE_BYTES,
        type: '',
        headerBytes: validMovHeader,
      })
    ).toEqual({ ok: true, value: 'mov' });
  });

  it('rejects unsupported file extensions and MIME types', () => {
    const mkv = validateFilePreMetadata({
      name: 'movie.mkv',
      size: 1024,
      type: 'video/x-matroska',
      headerBytes: validMp4Header,
    });
    expect(mkv.ok).toBe(false);
    if (!mkv.ok) expect(mkv.code).toBe('UNSUPPORTED_TYPE');

    const webm = validateFilePreMetadata({
      name: 'clip.webm',
      size: 1024,
      type: 'video/webm',
      headerBytes: validMp4Header,
    });
    expect(webm.ok).toBe(false);
    if (!webm.ok) expect(webm.code).toBe('UNSUPPORTED_TYPE');
  });

  it('rejects files larger than 200 MB', () => {
    const tooBig = validateFilePreMetadata({
      name: 'huge.mp4',
      size: MAX_FILE_SIZE_BYTES + 1,
      type: 'video/mp4',
      headerBytes: validMp4Header,
    });
    expect(tooBig.ok).toBe(false);
    if (!tooBig.ok) expect(tooBig.code).toBe('FILE_TOO_LARGE');
  });

  it('rejects empty files', () => {
    const empty = validateFilePreMetadata({
      name: 'empty.mp4',
      size: 0,
      type: 'video/mp4',
      headerBytes: new Uint8Array(0),
    });
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.code).toBe('EMPTY_FILE');
  });

  it('rejects a file with a fake .mp4 extension and non-ftyp bytes', () => {
    const fakeHeader = new TextEncoder().encode('<!DOCTYPE html><html></html>');
    const fake = validateFilePreMetadata({
      name: 'spoofed.mp4',
      size: 2048,
      type: 'video/mp4',
      headerBytes: fakeHeader,
    });
    expect(fake.ok).toBe(false);
    if (!fake.ok) expect(fake.code).toBe('INVALID_CONTAINER');
  });
});

describe('validateDuration', () => {
  it('accepts valid durations up to 10 minutes', () => {
    expect(validateDuration(30)).toEqual({ ok: true, value: 30 });
    expect(validateDuration(MAX_DURATION_SECONDS)).toEqual({
      ok: true,
      value: MAX_DURATION_SECONDS,
    });
  });

  it('rejects durations longer than 10 minutes', () => {
    const tooLong = validateDuration(MAX_DURATION_SECONDS + 0.5);
    expect(tooLong.ok).toBe(false);
    if (!tooLong.ok) expect(tooLong.code).toBe('DURATION_TOO_LONG');
  });

  it('rejects zero, negative, or non-finite durations', () => {
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const res = validateDuration(bad);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('METADATA_UNREADABLE');
    }
  });
});

describe('sanitizeExportFilename', () => {
  it('appends -trimmed.mp4 and strips .mp4 or .mov extension', () => {
    expect(sanitizeExportFilename('vacation.mp4')).toBe('vacation-trimmed.mp4');
    expect(sanitizeExportFilename('take_02.MOV')).toBe('take_02-trimmed.mp4');
  });

  it('strips path segments and unsafe filename characters', () => {
    expect(sanitizeExportFilename('../../my:video*file?.mp4')).toBe('my-video-file-trimmed.mp4');
    expect(sanitizeExportFilename('   .mp4')).toBe('video-trimmed.mp4');
  });
});
