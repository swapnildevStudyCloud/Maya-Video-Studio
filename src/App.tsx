import { Pause, Play, SkipBack, SkipForward, Volume2, VolumeX } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { ExportPanel } from './components/ExportPanel';
import { TrimTimeline } from './components/TrimTimeline';
import { VideoDropzone } from './components/VideoDropzone';
import {
  formatTimecode,
  renderTrimmedVideo,
  validateTrimRange,
  validateVideoFile,
  type ExportMode,
  type RenderProgress,
  type RenderResult,
  type VideoFileMetadata,
} from './lib/editor';

function parseTrimNumber(raw: string): number {
  const trimmed = raw.trim();
  if (trimmed === '') return Number.NaN;
  return Number(trimmed);
}

export default function App() {
  const headerFileInputRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [videoMeta, setVideoMeta] = useState<VideoFileMetadata | null>(null);
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);

  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [startInput, setStartInput] = useState('0.00');
  const [endInput, setEndInput] = useState('0.00');

  const [exportMode, setExportMode] = useState<ExportMode>('fast');
  const [isExporting, setIsExporting] = useState(false);
  const [renderProgress, setRenderProgress] = useState<RenderProgress | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportResult, setExportResult] = useState<RenderResult | null>(null);
  const [exportResultUrl, setExportResultUrl] = useState<string | null>(null);

  // Revoke source object URL on change or unmount
  useEffect(() => {
    return () => {
      if (sourceUrl) {
        URL.revokeObjectURL(sourceUrl);
      }
    };
  }, [sourceUrl]);

  // Revoke export result object URL on change or unmount
  useEffect(() => {
    return () => {
      if (exportResultUrl) {
        URL.revokeObjectURL(exportResultUrl);
      }
    };
  }, [exportResultUrl]);

  const clearExportResult = useCallback(() => {
    setExportResult(null);
    setExportResultUrl(null);
  }, []);

  const handleSelectFile = useCallback(async (file: File) => {
    setIsLoadingFile(true);
    setFileError(null);
    setExportError(null);

    const validation = await validateVideoFile(file);
    if (!validation.ok) {
      setIsLoadingFile(false);
      setFileError(validation.error);
      return;
    }

    const nextUrl = URL.createObjectURL(file);
    const meta = validation.value;

    setSourceFile(file);
    setSourceUrl(nextUrl);
    setVideoMeta(meta);
    setCurrentTime(0);
    setIsPlaying(false);
    setTrimStart(0);
    setTrimEnd(meta.duration);
    setStartInput('0.00');
    setEndInput(meta.duration.toFixed(2));
    setExportResult(null);
    setExportResultUrl(null);
    setRenderProgress(null);
    setIsLoadingFile(false);
  }, []);

  const handleHeaderFileInput = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      void handleSelectFile(file);
    }
    event.target.value = '';
  };

  const handleChangeVideo = () => {
    if (isExporting) return;
    setSourceFile(null);
    setSourceUrl(null);
    setVideoMeta(null);
    setFileError(null);
    setExportError(null);
    clearExportResult();
    setCurrentTime(0);
    setIsPlaying(false);
  };

  const trimValidation = useMemo(() => {
    if (!videoMeta) {
      return { ok: false as const, error: 'No video loaded.' };
    }
    return validateTrimRange(trimStart, trimEnd, videoMeta.duration);
  }, [trimEnd, trimStart, videoMeta]);

  const handleSeek = useCallback((time: number) => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(time)) return;
    const clamped = Math.max(0, Math.min(video.duration || time, time));
    video.currentTime = clamped;
    setCurrentTime(clamped);
  }, []);

  const handleTogglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused || video.ended) {
      void video.play().catch(() => {
        setIsPlaying(false);
      });
    } else {
      video.pause();
    }
  }, []);

  const handleToggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setIsMuted(video.muted);
  }, []);

  const handleStartInputChange = useCallback((raw: string) => {
    setStartInput(raw);
    setTrimStart(parseTrimNumber(raw));
  }, []);

  const handleEndInputChange = useCallback((raw: string) => {
    setEndInput(raw);
    setTrimEnd(parseTrimNumber(raw));
  }, []);

  const handleRangeSliderChange = useCallback(
    (nextStart: number, nextEnd: number) => {
      const maxDuration = videoMeta?.duration ?? nextEnd;
      const clampedStart = Math.max(0, Math.min(maxDuration, nextStart));
      const clampedEnd = Math.max(0, Math.min(maxDuration, nextEnd));
      setTrimStart(clampedStart);
      setTrimEnd(clampedEnd);
      setStartInput(clampedStart.toFixed(2));
      setEndInput(clampedEnd.toFixed(2));
    },
    [videoMeta]
  );

  const handleSetInAtCurrent = useCallback(() => {
    const video = videoRef.current;
    const raw = video ? video.currentTime : currentTime;
    const maxDuration = videoMeta?.duration ?? raw;
    const clamped = Math.max(0, Math.min(maxDuration, raw));
    setTrimStart(clamped);
    setStartInput(clamped.toFixed(2));
  }, [currentTime, videoMeta]);

  const handleSetOutAtCurrent = useCallback(() => {
    const video = videoRef.current;
    const raw = video ? video.currentTime : currentTime;
    const maxDuration = videoMeta?.duration ?? raw;
    const clamped = Math.max(0, Math.min(maxDuration, raw));
    setTrimEnd(clamped);
    setEndInput(clamped.toFixed(2));
  }, [currentTime, videoMeta]);

  const handleExport = useCallback(async () => {
    if (!sourceFile || !videoMeta || !trimValidation.ok || isExporting) return;

    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsExporting(true);
    setExportError(null);
    setExportResult(null);
    setExportResultUrl(null);
    setRenderProgress({ phase: 'loading', progress: 0 });

    try {
      const result = await renderTrimmedVideo({
        file: sourceFile,
        start: trimValidation.value.start,
        end: trimValidation.value.end,
        duration: videoMeta.duration,
        mode: exportMode,
        signal: controller.signal,
        onProgress: (nextProgress) => {
          setRenderProgress(nextProgress);
        },
      });

      const resultUrl = URL.createObjectURL(result.blob);
      setExportResult(result);
      setExportResultUrl(resultUrl);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        // User cancelled export intentionally
      } else {
        setExportError(
          err instanceof Error
            ? err.message
            : 'Video export failed. Try Fast mode or a smaller file.'
        );
      }
    } finally {
      abortControllerRef.current = null;
      setIsExporting(false);
      setRenderProgress(null);
    }
  }, [exportMode, isExporting, sourceFile, trimValidation, videoMeta]);

  const handleCancelExport = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  return (
    <div className="min-h-screen bg-[#0B0D11] text-slate-100">
      {/* Top Bar */}
      <header className="border-b border-[#232A38] bg-[#0B0D11]">
        <div className="mx-auto flex max-w-[1360px] items-center justify-between gap-8 px-4 py-3.5 sm:px-6">
          <span className="text-base font-semibold tracking-tight text-slate-100 whitespace-nowrap shrink-0">
            Maya Video Studio
          </span>

          <div className="flex items-center gap-3 shrink-0">
            <input
              ref={headerFileInputRef}
              type="file"
              accept=".mp4,.mov,video/mp4,video/quicktime"
              onChange={handleHeaderFileInput}
              className="sr-only"
              aria-label="Open a different video file"
            />
            {videoMeta && (
              <button
                type="button"
                disabled={isExporting || isLoadingFile}
                onClick={() => headerFileInputRef.current?.click()}
                className="min-h-[38px] rounded-lg border border-[#2C3547] bg-[#131720] px-4 py-1.5 text-xs font-semibold text-slate-100 transition-colors hover:border-slate-500 hover:bg-[#191F2C] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                Open Video
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1360px] px-4 py-6 sm:px-6">
        {/* Small / mobile screen browser memory notice */}
        <div className="mb-5 rounded-lg border border-amber-500/25 bg-amber-500/10 px-4 py-2.5 text-xs leading-relaxed text-amber-200 md:hidden">
          Large video files may fail on mobile browsers due to memory limits. Desktop Chrome, Edge, or Firefox is recommended.
        </div>

        {!videoMeta || !sourceUrl ? (
          <VideoDropzone
            isLoading={isLoadingFile}
            error={fileError}
            onSelectFile={handleSelectFile}
          />
        ) : (
          <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[1fr_340px]">
            {/* Left stage: Player + Timeline */}
            <div className="flex flex-col gap-5">
              {fileError && (
                <div
                  role="alert"
                  className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"
                >
                  {fileError}
                </div>
              )}

              {/* Video preview stage */}
              <section
                aria-label="Video preview"
                className="overflow-hidden rounded-xl border border-[#232A38] bg-[#131720]"
              >
                <div className="flex aspect-video w-full items-center justify-center bg-black">
                  <video
                    ref={videoRef}
                    src={sourceUrl}
                    playsInline
                    onClick={handleTogglePlay}
                    onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                    onPlay={() => setIsPlaying(true)}
                    onPause={() => setIsPlaying(false)}
                    onEnded={() => setIsPlaying(false)}
                    className="h-full w-full cursor-pointer object-contain"
                  />
                </div>

                {/* Transport controls bar */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#232A38] px-4 py-3">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleTogglePlay}
                      aria-label={isPlaying ? 'Pause video' : 'Play video'}
                      className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-[#1D2433] px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#263044] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 whitespace-nowrap shrink-0"
                    >
                      {isPlaying ? (
                        <Pause className="h-3.5 w-3.5" aria-hidden="true" />
                      ) : (
                        <Play className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                      <span>{isPlaying ? 'Pause' : 'Play'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleSeek(Number.isFinite(trimStart) ? trimStart : 0)}
                      title="Jump to trim start"
                      className="inline-flex min-h-[40px] items-center gap-1 rounded-lg border border-[#232A38] bg-[#0B0D11] px-3 py-2 text-xs font-medium text-slate-300 transition-colors hover:border-[#323C50] hover:text-white whitespace-nowrap shrink-0"
                    >
                      <SkipBack className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>In</span>
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        handleSeek(Number.isFinite(trimEnd) ? trimEnd : videoMeta.duration)
                      }
                      title="Jump to trim end"
                      className="inline-flex min-h-[40px] items-center gap-1 rounded-lg border border-[#232A38] bg-[#0B0D11] px-3 py-2 text-xs font-medium text-slate-300 transition-colors hover:border-[#323C50] hover:text-white whitespace-nowrap shrink-0"
                    >
                      <span>Out</span>
                      <SkipForward className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="font-mono text-xs text-slate-300 tabular-nums">
                      <span>{formatTimecode(currentTime)}</span>
                      <span className="mx-1.5 text-slate-600">/</span>
                      <span className="text-slate-400">{formatTimecode(videoMeta.duration)}</span>
                    </div>

                    <button
                      type="button"
                      onClick={handleToggleMute}
                      aria-label={isMuted ? 'Unmute video' : 'Mute video'}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-[#232A38] bg-[#0B0D11] text-slate-300 transition-colors hover:border-[#323C50] hover:text-white"
                    >
                      {isMuted ? (
                        <VolumeX className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <Volume2 className="h-4 w-4" aria-hidden="true" />
                      )}
                    </button>
                  </div>
                </div>
              </section>

              {/* Dual-range trim timeline & numeric inputs */}
              <TrimTimeline
                duration={videoMeta.duration}
                currentTime={currentTime}
                startInput={startInput}
                endInput={endInput}
                trimStart={trimStart}
                trimEnd={trimEnd}
                validationError={trimValidation.ok ? null : trimValidation.error}
                disabled={isExporting}
                onStartInputChange={handleStartInputChange}
                onEndInputChange={handleEndInputChange}
                onRangeSliderChange={handleRangeSliderChange}
                onSeek={handleSeek}
                onSetInAtCurrent={handleSetInAtCurrent}
                onSetOutAtCurrent={handleSetOutAtCurrent}
              />
            </div>

            {/* Right inspector & export panel */}
            <ExportPanel
              videoMeta={videoMeta}
              mode={exportMode}
              onModeChange={setExportMode}
              isTrimValid={trimValidation.ok}
              trimError={trimValidation.ok ? null : trimValidation.error}
              isExporting={isExporting}
              progress={renderProgress}
              exportError={exportError}
              exportResult={exportResult}
              exportResultUrl={exportResultUrl}
              onExport={handleExport}
              onCancelExport={handleCancelExport}
              onClearResult={clearExportResult}
              onChangeVideo={handleChangeVideo}
            />
          </div>
        )}
      </main>
    </div>
  );
}
