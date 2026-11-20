import {
  AlertCircle,
  Captions,
  Download,
  Film,
  FolderOpen,
  Image as ImageIcon,
  KeyRound,
  Music,
  Plus,
  Trash2,
  Type,
  Upload,
  X,
} from 'lucide-react';
import { useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import {
  CAPTION_LANGUAGES,
  formatBytes,
  formatTimecode,
  MAX_TOTAL_VIDEO_SIZE_BYTES,
  MAX_VIDEO_TRACK_CLIPS,
  redactApiKey,
  type CaptionLanguageCode,
  type MediaAsset,
  type TextClipAlign,
  type TextOverlayColor,
  type TextOverlaySize,
} from '../lib/editor';

export type LeftPanelTab = 'media' | 'text' | 'audio' | 'ai';

export interface TextPresetOption {
  id: string;
  label: string;
  text: string;
  size: TextOverlaySize;
  color: TextOverlayColor;
  backgroundBox: boolean;
  align: TextClipAlign;
  xPercent: number;
  yPercent: number;
}

const TEXT_PRESETS: TextPresetOption[] = [
  {
    id: 'plain',
    label: 'Default text',
    text: 'Sample text',
    size: 'medium',
    color: 'white',
    backgroundBox: false,
    align: 'center',
    xPercent: 50,
    yPercent: 50,
  },
  {
    id: 'title',
    label: 'Big title',
    text: 'Title Text',
    size: 'large',
    color: 'white',
    backgroundBox: false,
    align: 'center',
    xPercent: 50,
    yPercent: 45,
  },
  {
    id: 'lower',
    label: 'Lower third',
    text: 'Speaker Name',
    size: 'small',
    color: 'white',
    backgroundBox: true,
    align: 'left',
    xPercent: 10,
    yPercent: 84,
  },
  {
    id: 'highlight',
    label: 'Yellow highlight',
    text: 'Key point',
    size: 'medium',
    color: 'yellow',
    backgroundBox: true,
    align: 'center',
    xPercent: 50,
    yPercent: 82,
  },
];

interface LeftMediaPanelProps {
  activeTab: LeftPanelTab;
  onTabChange: (tab: LeftPanelTab) => void;
  assets: MediaAsset[];
  totalVideoBytes: number;
  videoClipCount: number;
  isLoadingMedia: boolean;
  mediaError: string | null;
  onDismissMediaError: () => void;
  onImportVideos: (files: File[]) => void;
  onImportAudios: (files: File[]) => void;
  onImportImages: (files: File[]) => void;
  onImportFiles: (files: File[]) => void;
  onAddAssetToTimeline: (asset: MediaAsset) => void;
  onRemoveAsset: (assetId: string) => void;
  onAddTextClip: (preset?: TextPresetOption) => void;
  hasVideo: boolean;
  hasApiKey: boolean;
  captionLanguage: CaptionLanguageCode;
  onCaptionLanguageChange: (lang: CaptionLanguageCode) => void;
  isGeneratingCaptions: boolean;
  captionStatus: string | null;
  captionError: string | null;
  hasCaptions: boolean;
  onGenerateCaptions: () => void;
  onCancelCaptions: () => void;
  onDownloadSrt: () => void;
  onOpenSettings: () => void;
  isBusy: boolean;
}

export function LeftMediaPanel({
  activeTab,
  onTabChange,
  assets,
  totalVideoBytes,
  videoClipCount,
  isLoadingMedia,
  mediaError,
  onDismissMediaError,
  onImportVideos,
  onImportAudios,
  onImportImages,
  onImportFiles,
  onAddAssetToTimeline,
  onRemoveAsset,
  onAddTextClip,
  hasVideo,
  hasApiKey,
  captionLanguage,
  onCaptionLanguageChange,
  isGeneratingCaptions,
  captionStatus,
  captionError,
  hasCaptions,
  onGenerateCaptions,
  onCancelCaptions,
  onDownloadSrt,
  onOpenSettings,
  isBusy,
}: LeftMediaPanelProps) {
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const audioInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const audioAssets = assets.filter((a) => a.kind === 'audio');

  const handleVideoChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = '';
    if (files.length > 0) onImportVideos(files);
  };

  const handleAudioChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = '';
    if (files.length > 0) onImportAudios(files);
  };

  const handleImageChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = '';
    if (files.length > 0) onImportImages(files);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (isBusy || isLoadingMedia) return;
    const files = e.dataTransfer.files ? Array.from(e.dataTransfer.files) : [];
    if (files.length > 0) {
      onImportFiles(files);
    }
  };

  return (
    <aside className="flex w-[280px] shrink-0 flex-col border-r border-[#232A38] bg-[#131720]">
      <input
        ref={videoInputRef}
        type="file"
        multiple
        accept=".mp4,.mov,video/mp4,video/quicktime"
        onChange={handleVideoChange}
        className="sr-only"
      />
      <input
        ref={audioInputRef}
        type="file"
        multiple
        accept=".mp3,.wav,.m4a,audio/mpeg,audio/wav,audio/mp4"
        onChange={handleAudioChange}
        className="sr-only"
      />
      <input
        ref={imageInputRef}
        type="file"
        multiple
        accept=".png,.jpg,.jpeg,image/png,image/jpeg"
        onChange={handleImageChange}
        className="sr-only"
      />

      {/* Tab selector */}
      <div
        role="tablist"
        aria-label="Asset categories"
        className="grid grid-cols-4 border-b border-[#232A38] bg-[#11141B] p-1"
      >
        {(
          [
            { id: 'media', label: 'Media', icon: FolderOpen },
            { id: 'text', label: 'Text', icon: Type },
            { id: 'audio', label: 'Audio', icon: Music },
            { id: 'ai', label: 'AI', icon: Captions },
          ] as const
        ).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={activeTab === id}
            onClick={() => onTabChange(id)}
            className={`flex h-9 flex-col items-center justify-center gap-0.5 rounded-lg text-[11px] font-medium whitespace-nowrap transition-colors ${
              activeTab === id
                ? 'bg-[#1D2433] text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{label}</span>
          </button>
        ))}
      </div>

      {/* Tab Body */}
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-3">
        {mediaError && (
          <div
            role="alert"
            className="flex items-start justify-between gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-2.5 text-xs text-red-200"
          >
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" aria-hidden="true" />
              <span>{mediaError}</span>
            </div>
            <button
              type="button"
              onClick={onDismissMediaError}
              aria-label="Dismiss error"
              className="text-red-300 hover:text-white"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        )}

        {activeTab === 'media' && (
          <>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              className={`flex flex-col gap-2 rounded-lg border border-dashed p-3 text-center transition-colors ${
                isDragging
                  ? 'border-blue-500 bg-blue-500/10'
                  : 'border-[#2C3547] bg-[#0B0D11]'
              }`}
            >
              <p className="text-[11px] text-slate-400">
                {isLoadingMedia
                  ? 'Validating media...'
                  : 'Drop one or more MP4/MOV, audio, or PNG/JPG files'}
              </p>
              <div className="grid grid-cols-3 gap-1.5">
                <button
                  type="button"
                  disabled={isBusy || isLoadingMedia}
                  onClick={() => videoInputRef.current?.click()}
                  title="Import one or more MP4/MOV clips (max 200 MB each, 400 MB total)"
                  className="flex h-8 items-center justify-center gap-1 rounded-lg border border-[#232A38] bg-[#131720] px-2 text-[11px] font-medium text-slate-200 hover:border-blue-500 disabled:opacity-50"
                >
                  <Upload className="h-3 w-3 text-blue-400" aria-hidden="true" />
                  <span>Video</span>
                </button>
                <button
                  type="button"
                  disabled={isBusy || isLoadingMedia}
                  onClick={() => audioInputRef.current?.click()}
                  title="Import MP3, WAV, or M4A (max 20 MB)"
                  className="flex h-8 items-center justify-center gap-1 rounded-lg border border-[#232A38] bg-[#131720] px-2 text-[11px] font-medium text-slate-200 hover:border-blue-500 disabled:opacity-50"
                >
                  <Music className="h-3 w-3 text-blue-400" aria-hidden="true" />
                  <span>Audio</span>
                </button>
                <button
                  type="button"
                  disabled={isBusy || isLoadingMedia}
                  onClick={() => imageInputRef.current?.click()}
                  title="Import PNG or JPG (max 5 MB)"
                  className="flex h-8 items-center justify-center gap-1 rounded-lg border border-[#232A38] bg-[#131720] px-2 text-[11px] font-medium text-slate-200 hover:border-blue-500 disabled:opacity-50"
                >
                  <ImageIcon className="h-3 w-3 text-blue-400" aria-hidden="true" />
                  <span>Image</span>
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span>Media Library ({assets.length})</span>
              <span className="font-mono text-[10px] tabular-nums">
                {formatBytes(totalVideoBytes)} / {formatBytes(MAX_TOTAL_VIDEO_SIZE_BYTES)} · {videoClipCount}/{MAX_VIDEO_TRACK_CLIPS} clips
              </span>
            </div>

            {assets.length === 0 ? (
              <p className="py-6 text-center text-xs text-slate-500">
                No media imported yet.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {assets.map((asset) => (
                  <div
                    key={asset.id}
                    draggable={!isBusy}
                    onDragStart={(e) => {
                      e.dataTransfer.setData('application/x-maya-asset-id', asset.id);
                      e.dataTransfer.effectAllowed = 'copy';
                    }}
                    title="Drag onto the timeline or click Add to timeline"
                    className="group flex flex-col gap-2 rounded-lg border border-[#232A38] bg-[#0B0D11] p-2 transition-colors hover:border-[#3A455C]"
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-10 w-14 shrink-0 items-center justify-center overflow-hidden rounded border border-[#232A38] bg-[#131720] text-slate-300">
                        {asset.kind === 'video' ? (
                          asset.thumbnailUrl ? (
                            <img
                              src={asset.thumbnailUrl}
                              alt={asset.name}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <Film className="h-4 w-4 text-blue-400" aria-hidden="true" />
                          )
                        ) : asset.kind === 'image' ? (
                          <img
                            src={asset.objectUrl}
                            alt={asset.name}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <Music className="h-4 w-4 text-blue-400" aria-hidden="true" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-slate-200" title={asset.name}>
                          {asset.name}
                        </p>
                        <p className="mt-0.5 font-mono text-[10px] text-slate-400 tabular-nums">
                          {asset.kind === 'image'
                            ? `${asset.width}×${asset.height} · ${formatBytes(asset.size)}`
                            : asset.kind === 'video'
                              ? `${formatTimecode(asset.duration)} · ${asset.width}×${asset.height}`
                              : `${formatTimecode(asset.duration)} · ${formatBytes(asset.size)}`}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-1.5">
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => onAddAssetToTimeline(asset)}
                        className="inline-flex h-7 flex-1 items-center justify-center gap-1 rounded border border-[#2C3547] bg-[#131720] px-2 text-[11px] font-medium text-slate-200 transition-colors hover:border-blue-500 hover:text-white disabled:opacity-50"
                      >
                        <Plus className="h-3 w-3 text-blue-400" aria-hidden="true" />
                        <span>Add to timeline</span>
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => onRemoveAsset(asset.id)}
                        aria-label={`Remove ${asset.name}`}
                        title="Remove from library and timeline"
                        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border border-[#232A38] bg-[#131720] text-slate-400 transition-colors hover:border-red-500/50 hover:text-red-300 disabled:opacity-50"
                      >
                        <Trash2 className="h-3 w-3" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <p className="mt-auto pt-2 text-[11px] leading-relaxed text-slate-500">
              Your videos stay on your device. Limits: 200 MB / 10m per video, 400 MB total videos, max 20 Video track clips.
            </p>
          </>
        )}

        {activeTab === 'text' && (
          <>
            <button
              type="button"
              disabled={isBusy}
              onClick={() => onAddTextClip(TEXT_PRESETS[0])}
              className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Add text</span>
            </button>

            <span className="mt-1 text-[11px] font-medium text-slate-400">
              Click a style to add 3s clip at playhead
            </span>

            <div className="flex flex-col gap-2">
              {TEXT_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  disabled={isBusy}
                  onClick={() => onAddTextClip(preset)}
                  className="flex items-center justify-between rounded-lg border border-[#232A38] bg-[#0B0D11] px-3 py-2.5 text-left transition-colors hover:border-blue-500 disabled:opacity-50"
                >
                  <div>
                    <p className="text-xs font-medium text-slate-200">{preset.label}</p>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      {preset.size} · {preset.color}
                      {preset.backgroundBox ? ' · box' : ''}
                    </p>
                  </div>
                  <Plus className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                </button>
              ))}
            </div>
          </>
        )}

        {activeTab === 'audio' && (
          <>
            <button
              type="button"
              disabled={isBusy || isLoadingMedia}
              onClick={() => audioInputRef.current?.click()}
              className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-[#2C3547] bg-[#0B0D11] px-3 text-xs font-medium text-slate-200 transition-colors hover:border-blue-500 disabled:opacity-50"
            >
              <Upload className="h-3.5 w-3.5 text-blue-400" aria-hidden="true" />
              <span>Import audio (MP3, WAV, M4A)</span>
            </button>

            <p className="text-[11px] leading-relaxed text-slate-500">
              Only use music and audio files that you have the rights to use.
            </p>

            {audioAssets.length === 0 ? (
              <p className="py-6 text-center text-xs text-slate-500">
                No audio imported yet. Max 20 MB per file.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {audioAssets.map((asset) => (
                  <div
                    key={asset.id}
                    className="flex items-center gap-2 rounded-lg border border-[#232A38] bg-[#0B0D11] p-2"
                  >
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => onAddAssetToTimeline(asset)}
                      title="Click to add to Audio track at playhead"
                      className="group flex min-w-0 flex-1 items-center gap-2.5 text-left disabled:opacity-50"
                    >
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#232A38] bg-[#131720] text-blue-400">
                        <Music className="h-3.5 w-3.5" aria-hidden="true" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-slate-200" title={asset.name}>
                          {asset.name}
                        </p>
                        <p className="mt-0.5 font-mono text-[11px] text-slate-400 tabular-nums">
                          {formatTimecode(asset.duration)} · {formatBytes(asset.size)}
                        </p>
                      </div>
                      <Plus
                        className="h-4 w-4 shrink-0 text-slate-500 group-hover:text-blue-400"
                        aria-hidden="true"
                      />
                    </button>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => onRemoveAsset(asset.id)}
                      aria-label={`Remove ${asset.name}`}
                      title="Remove audio asset"
                      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border border-[#232A38] bg-[#131720] text-slate-400 hover:border-red-500/50 hover:text-red-300 disabled:opacity-50"
                    >
                      <Trash2 className="h-3 w-3" aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {activeTab === 'ai' && (
          <>
            <div className="flex items-center justify-between gap-2 rounded-lg border border-[#232A38] bg-[#0B0D11] px-3 py-2">
              <div className="flex items-center gap-2 text-xs text-slate-300">
                <KeyRound className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
                <span>{hasApiKey ? 'Gemini key saved' : 'No API key set'}</span>
              </div>
              <button
                type="button"
                onClick={onOpenSettings}
                className="text-xs font-medium whitespace-nowrap text-blue-400 hover:text-blue-300"
              >
                {hasApiKey ? 'Edit' : 'Add key'}
              </button>
            </div>

            <div>
              <label
                htmlFor="ai-caption-language"
                className="mb-1 block text-[11px] font-medium text-slate-400"
              >
                Audio Language
              </label>
              <select
                id="ai-caption-language"
                disabled={isBusy}
                value={captionLanguage}
                onChange={(e) => onCaptionLanguageChange(e.target.value as CaptionLanguageCode)}
                className="h-9 w-full rounded-lg border border-[#232A38] bg-[#0B0D11] px-2.5 text-xs text-slate-100 focus:border-blue-500 focus:outline-none disabled:opacity-50"
              >
                {CAPTION_LANGUAGES.map((lang) => (
                  <option key={lang.code} value={lang.code}>
                    {lang.label}
                  </option>
                ))}
              </select>
            </div>

            {!isGeneratingCaptions ? (
              <button
                type="button"
                disabled={!hasVideo || isBusy}
                onClick={hasApiKey ? onGenerateCaptions : onOpenSettings}
                className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500"
              >
                <Captions className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{hasApiKey ? 'Generate Captions' : 'Add API Key to Generate'}</span>
              </button>
            ) : (
              <div className="flex flex-col gap-2 rounded-lg border border-[#232A38] bg-[#0B0D11] p-2.5">
                <p className="text-xs text-slate-200">{captionStatus ?? 'Working...'}</p>
                <button
                  type="button"
                  onClick={onCancelCaptions}
                  className="h-8 w-full rounded-lg border border-[#323C50] bg-[#191F2C] text-xs font-medium text-slate-200 hover:border-red-500/50 hover:text-red-200"
                >
                  Cancel
                </button>
              </div>
            )}

            {hasCaptions && (
              <button
                type="button"
                disabled={isBusy}
                onClick={onDownloadSrt}
                className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-[#232A38] bg-[#0B0D11] px-3 text-xs font-medium text-slate-200 hover:border-blue-500 disabled:opacity-50"
              >
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Download .srt</span>
              </button>
            )}

            {captionError && (
              <div
                role="alert"
                className="flex min-w-0 flex-col gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-2.5 text-xs text-red-200"
              >
                <div className="flex min-w-0 items-start gap-2">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" aria-hidden="true" />
                  <span className="min-w-0 flex-1 whitespace-pre-wrap break-words [overflow-wrap:anywhere] leading-relaxed">
                    {redactApiKey(captionError)}
                  </span>
                </div>
                {hasVideo && hasApiKey && (
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={onGenerateCaptions}
                    className="self-start rounded-md border border-red-400/40 bg-red-500/20 px-2.5 py-1 text-[11px] font-semibold text-red-100 transition-colors hover:bg-red-500/30 disabled:opacity-50"
                  >
                    Retry
                  </button>
                )}
              </div>
            )}

            <p className="text-[11px] leading-relaxed text-slate-500">
              Your video stays on your device. Only the extracted audio is sent to Google&apos;s Gemini API using your own key, creating editable clips on the Captions track.
            </p>
          </>
        )}
      </div>
    </aside>
  );
}
