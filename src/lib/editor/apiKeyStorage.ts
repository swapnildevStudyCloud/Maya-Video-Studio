export const GEMINI_API_KEY_STORAGE_KEY = 'maya_video_studio_gemini_api_key';

function getBrowserLocalStorage(): Storage | null {
  if (typeof globalThis === 'undefined') return null;
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function getStoredGeminiApiKey(storage: Storage | null = getBrowserLocalStorage()): string | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(GEMINI_API_KEY_STORAGE_KEY);
    if (!raw) return null;
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

export function setStoredGeminiApiKey(
  apiKey: string,
  storage: Storage | null = getBrowserLocalStorage()
): void {
  if (!storage) return;
  const trimmed = apiKey.trim();
  try {
    if (trimmed.length === 0) {
      storage.removeItem(GEMINI_API_KEY_STORAGE_KEY);
    } else {
      storage.setItem(GEMINI_API_KEY_STORAGE_KEY, trimmed);
    }
  } catch {
    // Ignore storage quota or security errors
  }
}

export function removeStoredGeminiApiKey(
  storage: Storage | null = getBrowserLocalStorage()
): void {
  if (!storage) return;
  try {
    storage.removeItem(GEMINI_API_KEY_STORAGE_KEY);
  } catch {
    // Ignore storage errors
  }
}

/**
 * Strips any API key substrings from messages/logs so keys are never leaked in UI errors or logs.
 */
export function redactApiKey(message: string, knownKey?: string | null): string {
  let sanitized = message;
  if (knownKey && knownKey.trim().length > 0) {
    const escaped = knownKey.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    sanitized = sanitized.replace(new RegExp(escaped, 'g'), '[REDACTED]');
  }
  // Redact standard Google API key patterns (AIza...) and query params (?key=...)
  sanitized = sanitized.replace(/AIza[0-9A-Za-z_-]{10,}/g, '[REDACTED]');
  sanitized = sanitized.replace(/([?&]key=)[^&\s"']+/gi, '$1[REDACTED]');
  return sanitized;
}
