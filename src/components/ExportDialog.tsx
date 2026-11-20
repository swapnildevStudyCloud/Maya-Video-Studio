import { AlertCircle, AlertTriangle, CheckCircle2, Download, X } from 'lucide-react';
import { useEffect } from 'react';
import {
  ALLOWED_CANVAS_FIT_MODES,
  ALLOWED_CANVAS_PRESETS,
  ALLOWED_EXPORT_QUALITIES,
  formatBytes,
  getHeavyExportWarningInfo,
  SLOW_REENCODE_WARNING_SECONDS,
  type CanvasFitMode,
  type ExportCanvasPreset,
  type ExportMode,
  type ExportQuality,
  type ExportSettings,
  type ProjectState,
  type RenderProgress,
  type RenderResult,
} from '../lib/editor';

interface ExportDialogProps {
  isOpen: boolean;
  project: ProjectState;
  requiresReencode: boolean;
  projectDuration: number;
  sourceDuration: number;
  firstClipSizeLabel?: string | null;
  validationError: string | null;
  isExporting: boolean;
  progress: RenderProgress | null;
  exportError: string | null;
  exportResult: RenderResult | null;
  exportResultUrl: string | null;
  onClose: () => void;
  onModeChange: (mode: ExportMode) => void;
  onSettingsChange: (next: ExportSettings) => void;
  onExport: () => void;
  onCancelExport: () => void;
  onClearResult: () => void;
}

const QUALITY_LABELS: Record<ExportQuality, string> = {
  draft: 'Draft (480p, fast)',
  small: 'Small',
  balanced: 'Balanced',
  high: 'High',
};

const CANVAS_PRESET_LABELS: Record<ExportCanvasPreset, string> = {
  original: 'Original',
  '1080p-16:9': '1080p 16:9',
  '720p-16:9': '720p 16:9',
  '9:16': '9:16',
  '1:1': '1:1',
};

const CANVAS_FIT_LABELS: Record<CanvasFitMode, string> = {
  fit: 'Fit (black bars)',
  fill: 'Fill (crop)',
};

function getPhaseLabel(progress: RenderProgress | null): string {
  if (!progress) return 'Starting export...';
  if (progress.statusText) return progress.statusText;
  switch (progress.phase) {
    case 'loading':
      return 'Loading ffmpeg core...';
    case 'preparing':
      return 'Preparing timeline media...';
    case 'processing':
      return 'Rendering...';
    case 'finalizing':
      return 'Finalizing output...';
  }
}

