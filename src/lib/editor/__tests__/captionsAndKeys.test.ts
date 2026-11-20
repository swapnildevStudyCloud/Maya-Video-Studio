import { describe, expect, it } from 'vitest';
import {
  GEMINI_API_KEY_STORAGE_KEY,
  getStoredGeminiApiKey,
  redactApiKey,
  removeStoredGeminiApiKey,
  setStoredGeminiApiKey,
} from '../apiKeyStorage';
import {
  captionsToSrt,
  estimateInlinePayloadBytes,
  formatSrtTimestamp,
  GEMINI_MODEL,
  sanitizeGeminiCaptionsJson,
  toFriendlyGeminiError,
} from '../captions';
import { MAX_CAPTION_SEGMENTS, MAX_CAPTION_TEXT_LENGTH, MAX_GEMINI_INLINE_BYTES } from '../types';

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };
}

describe('sanitizeGeminiCaptionsJson', () => {
  it('parses fenced JSON, clamps timestamps to duration, sorts, and sanitizes text', () => {
    const raw = [
      '```json',
      JSON.stringify([
        { start: 8, end: 15, text: 'Second   line\nwith\u0007control' },
        { start: -2, end: 3.5, text: '  First line  ' },
        { start: 5, end: 4, text: 'Invalid reversed segment' },
        { start: 12, end: 14, text: 'Beyond clip duration' },
        { start: 1, end: 2, text: '   ' },
      ]),
      '```',
    ].join('\n');

    const result = sanitizeGeminiCaptionsJson(raw, 10);
    expect(result).toEqual([
      { id: 'cap_0', start: 0, end: 3.5, text: 'First line' },
      { id: 'cap_1', start: 8, end: 10, text: 'Second line with control' },
    ]);
  });

  it('caps segment count and text length', () => {
    const oversized = Array.from({ length: MAX_CAPTION_SEGMENTS + 25 }, (_, i) => ({
      start: i * 0.5,
      end: i * 0.5 + 0.4,
      text: 'x'.repeat(MAX_CAPTION_TEXT_LENGTH + 40),
    }));

    const result = sanitizeGeminiCaptionsJson(JSON.stringify(oversized), 500);
    expect(result).toHaveLength(MAX_CAPTION_SEGMENTS);
    expect(result[0].text.length).toBe(MAX_CAPTION_TEXT_LENGTH);
  });

  it('throws on invalid or non-array JSON', () => {
    expect(() => sanitizeGeminiCaptionsJson('not json', 10)).toThrow();
    expect(() => sanitizeGeminiCaptionsJson('{"a": 1}', 10)).toThrow();
  });
});

describe('SRT formatting & payload size guard', () => {
  it('formats SRT timestamps and blocks accurately', () => {
    expect(formatSrtTimestamp(0)).toBe('00:00:00,000');
    expect(formatSrtTimestamp(62.345)).toBe('00:01:02,345');

    const srt = captionsToSrt([
      { id: 'c0', start: 0.5, end: 2.25, text: 'Hello world' },
      { id: 'c1', start: 3, end: 5.5, text: 'Testing SRT' },
    ]);

    expect(srt).toBe(
      '1\n00:00:00,500 --> 00:00:02,250\nHello world\n\n2\n00:00:03,000 --> 00:00:05,500\nTesting SRT\n'
    );
  });

  it('estimates inline payload size beyond 15 MB limit for large audio', () => {
    expect(estimateInlinePayloadBytes(12 * 1024 * 1024)).toBeGreaterThan(MAX_GEMINI_INLINE_BYTES);
    expect(estimateInlinePayloadBytes(2 * 1024 * 1024)).toBeLessThan(MAX_GEMINI_INLINE_BYTES);
  });
});

describe('API key storage & redaction', () => {
  it('saves, reads, and removes Gemini API key in localStorage', () => {
    const storage = createMemoryStorage();
    expect(getStoredGeminiApiKey(storage)).toBeNull();

    setStoredGeminiApiKey('  AIzaSyTestSecretKey12345  ', storage);
    expect(storage.getItem(GEMINI_API_KEY_STORAGE_KEY)).toBe('AIzaSyTestSecretKey12345');
    expect(getStoredGeminiApiKey(storage)).toBe('AIzaSyTestSecretKey12345');

    removeStoredGeminiApiKey(storage);
    expect(getStoredGeminiApiKey(storage)).toBeNull();
  });

  it('never leaks API keys in redacted messages or friendly Gemini errors', () => {
    const fakeKey = 'AIzaSyFakeKey9876543210';

    const redacted = redactApiKey(
      `Request to https://generativelanguage.googleapis.com?key=${fakeKey} failed with ${fakeKey}`,
      fakeKey
    );
    expect(redacted).not.toContain(fakeKey);
    expect(redacted).toContain('[REDACTED]');

    const authErr = toFriendlyGeminiError(
      new Error(`403 PERMISSION_DENIED for key ${fakeKey}`),
      fakeKey
    );
    expect(authErr.message).not.toContain(fakeKey);
    expect(authErr.message.toLowerCase()).toContain('invalid');

    const rateErr = toFriendlyGeminiError(
      new Error(`429 RESOURCE_EXHAUSTED using ${fakeKey}`),
      fakeKey
    );
    expect(rateErr.message).not.toContain(fakeKey);
    expect(rateErr.message).toContain('429');

    const netErr = toFriendlyGeminiError(
      new Error(`Failed to fetch with ${fakeKey}`),
      fakeKey
    );
    expect(netErr.message).not.toContain(fakeKey);
    expect(netErr.message.toLowerCase()).toContain('internet');

    const longDetailErr = toFriendlyGeminiError(
      new Error(
        `404 NOT_FOUND on https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${fakeKey} - model is unavailable in this region or account.`
      ),
      fakeKey
    );
    expect(GEMINI_MODEL).toBe('gemini-3.5-flash');
    expect(longDetailErr.message).not.toContain(fakeKey);
    expect(longDetailErr.message).toContain('[REDACTED]');
    expect(longDetailErr.message).toContain('404 NOT_FOUND');
    expect(longDetailErr.message).toContain('unavailable in this region or account.');
  });
});
