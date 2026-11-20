import { validateTrimRange } from './trimValidation';
import {
  INTERNAL_INPUT_FILENAME,
  INTERNAL_OUTPUT_FILENAME,
  type ExportMode,
} from './types';

function formatSecondsArg(value: number): string {
  return value.toFixed(3);
}

/**
 * Builds deterministic ffmpeg CLI arguments using fixed internal filenames
 * and validated numeric start/duration values.
 */
export function buildFfmpegArgs(params: {
  start: number;
  end: number;
  duration: number;
  mode: ExportMode;
}): string[] {
  const validation = validateTrimRange(params.start, params.end, params.duration);
  if (!validation.ok) {
    throw new Error(validation.error);
  }

  const { start, end } = validation.value;
  const clipDuration = end - start;
  const startStr = formatSecondsArg(start);
  const durationStr = formatSecondsArg(clipDuration);

  if (params.mode === 'fast') {
    return [
      '-ss',
      startStr,
      '-i',
      INTERNAL_INPUT_FILENAME,
      '-t',
      durationStr,
      '-c',
      'copy',
      '-avoid_negative_ts',
      'make_zero',
      '-movflags',
      '+faststart',
      INTERNAL_OUTPUT_FILENAME,
    ];
  }

  return [
    '-ss',
    startStr,
    '-i',
    INTERNAL_INPUT_FILENAME,
    '-t',
    durationStr,
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
  ];
}
