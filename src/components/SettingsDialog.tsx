import { ExternalLink, Eye, EyeOff, KeyRound, Trash2, X } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';

interface SettingsDialogProps {
  isOpen: boolean;
  hasStoredKey: boolean;
  storedKeyPreview: string | null;
  onClose: () => void;
  onSaveKey: (key: string) => void;
  onRemoveKey: () => void;
  onClearFfmpegCache: () => Promise<boolean>;
}

export function SettingsDialog({
  isOpen,
  hasStoredKey,
  storedKeyPreview,
  onClose,
  onSaveKey,
  onRemoveKey,
  onClearFfmpegCache,
}: SettingsDialogProps) {
  const [keyInput, setKeyInput] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [cacheMessage, setCacheMessage] = useState<string | null>(null);
  const [isClearingCache, setIsClearingCache] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setKeyInput(storedKeyPreview ?? '');
      setShowKey(false);
      setCacheMessage(null);
    }
  }, [isOpen, storedKeyPreview]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = keyInput.trim();
    if (!trimmed) return;
    onSaveKey(trimmed);
    onClose();
  };

  const handleRemove = () => {
    setKeyInput('');
    onRemoveKey();
  };

  const handleClearCache = async () => {
    if (isClearingCache) return;
    setIsClearingCache(true);
    setCacheMessage(null);
    try {
      const removed = await onClearFfmpegCache();
      setCacheMessage(
        removed ? 'Cached ffmpeg core cleared.' : 'No cached ffmpeg core found.'
      );
    } finally {
      setIsClearingCache(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-dialog-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-lg border border-[#232A38] bg-[#131720] p-6"
      >
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-slate-100">
            <KeyRound className="h-4 w-4 text-blue-400" aria-hidden="true" />
            <h2 id="settings-dialog-title" className="text-base font-semibold">
              Gemini API Key Settings
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-[#1C2230] hover:text-slate-100"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <p className="mt-3 text-xs leading-relaxed text-slate-400">
          AI captions run directly from your browser using your own Gemini API key. Your key is stored only in this browser&apos;s{' '}
          <code className="text-slate-300">localStorage</code> and is never sent anywhere except Google&apos;s Gemini API.
        </p>

        <div className="mt-3">
          <a
            href="https://aistudio.google.com/apikey"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-400 transition-colors hover:text-blue-300"
          >
            <span>Get a free API key at aistudio.google.com</span>
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-4">
          <div>
            <label htmlFor="gemini-api-key-input" className="mb-1.5 block text-xs font-medium text-slate-300">
              Gemini API Key
            </label>
            <div className="relative flex items-center">
              <input
                id="gemini-api-key-input"
                type={showKey ? 'text' : 'password'}
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                placeholder="Paste your Gemini API key..."
                autoComplete="off"
                spellCheck={false}
                className="min-h-[42px] w-full rounded-lg border border-[#232A38] bg-[#0B0D11] py-2 pr-10 pl-3 font-mono text-sm text-slate-100 placeholder:text-slate-600 focus:border-blue-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowKey((prev) => !prev)}
                aria-label={showKey ? 'Hide API key' : 'Show API key'}
                className="absolute right-2 inline-flex h-8 w-8 items-center justify-center rounded text-slate-400 hover:text-slate-200"
              >
                {showKey ? (
                  <EyeOff className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Eye className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            {hasStoredKey ? (
              <button
                type="button"
                onClick={handleRemove}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-2 text-xs font-medium text-red-200 transition-colors hover:bg-red-500/20 whitespace-nowrap shrink-0"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Remove key</span>
              </button>
            ) : (
              <span className="text-xs text-slate-500">No key saved</span>
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="min-h-[40px] rounded-lg border border-[#2C3547] bg-[#191F2C] px-4 py-2 text-xs font-medium text-slate-200 transition-colors hover:border-slate-500 whitespace-nowrap shrink-0"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={keyInput.trim().length === 0}
                className="min-h-[40px] rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500 whitespace-nowrap shrink-0"
              >
                Save key
              </button>
            </div>
          </div>
        </form>

        <div className="mt-5 border-t border-[#232A38] pt-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-slate-300">FFmpeg Core Cache</p>
              <p className="mt-0.5 text-[11px] text-slate-500">
                Core files (~32 MB) are cached locally in this browser.
              </p>
            </div>
            <button
              type="button"
              disabled={isClearingCache}
              onClick={() => void handleClearCache()}
              className="shrink-0 rounded-lg border border-[#2C3547] bg-[#191F2C] px-3 py-1.5 text-[11px] font-medium text-slate-200 transition-colors hover:border-slate-500 disabled:opacity-50 whitespace-nowrap"
            >
              {isClearingCache ? 'Clearing...' : 'Clear cached ffmpeg core'}
            </button>
          </div>
          {cacheMessage && (
            <p className="mt-2 text-[11px] text-slate-400">{cacheMessage}</p>
          )}
        </div>
      </div>
    </div>
  );
}
