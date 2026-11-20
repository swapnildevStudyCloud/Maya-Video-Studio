import { formatBytes, getFileExtension, hasFtypBox, readFileHeaderBytes } from './fileValidation';
import {
  MAX_AUDIO_FILE_SIZE_BYTES,
  MAX_IMAGE_FILE_SIZE_BYTES,
  type AddedAudioFormat,
  type ImageOverlayFormat,
  type ValidationResult,
} from './types';

const ALLOWED_AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'm4a']);
const ALLOWED_AUDIO_MIMES = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/wave',
  'audio/x-wav',
  'audio/mp4',
  'audio/x-m4a',
  'audio/aac',
]);

const ALLOWED_IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg']);
const ALLOWED_IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/jpg']);

export function detectAudioContainer(headerBytes: Uint8Array): AddedAudioFormat | null {
  if (headerBytes.length < 4) return null;

  // WAV: RIFF....WAVE
  if (
    headerBytes.length >= 12 &&
    headerBytes[0] === 0x52 &&
    headerBytes[1] === 0x49 &&
    headerBytes[2] === 0x46 &&
    headerBytes[3] === 0x46 &&
    headerBytes[8] === 0x57 &&
    headerBytes[9] === 0x41 &&
    headerBytes[10] === 0x56 &&
    headerBytes[11] === 0x45
  ) {
    return 'wav';
  }

  // M4A: ISO BMFF ftyp box
  if (hasFtypBox(headerBytes)) {
    return 'm4a';
  }

  // MP3: ID3v2 header ("ID3")
  if (headerBytes[0] === 0x49 && headerBytes[1] === 0x44 && headerBytes[2] === 0x33) {
    return 'mp3';
  }

  // MP3: Raw MPEG ADTS/frame sync (11 set bits: 0xFF 0xE0..0xFF, non-reserved version/layer)
  if (headerBytes[0] === 0xff && (headerBytes[1] & 0xe0) === 0xe0) {
    const versionBits = (headerBytes[1] & 0x18) >> 3;
    const layerBits = (headerBytes[1] & 0x06) >> 1;
    if (versionBits !== 1 && layerBits !== 0) {
      return 'mp3';
    }
  }

  return null;
}

export function validateAudioHeaderAndMeta(params: {
  name: string;
  size: number;
  type: string;
  headerBytes: Uint8Array;
}): ValidationResult<AddedAudioFormat> {
  const { name, size, type, headerBytes } = params;

  if (!Number.isFinite(size) || size <= 0) {
    return {
      ok: false,
      code: 'EMPTY_FILE',
      error: 'The selected audio file is empty.',
    };
  }

  if (size > MAX_AUDIO_FILE_SIZE_BYTES) {
    return {
      ok: false,
      code: 'FILE_TOO_LARGE',
      error: `Audio file is ${formatBytes(size)}, which exceeds the 20 MB limit.`,
    };
  }

  const ext = getFileExtension(name);
  const mime = type.trim().toLowerCase();
  if ((ext !== '' && !ALLOWED_AUDIO_EXTENSIONS.has(ext)) || (mime !== '' && !ALLOWED_AUDIO_MIMES.has(mime))) {
    return {
      ok: false,
      code: 'UNSUPPORTED_TYPE',
      error: 'Unsupported audio format. Please select an MP3, WAV, or M4A file.',
    };
  }

  const detected = detectAudioContainer(headerBytes);
  if (!detected) {
    return {
      ok: false,
      code: 'INVALID_CONTAINER',
      error: 'This file does not appear to be a valid MP3, WAV, or M4A audio file.',
    };
  }

  return { ok: true, value: detected };
}

export async function validateAudioFile(file: File): Promise<ValidationResult<AddedAudioFormat>> {
  try {
    const headerBytes = await readFileHeaderBytes(file, 64);
    return validateAudioHeaderAndMeta({
      name: file.name,
      size: file.size,
      type: file.type,
      headerBytes,
    });
  } catch {
    return {
      ok: false,
      code: 'METADATA_UNREADABLE',
      error: 'Could not read the selected audio file.',
    };
  }
}

export function detectImageFormat(headerBytes: Uint8Array): ImageOverlayFormat | null {
  if (headerBytes.length < 4) return null;

  // PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
  if (
    headerBytes.length >= 8 &&
    headerBytes[0] === 0x89 &&
    headerBytes[1] === 0x50 &&
    headerBytes[2] === 0x4e &&
    headerBytes[3] === 0x47 &&
    headerBytes[4] === 0x0d &&
    headerBytes[5] === 0x0a &&
    headerBytes[6] === 0x1a &&
    headerBytes[7] === 0x0a
  ) {
    return 'png';
  }

  // JPEG magic bytes: FF D8 FF
  if (headerBytes[0] === 0xff && headerBytes[1] === 0xd8 && headerBytes[2] === 0xff) {
    return 'jpg';
  }

  return null;
}

