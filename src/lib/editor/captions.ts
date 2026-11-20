import { GoogleGenAI, Type } from '@google/genai';
import { redactApiKey } from './apiKeyStorage';
import {
  MAX_CAPTION_SEGMENTS,
  MAX_CAPTION_TEXT_LENGTH,
  MAX_GEMINI_INLINE_BYTES,
  type CaptionSegment,
} from './types';

/**
 * Single model constant for Gemini audio transcription + JSON caption output.
 */
export const GEMINI_MODEL = 'gemini-3.5-flash';

export const CAPTION_LANGUAGES = [
  { code: 'auto', label: 'Auto-detect' },
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'it', label: 'Italian' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' },
  { code: 'zh', label: 'Chinese' },
  { code: 'hi', label: 'Hindi' },
  { code: 'ar', label: 'Arabic' },
] as const;

export type CaptionLanguageCode = (typeof CAPTION_LANGUAGES)[number]['code'];

function extractJsonArrayText(raw: string): string {
  let cleaned = raw.trim();
  // Strip markdown code fences if present
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  if (cleaned.startsWith('[')) {
    return cleaned;
  }

  const startIdx = cleaned.indexOf('[');
  const endIdx = cleaned.lastIndexOf(']');
  if (startIdx >= 0 && endIdx > startIdx) {
    return cleaned.slice(startIdx, endIdx + 1);
  }
  return cleaned;
}

export function sanitizeCaptionText(raw: string): string {
  return raw
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_CAPTION_TEXT_LENGTH);
}

/**
 * Wraps caption text cleanly across lines (max ~42 chars per line) for drawtext textfile rendering.
 */
