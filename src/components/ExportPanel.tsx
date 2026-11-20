import { AlertCircle, CheckCircle2, Download, FolderOpen, X } from 'lucide-react';
import {
  formatBytes,
  formatTimecode,
  type ExportMode,
  type RenderProgress,
  type RenderResult,
  type VideoFileMetadata,
} from '../lib/editor';

interface ExportPanelProps {
  videoMeta: VideoFileMetadata;
  mode: ExportMode;
  onModeChange: (mode: ExportMode) => void;
  isTrimValid: boolean;
  trimError: string | null;
  isExporting: boolean;
  progress: RenderProgress | null;
  exportError: string | null;
  exportResult: RenderResult | null;
  exportResultUrl: string | null;
  onExport: () => void;
  onCancelExport: () => void;
  onClearResult: () => void;
  onChangeVideo: () => void;
}

function getPhaseLabel(progress: RenderProgress | null): string {
  if (!progress) return 'Starting export...';
  switch (progress.phase) {
    case 'loading':
      return 'Loading ffmpeg core (first export)...';
    case 'preparing':
      return 'Loading video into browser memory...';
    case 'processing':
      return 'Trimming video...';
    case 'finalizing':
      return 'Finalizing MP4...';
  }
}

export function ExportPanel({
  videoMeta,
  mode,
  onModeChange,
  isTrimValid,
  trimError,
  isExporting,
  progress,
  exportError,
  exportResult,
  exportResultUrl,
  onExport,
  onCancelExport,
  onClearResult,
  onChangeVideo,
}: ExportPanelProps) {
  const pct = progress ? Math.round(progress.progress * 100) : 0;

  return (
    <aside className="flex flex-col gap-5 rounded-xl border border-[#232A38] bg-[#131720] p-5">
      {/* Source file metadata */}
      <div>
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-100">Source Video</h2>
          <button
            type="button"
            disabled={isExporting}
            onClick={onChangeVideo}
            className="inline-flex min-h-[32px] items-center gap-1.5 text-xs font-medium text-blue-400 transition-colors hover:text-blue-300 disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Change video</span>
          </button>
        </div>

        <p className="mt-2 truncate text-sm font-medium text-slate-200" title={videoMeta.name}>
          {videoMeta.name}
        </p>

        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-xs text-slate-400 tabular-nums">
          <span>{videoMeta.extension.toUpperCase()}</span>
          <span aria-hidden="true">·</span>
          <span>{formatBytes(videoMeta.size)}</span>
          <span aria-hidden="true">·</span>
          <span>{formatTimecode(videoMeta.duration)}</span>
          {videoMeta.width > 0 && videoMeta.height > 0 && (
            <>
              <span aria-hidden="true">·</span>
              <span>
                {videoMeta.width}×{videoMeta.height}
              </span>
            </>
          )}
        </div>

        <p className="mt-2 text-xs text-slate-500">Your video stays on your device.</p>
      </div>

      <div className="h-px bg-[#232A38]" />

      {/* Export mode selection */}
      <div>
        <span className="block text-sm font-semibold text-slate-100">Export Mode</span>

        <div
          role="radiogroup"
          aria-label="Export mode"
          className="mt-2.5 grid grid-cols-2 gap-1 rounded-lg border border-[#232A38] bg-[#0B0D11] p-1"
        >
          <button
            type="button"
            role="radio"
            aria-checked={mode === 'fast'}
            disabled={isExporting}
            onClick={() => onModeChange('fast')}
            className={`min-h-[40px] rounded-md px-3 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
              mode === 'fast'
                ? 'bg-[#1D2433] text-white'
                : 'text-slate-400 hover:text-slate-200'
            } disabled:cursor-not-allowed disabled:opacity-60`}
          >
            Fast
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={mode === 'precise'}
            disabled={isExporting}
            onClick={() => onModeChange('precise')}
            className={`min-h-[40px] rounded-md px-3 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
              mode === 'precise'
                ? 'bg-[#1D2433] text-white'
                : 'text-slate-400 hover:text-slate-200'
            } disabled:cursor-not-allowed disabled:opacity-60`}
          >
            Precise
          </button>
        </div>

        <p className="mt-2.5 text-xs leading-relaxed text-slate-400">
          {mode === 'fast'
            ? 'Copies video and audio streams without re-encoding. Very fast, though cuts snap to nearest keyframes.'
            : 'Re-encodes to H.264 + AAC for frame-accurate cuts. Takes longer and uses more memory.'}
        </p>
      </div>

      {/* Primary export / cancel controls */}
      <div className="flex flex-col gap-3">
        {!isExporting ? (
          <button
            type="button"
            disabled={!isTrimValid}
            onClick={onExport}
            className="min-h-[44px] w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500 whitespace-nowrap"
          >
            Export MP4
          </button>
        ) : (
          <div className="flex flex-col gap-3 rounded-lg border border-[#232A38] bg-[#0B0D11] p-3.5">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="font-medium text-slate-200">{getPhaseLabel(progress)}</span>
              <span className="font-mono text-slate-300 tabular-nums">{pct}%</span>
            </div>

            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
              className="h-2 w-full overflow-hidden rounded-full bg-[#1C2230]"
            >
              <div
                className="h-full bg-blue-500 transition-[width] duration-150"
                style={{ width: `${pct}%` }}
              />
            </div>

            <button
              type="button"
              onClick={onCancelExport}
              className="min-h-[40px] w-full rounded-lg border border-[#323C50] bg-[#191F2C] px-4 py-2 text-xs font-semibold text-slate-200 transition-colors hover:border-red-500/50 hover:text-red-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-400"
            >
              Cancel Export
            </button>
          </div>
        )}

        {!isTrimValid && trimError && !isExporting && (
          <p className="text-xs text-red-300">
            Export disabled: {trimError}
          </p>
        )}
      </div>

      {/* Export error state */}
      {exportError && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-lg border border-red-500/30 bg-red-500/10 p-3.5 text-xs leading-relaxed text-red-200"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" aria-hidden="true" />
          <span>{exportError}</span>
        </div>
      )}

      {/* Exported result preview and download */}
      {exportResult && exportResultUrl && (
        <>
          <div className="h-px bg-[#232A38]" />

          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400">
                <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>Export Ready</span>
              </div>
              <button
                type="button"
                onClick={onClearResult}
                aria-label="Clear exported preview"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-[#1C2230] hover:text-slate-200"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <video
              key={exportResultUrl}
              src={exportResultUrl}
              controls
              playsInline
              className="aspect-video w-full rounded-lg border border-[#232A38] bg-black"
            />

            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-xs text-slate-400 tabular-nums">
              <span>{exportResult.duration.toFixed(2)} s</span>
              <span aria-hidden="true">·</span>
              <span>{formatBytes(exportResult.size)}</span>
              <span aria-hidden="true">·</span>
              <span>{exportResult.mode === 'fast' ? 'Fast' : 'Precise'}</span>
            </div>

            <a
              href={exportResultUrl}
              download={exportResult.suggestedFilename}
              className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400 whitespace-nowrap"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              <span>Download MP4</span>
            </a>

            <p className="truncate font-mono text-[11px] text-slate-500" title={exportResult.suggestedFilename}>
              {exportResult.suggestedFilename}
            </p>
          </div>
        </>
      )}
    </aside>
  );
}
