import {
  MAX_DURATION_SECONDS,
  MAX_FILE_SIZE_BYTES,
  type ValidationResult,
  type VideoFileMetadata,
} from './types';

const ALLOWED_EXTENSIONS = new Set(['mp4', 'mov']);
const ALLOWED_MIME_TYPES = new Set([
  'video/mp4',
  'video/quicktime',
  'application/mp4',
]);

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

export function getFileExtension(filename: string): string {
  const dotIndex = filename.lastIndexOf('.');
  if (dotIndex < 0 || dotIndex === filename.length - 1) return '';
  return filename.slice(dotIndex + 1).toLowerCase();
}

/**
 * Verifies that the first bytes of a file contain an ISO Base Media / QuickTime
 * `ftyp` box at offset 4..7 with a valid 32-bit box size at offset 0..3.
 */
export function hasFtypBox(headerBytes: Uint8Array): boolean {
  if (headerBytes.length < 12) {
    return false;
  }

  const boxSize =
    ((headerBytes[0] << 24) |
      (headerBytes[1] << 16) |
      (headerBytes[2] << 8) |
      headerBytes[3]) >>>
    0;

  // Box size is either 1 (64-bit extended size) or >= 8 bytes (header + payload).
  if (boxSize !== 1 && boxSize < 8) {
    return false;
  }

  // Bytes 4..7 must equal ASCII "ftyp".
  return (
    headerBytes[4] === 0x66 &&
    headerBytes[5] === 0x74 &&
    headerBytes[6] === 0x79 &&
    headerBytes[7] === 0x70
  );
}

export function validateFilePreMetadata(params: {
  name: string;
  size: number;
  type: string;
  headerBytes: Uint8Array;
}): ValidationResult<'mp4' | 'mov'> {
  const { name, size, type, headerBytes } = params;

  if (!Number.isFinite(size) || size <= 0) {
    return {
      ok: false,
      code: 'EMPTY_FILE',
      error: 'This file is empty and cannot be opened.',
    };
  }

  const ext = getFileExtension(name);
  const normalizedMime = type.trim().toLowerCase();
  const hasAllowedExt = ALLOWED_EXTENSIONS.has(ext);
  const hasAllowedMime = normalizedMime !== '' && ALLOWED_MIME_TYPES.has(normalizedMime);

  // Reject if extension is explicitly unsupported, or if neither extension nor MIME is MP4/MOV.
  if ((ext !== '' && !hasAllowedExt) || (!hasAllowedExt && !hasAllowedMime)) {
    return {
      ok: false,
      code: 'UNSUPPORTED_TYPE',
      error: 'Unsupported file format. Please select an MP4 or MOV video.',
    };
  }

  if (normalizedMime !== '' && !hasAllowedMime) {
    return {
      ok: false,
      code: 'UNSUPPORTED_TYPE',
      error: 'Unsupported MIME type. Please select an MP4 or MOV video.',
    };
  }

  if (size > MAX_FILE_SIZE_BYTES) {
    return {
      ok: false,
      code: 'FILE_TOO_LARGE',
      error: `File is ${formatBytes(size)}, which exceeds the 200 MB limit.`,
    };
  }

  if (!hasFtypBox(headerBytes)) {
    return {
      ok: false,
      code: 'INVALID_CONTAINER',
      error:
        'This file does not appear to be a valid MP4 or MOV video (missing ftyp container header).',
    };
  }

  const resolvedExtension: 'mp4' | 'mov' =
    ext === 'mov' || normalizedMime === 'video/quicktime' ? 'mov' : 'mp4';

  return { ok: true, value: resolvedExtension };
}

export function validateDuration(duration: number): ValidationResult<number> {
  if (!Number.isFinite(duration) || duration <= 0) {
    return {
      ok: false,
      code: 'METADATA_UNREADABLE',
      error: 'Could not read a valid video duration from this file.',
    };
  }

  if (duration > MAX_DURATION_SECONDS) {
    const mins = Math.floor(duration / 60);
    const secs = Math.round(duration % 60);
    return {
      ok: false,
      code: 'DURATION_TOO_LONG',
      error: `Video is ${mins}m ${secs}s long, which exceeds the 10-minute maximum limit.`,
    };
  }

  return { ok: true, value: duration };
}

export async function readFileHeaderBytes(file: Blob, byteCount = 64): Promise<Uint8Array> {
  const slice = file.slice(0, byteCount);
  const buffer = await slice.arrayBuffer();
  return new Uint8Array(buffer);
}

export async function probeVideoMetadata(
  file: File
): Promise<{ duration: number; width: number; height: number }> {
  const objectUrl = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'metadata';
  video.muted = true;

  try {
    return await new Promise<{ duration: number; width: number; height: number }>(
      (resolve, reject) => {
        const cleanup = () => {
          video.onloadedmetadata = null;
          video.onerror = null;
          video.removeAttribute('src');
          video.load();
        };

        video.onloadedmetadata = () => {
          const result = {
            duration: video.duration,
            width: video.videoWidth || 0,
            height: video.videoHeight || 0,
          };
          cleanup();
          resolve(result);
        };

        video.onerror = () => {
          cleanup();
          reject(new Error('Browser could not decode this video file metadata.'));
        };

        video.src = objectUrl;
      }
    );
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function validateVideoFile(
  file: File
): Promise<ValidationResult<VideoFileMetadata>> {
  let headerBytes: Uint8Array;
  try {
    headerBytes = await readFileHeaderBytes(file, 64);
  } catch {
    return {
      ok: false,
      code: 'METADATA_UNREADABLE',
      error: 'Unable to read the selected file from your device.',
    };
  }

  const preCheck = validateFilePreMetadata({
    name: file.name,
    size: file.size,
    type: file.type,
    headerBytes,
  });

  if (!preCheck.ok) {
    return preCheck;
  }

  let probed: { duration: number; width: number; height: number };
  try {
    probed = await probeVideoMetadata(file);
  } catch {
    return {
      ok: false,
      code: 'METADATA_UNREADABLE',
      error:
        'This file could not be decoded by your browser. Ensure it is a standard MP4 or MOV video.',
    };
  }

  const durationCheck = validateDuration(probed.duration);
  if (!durationCheck.ok) {
    return durationCheck;
  }

  return {
    ok: true,
    value: {
      name: file.name,
      size: file.size,
      mimeType: file.type || (preCheck.value === 'mov' ? 'video/quicktime' : 'video/mp4'),
      duration: durationCheck.value,
      width: probed.width,
      height: probed.height,
      extension: preCheck.value,
    },
  };
}

export function sanitizeExportFilename(originalName: string): string {
  const baseWithExt = originalName.split(/[/\\]/).pop() ?? '';
  const withoutExt = baseWithExt.replace(/\.(mp4|mov)$/i, '');

  const cleaned = withoutExt
    .replace(/[^a-zA-Z0-9._ -]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/-+/g, '-')
    .trim()
    .replace(/^[.\s-]+|[.\s-]+$/g, '')
    .slice(0, 100);

  const safeBase = cleaned.length > 0 ? cleaned : 'video';
  return `${safeBase}-trimmed.mp4`;
}
