import { AlertCircle } from 'lucide-react';
import {
  useCallback,
  useRef,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { formatTimecode, MIN_TRIM_DURATION_SECONDS } from '../lib/editor';

interface TrimTimelineProps {
  duration: number;
  currentTime: number;
  startInput: string;
  endInput: string;
  trimStart: number;
  trimEnd: number;
  validationError: string | null;
  disabled: boolean;
  onStartInputChange: (value: string) => void;
  onEndInputChange: (value: string) => void;
  onRangeSliderChange: (start: number, end: number) => void;
  onSeek: (time: number) => void;
  onSetInAtCurrent: () => void;
  onSetOutAtCurrent: () => void;
}

type DragTarget = 'start' | 'end' | 'playhead';

export function TrimTimeline({
  duration,
  currentTime,
  startInput,
  endInput,
  trimStart,
  trimEnd,
  validationError,
  disabled,
  onStartInputChange,
  onEndInputChange,
  onRangeSliderChange,
  onSeek,
  onSetInAtCurrent,
  onSetOutAtCurrent,
}: TrimTimelineProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const activeDragRef = useRef<DragTarget | null>(null);

  const safeStart = Number.isFinite(trimStart)
    ? Math.max(0, Math.min(duration, trimStart))
    : 0;
  const safeEnd = Number.isFinite(trimEnd)
    ? Math.max(0, Math.min(duration, trimEnd))
    : duration;

  const startPct = duration > 0 ? (safeStart / duration) * 100 : 0;
  const endPct = duration > 0 ? (safeEnd / duration) * 100 : 100;
  const playheadPct =
    duration > 0 ? Math.max(0, Math.min(100, (currentTime / duration) * 100)) : 0;

  const timeFromClientX = useCallback(
    (clientX: number): number => {
      const track = trackRef.current;
      if (!track || duration <= 0) return 0;
      const rect = track.getBoundingClientRect();
      if (rect.width <= 0) return 0;
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return Math.max(0, Math.min(duration, ratio * duration));
    },
    [duration]
  );

  const applyDrag = useCallback(
    (target: DragTarget, clientX: number) => {
      const t = timeFromClientX(clientX);
      if (target === 'playhead') {
        onSeek(t);
        return;
      }
      if (target === 'start') {
        const maxStart = Math.max(0, safeEnd - MIN_TRIM_DURATION_SECONDS);
        const nextStart = Math.max(0, Math.min(maxStart, t));
        onRangeSliderChange(nextStart, safeEnd);
        onSeek(nextStart);
        return;
      }
      const minEnd = Math.min(duration, safeStart + MIN_TRIM_DURATION_SECONDS);
      const nextEnd = Math.min(duration, Math.max(minEnd, t));
      onRangeSliderChange(safeStart, nextEnd);
      onSeek(nextEnd);
    },
    [duration, onRangeSliderChange, onSeek, safeEnd, safeStart, timeFromClientX]
  );

  const handleTrackPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    event.preventDefault();
    activeDragRef.current = 'playhead';
    event.currentTarget.setPointerCapture(event.pointerId);
    applyDrag('playhead', event.clientX);
  };

  const handleHandlePointerDown =
    (target: 'start' | 'end') => (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (disabled) return;
      event.preventDefault();
      event.stopPropagation();
      activeDragRef.current = target;
      event.currentTarget.setPointerCapture(event.pointerId);
    };

  const handlePointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const target = activeDragRef.current;
    if (!target || disabled) return;
    applyDrag(target, event.clientX);
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLElement>) => {
    if (!activeDragRef.current) return;
    activeDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleHandleKeyDown =
    (target: 'start' | 'end') => (event: KeyboardEvent<HTMLButtonElement>) => {
      if (disabled) return;
      const step = event.shiftKey ? 1 : 0.1;
      let delta = 0;
      if (event.key === 'ArrowLeft') delta = -step;
      else if (event.key === 'ArrowRight') delta = step;
      else return;

      event.preventDefault();
      if (target === 'start') {
        const maxStart = Math.max(0, safeEnd - MIN_TRIM_DURATION_SECONDS);
        const nextStart = Math.max(0, Math.min(maxStart, safeStart + delta));
        onRangeSliderChange(nextStart, safeEnd);
        onSeek(nextStart);
      } else {
        const minEnd = Math.min(duration, safeStart + MIN_TRIM_DURATION_SECONDS);
        const nextEnd = Math.min(duration, Math.max(minEnd, safeEnd + delta));
        onRangeSliderChange(safeStart, nextEnd);
        onSeek(nextEnd);
      }
    };

  const rulerMarkers = [0, 0.25, 0.5, 0.75, 1].map((fraction) => ({
    fraction,
    time: duration * fraction,
  }));

  const selectedLength =
    Number.isFinite(trimStart) && Number.isFinite(trimEnd)
      ? Math.max(0, Math.min(trimEnd, duration) - Math.max(0, trimStart))
      : 0;

  return (
    <section aria-label="Timeline and trim controls" className="rounded-xl border border-[#232A38] bg-[#131720] p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
        <span className="font-medium text-slate-200">Timeline Trim</span>
        <div className="flex items-center gap-3 font-mono tabular-nums">
          <span>
            Selected: <strong className="text-slate-100">{formatTimecode(selectedLength)}</strong>
          </span>
          <span aria-hidden="true">·</span>
          <span>{selectedLength.toFixed(2)} s</span>
        </div>
      </div>

      {/* Ruler labels */}
      <div className="mb-1.5 flex justify-between font-mono text-[11px] text-slate-500 tabular-nums select-none">
        {rulerMarkers.map((marker) => (
          <span key={marker.fraction}>{formatTimecode(marker.time)}</span>
        ))}
      </div>

      {/* Dual-range interactive track */}
      <div
        ref={trackRef}
        onPointerDown={handleTrackPointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className={`relative h-12 w-full touch-none select-none rounded-lg border border-[#232A38] bg-[#0B0D11] ${
          disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
        }`}
      >
        {/* Subtle left excluded shade */}
        <div
          className="pointer-events-none absolute inset-y-0 left-0 rounded-l-lg bg-slate-950/75"
          style={{ width: `${Math.max(0, Math.min(100, startPct))}%` }}
        />

        {/* Subtle right excluded shade */}
        <div
          className="pointer-events-none absolute inset-y-0 right-0 rounded-r-lg bg-slate-950/75"
          style={{ width: `${Math.max(0, Math.min(100, 100 - endPct))}%` }}
        />

        {/* Selected active trim region */}
        {endPct > startPct && (
          <div
            className="pointer-events-none absolute inset-y-0 border-y-2 border-blue-500 bg-blue-500/15"
            style={{
              left: `${startPct}%`,
              width: `${endPct - startPct}%`,
            }}
          />
        )}

        {/* Current playhead indicator */}
        <div
          className="pointer-events-none absolute inset-y-0 z-10 w-0.5 -translate-x-1/2 bg-white"
          style={{ left: `${playheadPct}%` }}
        >
          <div className="mx-auto -mt-1 h-2.5 w-2.5 rotate-45 bg-white" />
        </div>

        {/* Trim In Handle */}
        <button
          type="button"
          role="slider"
          aria-label="Trim start time"
          aria-valuemin={0}
          aria-valuemax={Number(duration.toFixed(2))}
          aria-valuenow={Number(safeStart.toFixed(2))}
          disabled={disabled}
          onPointerDown={handleHandlePointerDown('start')}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onKeyDown={handleHandleKeyDown('start')}
          style={{ left: `${startPct}%` }}
          className="absolute top-1/2 z-20 flex h-11 w-4 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize items-center justify-center rounded border border-blue-300 bg-blue-600 shadow-sm transition-colors hover:bg-blue-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-not-allowed"
          title={`Start: ${safeStart.toFixed(2)} s`}
        >
          <span className="h-4 w-0.5 rounded-full bg-white" />
        </button>

        {/* Trim Out Handle */}
        <button
          type="button"
          role="slider"
          aria-label="Trim end time"
          aria-valuemin={0}
          aria-valuemax={Number(duration.toFixed(2))}
          aria-valuenow={Number(safeEnd.toFixed(2))}
          disabled={disabled}
          onPointerDown={handleHandlePointerDown('end')}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onKeyDown={handleHandleKeyDown('end')}
          style={{ left: `${endPct}%` }}
          className="absolute top-1/2 z-20 flex h-11 w-4 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize items-center justify-center rounded border border-blue-300 bg-blue-600 shadow-sm transition-colors hover:bg-blue-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-not-allowed"
          title={`End: ${safeEnd.toFixed(2)} s`}
        >
          <span className="h-4 w-0.5 rounded-full bg-white" />
        </button>
      </div>

      {/* Numeric Start / End inputs and Set In / Set Out buttons */}
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label htmlFor="trim-start-input" className="mb-1 block text-xs font-medium text-slate-400">
              Start (seconds)
            </label>
            <input
              id="trim-start-input"
              type="number"
              step="0.1"
              disabled={disabled}
              value={startInput}
              onChange={(e) => onStartInputChange(e.target.value)}
              className="min-h-[40px] w-full rounded-lg border border-[#232A38] bg-[#0B0D11] px-3 py-2 font-mono text-sm text-slate-100 tabular-nums focus:border-blue-500 focus:outline-none disabled:opacity-60"
            />
          </div>
          <button
            type="button"
            disabled={disabled}
            onClick={onSetInAtCurrent}
            className="min-h-[40px] rounded-lg border border-[#2C3547] bg-[#191F2C] px-3.5 py-2 text-xs font-medium text-slate-200 transition-colors hover:border-slate-500 hover:bg-[#222A3B] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 disabled:cursor-not-allowed disabled:opacity-60 whitespace-nowrap shrink-0"
          >
            Set In
          </button>
        </div>

        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label htmlFor="trim-end-input" className="mb-1 block text-xs font-medium text-slate-400">
              End (seconds)
            </label>
            <input
              id="trim-end-input"
              type="number"
              step="0.1"
              disabled={disabled}
              value={endInput}
              onChange={(e) => onEndInputChange(e.target.value)}
              className="min-h-[40px] w-full rounded-lg border border-[#232A38] bg-[#0B0D11] px-3 py-2 font-mono text-sm text-slate-100 tabular-nums focus:border-blue-500 focus:outline-none disabled:opacity-60"
            />
          </div>
          <button
            type="button"
            disabled={disabled}
            onClick={onSetOutAtCurrent}
            className="min-h-[40px] rounded-lg border border-[#2C3547] bg-[#191F2C] px-3.5 py-2 text-xs font-medium text-slate-200 transition-colors hover:border-slate-500 hover:bg-[#222A3B] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 disabled:cursor-not-allowed disabled:opacity-60 whitespace-nowrap shrink-0"
          >
            Set Out
          </button>
        </div>
      </div>

      {validationError && (
        <div
          role="alert"
          className="mt-3 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200"
        >
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" aria-hidden="true" />
          <span>{validationError}</span>
        </div>
      )}
    </section>
  );
}