export function validateImageHeaderAndMeta(params: {
  name: string;
  size: number;
  type: string;
  headerBytes: Uint8Array;
}): ValidationResult<ImageOverlayFormat> {
  const { name, size, type, headerBytes } = params;

  if (!Number.isFinite(size) || size <= 0) {
    return {
      ok: false,
      code: 'EMPTY_FILE',
      error: 'The selected image file is empty.',
    };
  }

  if (size > MAX_IMAGE_FILE_SIZE_BYTES) {
    return {
      ok: false,
      code: 'FILE_TOO_LARGE',
      error: `Image file is ${formatBytes(size)}, which exceeds the 5 MB limit.`,
    };
  }

  const ext = getFileExtension(name);
  const mime = type.trim().toLowerCase();
  if ((ext !== '' && !ALLOWED_IMAGE_EXTENSIONS.has(ext)) || (mime !== '' && !ALLOWED_IMAGE_MIMES.has(mime))) {
    return {
      ok: false,
      code: 'UNSUPPORTED_TYPE',
      error: 'Unsupported image format. Please select a PNG or JPG image.',
    };
  }

  const detected = detectImageFormat(headerBytes);
  if (!detected) {
    return {
      ok: false,
      code: 'INVALID_CONTAINER',
      error: 'This file does not appear to be a valid PNG or JPG image.',
    };
  }

  return { ok: true, value: detected };
}

export async function validateImageFile(file: File): Promise<ValidationResult<ImageOverlayFormat>> {
  try {
    const headerBytes = await readFileHeaderBytes(file, 32);
    return validateImageHeaderAndMeta({
      name: file.name,
      size: file.size,
      type: file.type,
      headerBytes,
    });
  } catch {
    return {
      ok: false,
      code: 'METADATA_UNREADABLE',
      error: 'Could not read the selected image file.',
    };
  }
}

function buildFallbackWaveform(bars = 48): number[] {
  const out: number[] = [];
  for (let i = 0; i < bars; i++) {
    const v = 0.25 + 0.55 * Math.abs(Math.sin(i * 0.72) * Math.cos(i * 0.31));
    out.push(Number(v.toFixed(2)));
  }
  return out;
}

export async function probeAudioAssetMeta(
  file: File
): Promise<{ duration: number; waveform: number[] }> {
  const objectUrl = URL.createObjectURL(file);
  const audio = document.createElement('audio');
  audio.preload = 'metadata';

  const duration = await new Promise<number>((resolve, reject) => {
    const cleanup = () => {
      audio.onloadedmetadata = null;
      audio.onerror = null;
      audio.removeAttribute('src');
      audio.load();
    };
    audio.onloadedmetadata = () => {
      const d = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 10;
      cleanup();
      resolve(d);
    };
    audio.onerror = () => {
      cleanup();
      reject(new Error('Browser could not decode this audio file.'));
    };
    audio.src = objectUrl;
  }).finally(() => {
    URL.revokeObjectURL(objectUrl);
  });

  // Best-effort lightweight waveform bars using Web Audio API
  let waveform = buildFallbackWaveform(48);
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (AudioCtx) {
      const ctx = new AudioCtx();
      try {
        const buffer = await file.arrayBuffer();
        const decoded = await ctx.decodeAudioData(buffer);
        const channel = decoded.getChannelData(0);
        const barCount = 48;
        const step = Math.max(1, Math.floor(channel.length / barCount));
        const peaks: number[] = [];
        let maxPeak = 0.001;
        for (let i = 0; i < barCount; i++) {
          const start = i * step;
          const end = Math.min(channel.length, start + step);
          let peak = 0;
          for (let j = start; j < end; j += Math.max(1, Math.floor(step / 32))) {
            const abs = Math.abs(channel[j]);
            if (abs > peak) peak = abs;
          }
          if (peak > maxPeak) maxPeak = peak;
          peaks.push(peak);
        }
        waveform = peaks.map((p) => Number(Math.max(0.1, p / maxPeak).toFixed(2)));
      } finally {
        void ctx.close().catch(() => {});
      }
    }
  } catch {
    // Keep deterministic fallback bars
  }

  return { duration, waveform };
}

export async function probeImageDimensions(
  file: File
): Promise<{ width: number; height: number }> {
  const objectUrl = URL.createObjectURL(file);
  try {
    return await new Promise<{ width: number; height: number }>((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        resolve({ width: img.naturalWidth || 0, height: img.naturalHeight || 0 });
      };
      img.onerror = () => {
        reject(new Error('Could not decode this image file.'));
      };
      img.src = objectUrl;
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
