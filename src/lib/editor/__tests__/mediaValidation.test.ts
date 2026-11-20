import { describe, expect, it } from 'vitest';
import {
  detectAudioContainer,
  detectImageFormat,
  validateAudioHeaderAndMeta,
  validateImageHeaderAndMeta,
} from '../mediaValidation';
import { MAX_AUDIO_FILE_SIZE_BYTES, MAX_IMAGE_FILE_SIZE_BYTES } from '../types';

function makeWaveHeader(): Uint8Array {
  return new Uint8Array([
    0x52, 0x49, 0x46, 0x46, // RIFF
    0x24, 0x00, 0x00, 0x00,
    0x57, 0x41, 0x56, 0x45, // WAVE
  ]);
}

function makeM4aHeader(): Uint8Array {
  return new Uint8Array([
    0x00, 0x00, 0x00, 0x18,
    0x66, 0x74, 0x79, 0x70, // ftyp
    0x4d, 0x34, 0x41, 0x20, // M4A
  ]);
}

function makeMp3Id3Header(): Uint8Array {
  return new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00, 0x00]); // ID3v2
}

function makeMp3FrameSyncHeader(): Uint8Array {
  return new Uint8Array([0xff, 0xfb, 0x90, 0x00]);
}

function makePngHeader(): Uint8Array {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
}

function makeJpgHeader(): Uint8Array {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
}

describe('mediaValidation (audio and image headers)', () => {
  it('detects valid MP3, WAV, and M4A container headers', () => {
    expect(detectAudioContainer(makeMp3Id3Header())).toBe('mp3');
    expect(detectAudioContainer(makeMp3FrameSyncHeader())).toBe('mp3');
    expect(detectAudioContainer(makeWaveHeader())).toBe('wav');
    expect(detectAudioContainer(makeM4aHeader())).toBe('m4a');

    // Spoofed HTML bytes
    const htmlBytes = new TextEncoder().encode('<html>not audio</html>');
    expect(detectAudioContainer(htmlBytes)).toBeNull();
  });

  it('validates audio size limit (20 MB), type, and real header', () => {
    expect(
      validateAudioHeaderAndMeta({
        name: 'track.mp3',
        size: 1024 * 1024,
        type: 'audio/mpeg',
        headerBytes: makeMp3Id3Header(),
      })
    ).toEqual({ ok: true, value: 'mp3' });

    expect(
      validateAudioHeaderAndMeta({
        name: 'sfx.wav',
        size: 500_000,
        type: 'audio/wav',
        headerBytes: makeWaveHeader(),
      })
    ).toEqual({ ok: true, value: 'wav' });

    expect(
      validateAudioHeaderAndMeta({
        name: 'voice.m4a',
        size: 500_000,
        type: 'audio/mp4',
        headerBytes: makeM4aHeader(),
      })
    ).toEqual({ ok: true, value: 'm4a' });

    // Empty file
    expect(
      validateAudioHeaderAndMeta({
        name: 'empty.mp3',
        size: 0,
        type: 'audio/mpeg',
        headerBytes: makeMp3Id3Header(),
      }).ok
    ).toBe(false);

    // Too large (> 20 MB)
    expect(
      validateAudioHeaderAndMeta({
        name: 'huge.mp3',
        size: MAX_AUDIO_FILE_SIZE_BYTES + 1,
        type: 'audio/mpeg',
        headerBytes: makeMp3Id3Header(),
      }).ok
    ).toBe(false);

    // Disallowed extension
    expect(
      validateAudioHeaderAndMeta({
        name: 'sound.ogg',
        size: 1024,
        type: 'audio/ogg',
        headerBytes: makeMp3Id3Header(),
      }).ok
    ).toBe(false);

    // Spoofed .mp3 containing PNG bytes
    expect(
      validateAudioHeaderAndMeta({
        name: 'fake.mp3',
        size: 1024,
        type: 'audio/mpeg',
        headerBytes: makePngHeader(),
      }).ok
    ).toBe(false);
  });

  it('detects valid PNG and JPG magic bytes and rejects oversized/spoofed images', () => {
    expect(detectImageFormat(makePngHeader())).toBe('png');
    expect(detectImageFormat(makeJpgHeader())).toBe('jpg');
    expect(detectImageFormat(makeWaveHeader())).toBeNull();

    expect(
      validateImageHeaderAndMeta({
        name: 'logo.png',
        size: 100_000,
        type: 'image/png',
        headerBytes: makePngHeader(),
      })
    ).toEqual({ ok: true, value: 'png' });

    expect(
      validateImageHeaderAndMeta({
        name: 'watermark.jpg',
        size: 100_000,
        type: 'image/jpeg',
        headerBytes: makeJpgHeader(),
      })
    ).toEqual({ ok: true, value: 'jpg' });

    // Too large (> 5 MB)
    expect(
      validateImageHeaderAndMeta({
        name: 'banner.png',
        size: MAX_IMAGE_FILE_SIZE_BYTES + 1,
        type: 'image/png',
        headerBytes: makePngHeader(),
      }).ok
    ).toBe(false);

    // Disallowed extension
    expect(
      validateImageHeaderAndMeta({
        name: 'anim.gif',
        size: 1024,
        type: 'image/gif',
        headerBytes: makePngHeader(),
      }).ok
    ).toBe(false);

    // Spoofed .png containing HTML bytes
    expect(
      validateImageHeaderAndMeta({
        name: 'evil.png',
        size: 1024,
        type: 'image/png',
        headerBytes: new TextEncoder().encode('<!DOCTYPE html>'),
      }).ok
    ).toBe(false);
  });
});