export function wrapCaptionTextForBurnIn(text: string, maxCharsPerLine = 42): string {
  const cleaned = sanitizeCaptionText(text);
  if (cleaned.length <= maxCharsPerLine) return cleaned;

  const words = cleaned.split(' ');
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    if (current.length === 0) {
      current = word;
    } else if (current.length + 1 + word.length <= maxCharsPerLine) {
      current = `${current} ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current.length > 0) {
    lines.push(current);
  }
  return lines.slice(0, 3).join('\n');
}

/**
 * Treats Gemini JSON output as untrusted:
 * parses safely, clamps timestamps to [0, maxDuration], discards invalid entries,
 * sanitizes & truncates text, sorts chronologically, and caps segment count.
 */
export function sanitizeGeminiCaptionsJson(
  rawText: string,
  maxDuration: number
): CaptionSegment[] {
  if (!Number.isFinite(maxDuration) || maxDuration <= 0) {
    throw new Error('Invalid clip duration for caption sanitization.');
  }

  const candidateJson = extractJsonArrayText(rawText);
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidateJson);
  } catch {
    throw new Error('Gemini returned an unexpected format instead of valid caption JSON.');
  }

  if (!Array.isArray(parsed)) {
    throw new Error('Gemini response was not a JSON array of caption segments.');
  }

  const cleanedSegments: Array<{ start: number; end: number; text: string }> = [];

  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;

    const rawStart =
      typeof record.start === 'number'
        ? record.start
        : typeof record.start === 'string'
          ? Number(record.start)
          : Number.NaN;
    const rawEnd =
      typeof record.end === 'number'
        ? record.end
        : typeof record.end === 'string'
          ? Number(record.end)
          : Number.NaN;
    const rawCaption = typeof record.text === 'string' ? record.text : '';

    if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd)) {
      continue;
    }

    const start = Math.max(0, Math.min(maxDuration, rawStart));
    const end = Math.max(0, Math.min(maxDuration, rawEnd));
    if (end <= start) {
      continue;
    }

    const text = sanitizeCaptionText(rawCaption);
    if (text.length === 0) {
      continue;
    }

    cleanedSegments.push({ start, end, text });
  }

  cleanedSegments.sort((a, b) => (a.start !== b.start ? a.start - b.start : a.end - b.end));

  return cleanedSegments.slice(0, MAX_CAPTION_SEGMENTS).map((seg, index) => ({
    id: `cap_${index}`,
    start: seg.start,
    end: seg.end,
    text: seg.text,
  }));
}

export function formatSrtTimestamp(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds >= 0 ? seconds : 0;
  const totalMs = Math.round(safe * 1000);
  const hours = Math.floor(totalMs / 3_600_000);
  const mins = Math.floor((totalMs % 3_600_000) / 60_000);
  const secs = Math.floor((totalMs % 60_000) / 1000);
  const ms = totalMs % 1000;

  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

export function captionsToSrt(captions: CaptionSegment[]): string {
  return captions
    .filter((seg) => seg.text.trim().length > 0 && seg.end > seg.start)
    .map((seg, index) => {
      const startTs = formatSrtTimestamp(seg.start);
      const endTs = formatSrtTimestamp(seg.end);
      return `${index + 1}\n${startTs} --> ${endTs}\n${sanitizeCaptionText(seg.text)}`;
    })
    .join('\n\n')
    .concat(captions.length > 0 ? '\n' : '');
}

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

export function toFriendlyGeminiError(err: unknown, apiKey?: string | null): Error {
  if (err instanceof DOMException && err.name === 'AbortError') {
    return err;
  }

  const rawMessage = err instanceof Error ? err.message : String(err);
  const redacted = redactApiKey(rawMessage, apiKey);
  const lower = redacted.toLowerCase();

  if (
    lower.includes('401') ||
    lower.includes('403') ||
    lower.includes('api_key_invalid') ||
    lower.includes('api key not valid') ||
    lower.includes('permission_denied') ||
    lower.includes('invalid api key')
  ) {
    return new Error(
      'Your Gemini API key appears invalid or lacks permission. Please verify it in Settings.'
    );
  }

  if (lower.includes('429') || lower.includes('resource_exhausted') || lower.includes('rate limit')) {
    return new Error(
      'Gemini API rate limit reached (429). Please wait a moment and try again, or check your quota in Google AI Studio.'
    );
  }

  if (
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('network request failed') ||
    lower.includes('load failed')
  ) {
    return new Error(
      "Could not reach Google's Gemini API. Please check your internet connection and try again."
    );
  }

  if (lower.includes('unexpected format') || lower.includes('json')) {
    return new Error(
      'Gemini returned a response that could not be parsed as caption timestamps. Please try again.'
    );
  }

  return new Error(`Caption generation failed: ${redacted}`);
}

export function estimateInlinePayloadBytes(audioByteLength: number): number {
  return Math.ceil((audioByteLength * 4) / 3) + 2048;
}

export async function generateCaptionsWithGemini(params: {
  apiKey: string;
  audioBytes: Uint8Array;
  mimeType: string;
  clipDuration: number;
  language: CaptionLanguageCode;
  signal?: AbortSignal;
}): Promise<CaptionSegment[]> {
  const { apiKey, audioBytes, mimeType, clipDuration, language, signal } = params;
  const trimmedKey = apiKey.trim();

  if (!trimmedKey) {
    throw new Error('Please add your Gemini API key in Settings before generating captions.');
  }

  if (signal?.aborted) {
    throw new DOMException('Caption generation cancelled.', 'AbortError');
  }

  const estimatedBytes = estimateInlinePayloadBytes(audioBytes.byteLength);
  if (estimatedBytes > MAX_GEMINI_INLINE_BYTES) {
    throw new Error(
      'The extracted audio exceeds the 15 MB inline request limit. Please trim your video to a shorter clip and try again.'
    );
  }

  const base64Audio = uint8ArrayToBase64(audioBytes);
  const languageInstruction =
    language === 'auto'
      ? 'Detect the spoken language automatically and transcribe in that language.'
      : `Transcribe in language code "${language}".`;

  const prompt = [
    `Transcribe all spoken words in this ${clipDuration.toFixed(2)}-second audio clip into short caption segments.`,
    languageInstruction,
    'Return ONLY a JSON array of objects with fields: start (number in seconds), end (number in seconds), text (string).',
    `Keep all timestamps between 0 and ${clipDuration.toFixed(2)} seconds and ensure start < end.`,
    'Keep each caption concise (under 15 words). If there is no speech, return [].',
  ].join(' ');

  try {
    const ai = new GoogleGenAI({ apiKey: trimmedKey });
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: {
        parts: [
          {
            inlineData: {
              mimeType,
              data: base64Audio,
            },
          },
          { text: prompt },
        ],
      },
      config: {
        abortSignal: signal,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              start: {
                type: Type.NUMBER,
                description: 'Segment start time in seconds from 0.',
              },
              end: {
                type: Type.NUMBER,
                description: 'Segment end time in seconds.',
              },
              text: {
                type: Type.STRING,
                description: 'Spoken caption text for this segment.',
              },
            },
            required: ['start', 'end', 'text'],
          },
        },
      },
    });

    if (signal?.aborted) {
      throw new DOMException('Caption generation cancelled.', 'AbortError');
    }

    const rawOutput = response.text ?? '[]';
    return sanitizeGeminiCaptionsJson(rawOutput, clipDuration);
  } catch (err) {
    throw toFriendlyGeminiError(err, trimmedKey);
  }
}