export function ExportDialog({
  isOpen,
  project,
  requiresReencode,
  projectDuration,
  sourceDuration,
  firstClipSizeLabel,
  validationError,
  isExporting,
  progress,
  exportError,
  exportResult,
  exportResultUrl,
  onClose,
  onModeChange,
  onSettingsChange,
  onExport,
  onCancelExport,
  onClearResult,
}: ExportDialogProps) {
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isExporting) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isExporting, isOpen, onClose]);

  if (!isOpen) return null;

  const { exportMode, exportSettings } = project;
  const activeCanvasPreset: ExportCanvasPreset = exportSettings.canvasPreset ?? 'original';
  const activeCanvasFit: CanvasFitMode = exportSettings.canvasFit ?? 'fit';
  const effectiveMode: ExportMode = requiresReencode ? 'precise' : exportMode;
  const pct = progress ? Math.round(progress.progress * 100) : 0;
  const canStart = !validationError && !isExporting;
  const showSlowWarning =
    effectiveMode === 'precise' &&
    (sourceDuration > SLOW_REENCODE_WARNING_SECONDS ||
      projectDuration > SLOW_REENCODE_WARNING_SECONDS);
  const heavyEffectsWarning = getHeavyExportWarningInfo(project, projectDuration);
  const showHeavyEffectsWarning =
    !exportSettings.audioOnlyMp3 && heavyEffectsWarning.hasManyEffectsOnLongVideo;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
      onClick={() => {
        if (!isExporting) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-dialog-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-lg border border-[#232A38] bg-[#131720] p-6"
      >
        <div className="flex items-center justify-between gap-4">
          <h2 id="export-dialog-title" className="text-base font-semibold text-slate-100">
            Export Project
          </h2>
          <button
            type="button"
            disabled={isExporting}
            onClick={onClose}
            aria-label="Close export dialog"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-[#1D2433] hover:text-slate-100 disabled:opacity-40"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="mt-4 flex flex-col gap-4">
          {/* Audio only toggle */}
          <label className="flex cursor-pointer items-center justify-between rounded-lg border border-[#232A38] bg-[#0B0D11] px-3 py-2.5 text-xs text-slate-200">
            <div>
              <span className="block font-medium">Export audio only (mp3)</span>
              <span className="text-[11px] text-slate-400">
                Mixes kept video audio and audio track clips to MP3
              </span>
            </div>
            <input
              type="checkbox"
              disabled={isExporting}
              checked={exportSettings.audioOnlyMp3}
              onChange={(e) =>
                onSettingsChange({ ...exportSettings, audioOnlyMp3: e.target.checked })
              }
              className="h-4 w-4 rounded border-[#2C3547] accent-blue-600"
            />
          </label>

          {!exportSettings.audioOnlyMp3 && (
            <>
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-300">Project Canvas</span>
                  {firstClipSizeLabel && activeCanvasPreset === 'original' && (
                    <span className="font-mono text-[11px] text-slate-400">
                      First clip: {firstClipSizeLabel}
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-5 gap-1 rounded-lg border border-[#232A38] bg-[#0B0D11] p-1">
                  {ALLOWED_CANVAS_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      disabled={isExporting}
                      onClick={() =>
                        onSettingsChange({
                          ...exportSettings,
                          canvasPreset: preset,
                          resolution: 'original',
                        })
                      }
                      className={`h-8 rounded-lg px-1 text-[11px] font-medium whitespace-nowrap transition-colors ${
                        activeCanvasPreset === preset
                          ? 'bg-[#1D2433] text-white'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {CANVAS_PRESET_LABELS[preset]}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <span className="mb-1.5 block text-xs font-medium text-slate-300">
                  Clip Framing
                </span>
                <div className="grid grid-cols-2 gap-1 rounded-lg border border-[#232A38] bg-[#0B0D11] p-1">
                  {ALLOWED_CANVAS_FIT_MODES.map((fit) => (
                    <button
                      key={fit}
                      type="button"
                      disabled={isExporting}
                      onClick={() => onSettingsChange({ ...exportSettings, canvasFit: fit })}
                      className={`h-8 rounded-lg text-xs font-medium transition-colors ${
                        activeCanvasFit === fit
                          ? 'bg-[#1D2433] text-white'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {CANVAS_FIT_LABELS[fit]}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          <div>
            <span className="mb-1.5 block text-xs font-medium text-slate-300">Quality</span>
            <div className="grid grid-cols-2 gap-1 rounded-lg border border-[#232A38] bg-[#0B0D11] p-1 sm:grid-cols-4">
              {ALLOWED_EXPORT_QUALITIES.map((q) => (
                <button
                  key={q}
                  type="button"
                  disabled={isExporting}
                  onClick={() => onSettingsChange({ ...exportSettings, quality: q })}
                  className={`h-8 rounded-lg px-2 text-xs font-medium whitespace-nowrap transition-colors ${
                    exportSettings.quality === q
                      ? 'bg-[#1D2433] text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {QUALITY_LABELS[q]}
                </button>
              ))}
            </div>
            {exportSettings.quality === 'draft' && !exportSettings.audioOnlyMp3 && (
              <p className="mt-1.5 text-[11px] text-slate-400">
                Draft caps output short side at 480p and up to 24 fps for quicker browser exports.
              </p>
            )}
          </div>

          {!exportSettings.audioOnlyMp3 && (
            <div>
              <span className="mb-1.5 block text-xs font-medium text-slate-300">Export Mode</span>
              <div className="grid grid-cols-2 gap-1 rounded-lg border border-[#232A38] bg-[#0B0D11] p-1">
                <button
                  type="button"
                  disabled={isExporting || requiresReencode}
                  onClick={() => onModeChange('fast')}
                  className={`h-8 rounded-lg text-xs font-semibold transition-colors ${
                    effectiveMode === 'fast'
                      ? 'bg-[#1D2433] text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  } disabled:cursor-not-allowed disabled:opacity-45`}
                >
                  Fast (stream copy)
                </button>
                <button
                  type="button"
                  disabled={isExporting}
                  onClick={() => onModeChange('precise')}
                  className={`h-8 rounded-lg text-xs font-semibold transition-colors ${
                    effectiveMode === 'precise'
                      ? 'bg-[#1D2433] text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Precise (re-encode)
                </button>
              </div>
              {requiresReencode && (
                <p className="mt-1.5 text-[11px] text-slate-400">
                  Precise mode is required because multiple clips, canvas framing, overlays, filters, or export settings are active.
                </p>
              )}
            </div>
          )}

          {showSlowWarning && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" aria-hidden="true" />
              <span>
                This project is over 2 minutes long — re-encoding in the browser may be slow.
              </span>
            </div>
          )}

          {showHeavyEffectsWarning && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" aria-hidden="true" />
              <span>
                This project has {heavyEffectsWarning.activeEffectCount} effects over a 1+ minute timeline. Rendering may take longer or run low on browser memory — consider <strong>Draft (480p, fast)</strong>.
              </span>
            </div>
          )}

          {validationError && !isExporting && (
            <p className="text-xs text-red-300">Cannot export: {validationError}</p>
          )}

          {!isExporting ? (
            <button
              type="button"
              disabled={!canStart}
              onClick={onExport}
              className="h-10 w-full rounded-lg bg-blue-600 text-xs font-semibold text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500"
            >
              {exportSettings.audioOnlyMp3 ? 'Export MP3' : 'Start Export'}
            </button>
          ) : (
            <div className="flex flex-col gap-2.5 rounded-lg border border-[#232A38] bg-[#0B0D11] p-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-slate-200">{getPhaseLabel(progress)}</span>
                <span className="font-mono text-slate-300 tabular-nums">{pct}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-[#1C2230]">
                <div
                  className="h-full bg-blue-500 transition-[width] duration-150"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <button
                type="button"
                onClick={onCancelExport}
                className="h-8 w-full rounded-lg border border-[#323C50] bg-[#191F2C] text-xs font-semibold text-slate-200 hover:border-red-500/50 hover:text-red-200"
              >
                Cancel Export
              </button>
            </div>
          )}

          {exportError && (
            <div
              role="alert"
              className="flex flex-col gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200"
            >
              <div className="flex min-w-0 items-start gap-2">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" aria-hidden="true" />
                <span className="min-w-0 flex-1 whitespace-pre-wrap break-words [overflow-wrap:anywhere] leading-relaxed">
                  {exportError}
                </span>
              </div>
              {canStart && (
                <button
                  type="button"
                  onClick={onExport}
                  className="self-start rounded-md border border-red-400/40 bg-red-500/20 px-3 py-1 text-[11px] font-semibold text-red-100 transition-colors hover:bg-red-500/30"
                >
                  Retry
                </button>
              )}
            </div>
          )}

          {exportResult && exportResultUrl && (
            <div className="flex flex-col gap-3 border-t border-[#232A38] pt-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400">
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  <span>Export Ready</span>
                </div>
                <button
                  type="button"
                  onClick={onClearResult}
                  aria-label="Clear export result"
                  className="text-slate-400 hover:text-slate-200"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>

              {exportResult.isAudioOnly ? (
                <audio key={exportResultUrl} src={exportResultUrl} controls className="w-full" />
              ) : (
                <video
                  key={exportResultUrl}
                  src={exportResultUrl}
                  controls
                  playsInline
                  className="aspect-video w-full rounded-lg border border-[#232A38] bg-black"
                />
              )}

              <div className="flex items-center justify-between">
                <span className="font-mono text-xs text-slate-400 tabular-nums">
                  {exportResult.duration.toFixed(2)} s · {formatBytes(exportResult.size)}
                </span>
                <a
                  href={exportResultUrl}
                  download={exportResult.suggestedFilename}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-emerald-600 px-4 text-xs font-semibold text-white hover:bg-emerald-500"
                >
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{exportResult.isAudioOnly ? 'Download MP3' : 'Download MP4'}</span>
                </a>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
