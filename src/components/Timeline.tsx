import {
  ArrowLeftRight,
  Captions,
  Copy,
  Eye,
  EyeOff,
  Film,
  Image as ImageIcon,
  Magnet,
  Music,
  Plus,
  Scissors,
  Sparkles,
  Trash2,
  Type,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent,
  type PointerEvent,
  type WheelEvent,
} from 'react';
import {
  formatTimecode,
  getEffectiveTransitionDuration,
  getProjectDuration,
  getSnapTargets,
  MAX_TIMELINE_ZOOM,
  MIN_TIMELINE_ZOOM,
  snapClipMoveStart,
  snapTime,
  VIDEO_TRANSITION_META,
  type MediaAsset,
  type ProjectState,
  type TimelineClip,
  type TimelineTrack,
  type TrackKind,
} from '../lib/editor';

interface TimelineProps {
  project: ProjectState;
  assets: Map<string, MediaAsset>;
  playhead: number;
  selectedClipId: string | null;
  selectedTransitionClipId: string | null;
  zoomPxPerSec: number;
  snapEnabled: boolean;
  disabled: boolean;
  onSelectClip: (clipId: string | null) => void;
  onSelectTransition: (clipId: string | null) => void;
  onPlayheadChange: (time: number) => void;
  onZoomChange: (zoom: number) => void;
  onToggleSnap: () => void;
  onBeginDragTransaction: () => void;
  onMoveClip: (clipId: string, start: number, targetTrackId?: string) => void;
  onResizeClip: (clipId: string, edge: 'left' | 'right', time: number) => void;
  onCommitDragTransaction: () => void;
  onSplitAtPlayhead: () => void;
  onDuplicateSelected: () => void;
  onDeleteSelected: () => void;
  onAddTrackRow: (kind: 'text' | 'image' | 'effects') => void;
  onToggleTrackMute: (trackId: string) => void;
  onToggleTrackHide: (trackId: string) => void;
  onDropAssetOnTimeline: (assetId: string, dropTime: number, targetTrackId?: string) => void;
}

const HEADER_WIDTH = 160;
const TRACK_HEIGHT = 44;

function getTickStep(zoomPxPerSec: number): number {
  if (zoomPxPerSec >= 150) return 0.5;
  if (zoomPxPerSec >= 80) return 1;
  if (zoomPxPerSec >= 40) return 2;
  if (zoomPxPerSec >= 22) return 5;
  return 10;
}

function TrackIcon({ kind }: { kind: TrackKind }) {
  switch (kind) {
    case 'video':
      return <Film className="h-3.5 w-3.5 text-blue-400" aria-hidden="true" />;
    case 'effects':
      return <Sparkles className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />;
    case 'captions':
      return <Captions className="h-3.5 w-3.5 text-slate-300" aria-hidden="true" />;
    case 'text':
      return <Type className="h-3.5 w-3.5 text-slate-300" aria-hidden="true" />;
    case 'image':
      return <ImageIcon className="h-3.5 w-3.5 text-slate-300" aria-hidden="true" />;
    case 'audio':
      return <Music className="h-3.5 w-3.5 text-slate-300" aria-hidden="true" />;
  }
}

export function Timeline({
  project,
  assets,
  playhead,
  selectedClipId,
  selectedTransitionClipId,
  zoomPxPerSec,
  snapEnabled,
  disabled,
  onSelectClip,
  onSelectTransition,
  onPlayheadChange,
  onZoomChange,
  onToggleSnap,
  onBeginDragTransaction,
  onMoveClip,
  onResizeClip,
  onCommitDragTransaction,
  onSplitAtPlayhead,
  onDuplicateSelected,
  onDeleteSelected,
  onAddTrackRow,
  onToggleTrackMute,
  onToggleTrackHide,
  onDropAssetOnTimeline,
}: TimelineProps) {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const trackRowsRef = useRef<HTMLDivElement | null>(null);
  const [snapGuideTime, setSnapGuideTime] = useState<number | null>(null);
  const [isScrubbingPlayhead, setIsScrubbingPlayhead] = useState(false);
  const [dropHoverTrackId, setDropHoverTrackId] = useState<string | null>(null);
  const prevResizeDxRef = useRef(0);

  const [dragState, setDragState] = useState<
    | {
        mode: 'move';
        clip: TimelineClip;
        trackKind: TrackKind;
        startClientX: number;
        origStart: number;
      }
    | {
        mode: 'resize-left' | 'resize-right';
        clip: TimelineClip;
        trackKind: TrackKind;
        startClientX: number;
        origStart: number;
        origEnd: number;
      }
    | null
  >(null);

  const projectDuration = useMemo(() => getProjectDuration(project), [project]);
  const timelineTotalSeconds = Math.max(20, Math.ceil(projectDuration + 8));
  const canvasWidth = Math.max(840, Math.ceil(timelineTotalSeconds * zoomPxPerSec));
  const tickStep = getTickStep(zoomPxPerSec);

  const ticks = useMemo(() => {
    const arr: number[] = [];
    for (let t = 0; t <= timelineTotalSeconds; t += tickStep) {
      arr.push(Number(t.toFixed(2)));
    }
    return arr;
  }, [tickStep, timelineTotalSeconds]);

  const timeFromClientX = (clientX: number): number => {
    const container = scrollContainerRef.current;
    if (!container) return 0;
    const rect = container.getBoundingClientRect();
    const x = clientX - rect.left + container.scrollLeft;
    return Math.max(0, x / zoomPxPerSec);
  };

  // Playhead scrubbing
  useEffect(() => {
    if (!isScrubbingPlayhead) return;
    const handleMove = (e: globalThis.PointerEvent) => {
      onPlayheadChange(timeFromClientX(e.clientX));
    };
    const handleUp = () => {
      setIsScrubbingPlayhead(false);
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
  });

  // Clip move & resize pointer handling
  useEffect(() => {
    if (!dragState) return;
    const snapToleranceSec = 8 / zoomPxPerSec;

    const handleMove = (e: globalThis.PointerEvent) => {
      const dxSec = (e.clientX - dragState.startClientX) / zoomPxPerSec;
      const targets = snapEnabled
        ? getSnapTargets(project.tracks, playhead, dragState.clip.id)
        : [];

      if (dragState.mode === 'move') {
        const rawStart = Math.max(0, dragState.origStart + dxSec);

        // Ripple Video track reorders cleanly by raw dragged midpoint
        if (dragState.trackKind === 'video') {
          setSnapGuideTime(null);
          onMoveClip(dragState.clip.id, rawStart);
          return;
        }

        const snapped = snapEnabled
          ? snapClipMoveStart({
              desiredStart: rawStart,
              duration: dragState.clip.duration,
              targets,
              toleranceSeconds: snapToleranceSec,
            })
          : { start: rawStart, snappedTo: null };
        setSnapGuideTime(snapped.snappedTo);

        // Allow dragging vertically across stacked rows of text, image, or effects
        let targetTrackId: string | undefined;
        if (
          (dragState.trackKind === 'text' ||
            dragState.trackKind === 'image' ||
            dragState.trackKind === 'effects') &&
          trackRowsRef.current
        ) {
          const rowsRect = trackRowsRef.current.getBoundingClientRect();
          const relY = e.clientY - rowsRect.top;
          const rowIndex = Math.floor(relY / TRACK_HEIGHT);
          const hoveredTrack = project.tracks[rowIndex];
          if (hoveredTrack && hoveredTrack.kind === dragState.trackKind) {
            targetTrackId = hoveredTrack.id;
          }
        }

        onMoveClip(dragState.clip.id, snapped.start, targetTrackId);
      } else if (dragState.mode === 'resize-left') {
        if (dragState.trackKind === 'video') {
          // Incremental delta prevents compounding when normalizeRippleVideoTrack keeps clip.start packed
          const stepDelta = dxSec - prevResizeDxRef.current;
          prevResizeDxRef.current = dxSec;
          let liveStart = dragState.origStart;
          for (const tr of project.tracks) {
            if (tr.kind !== 'video') continue;
            const live = tr.clips.find((c) => c.id === dragState.clip.id);
            if (live) liveStart = live.start;
          }
          setSnapGuideTime(null);
          onResizeClip(dragState.clip.id, 'left', liveStart + stepDelta);
          return;
        }

        const rawTime = Math.max(0, dragState.origStart + dxSec);
        const snapped = snapEnabled
          ? snapTime(rawTime, targets, snapToleranceSec)
          : { time: rawTime, snappedTo: null };
        setSnapGuideTime(snapped.snappedTo);
        onResizeClip(dragState.clip.id, 'left', snapped.time);
      } else {
        const rawEnd = Math.max(0, dragState.origEnd + dxSec);
        const snapped = snapEnabled
          ? snapTime(rawEnd, targets, snapToleranceSec)
          : { time: rawEnd, snappedTo: null };
        setSnapGuideTime(snapped.snappedTo);
        onResizeClip(dragState.clip.id, 'right', snapped.time);
      }
    };

    const handleUp = () => {
      prevResizeDxRef.current = 0;
      setDragState(null);
      setSnapGuideTime(null);
      onCommitDragTransaction();
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
  }, [
    dragState,
    onCommitDragTransaction,
    onMoveClip,
    onResizeClip,
    playhead,
    project.tracks,
    snapEnabled,
    zoomPxPerSec,
  ]);

  const handleRulerPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    e.preventDefault();
    onPlayheadChange(timeFromClientX(e.clientX));
    setIsScrubbingPlayhead(true);
  };

  const handleWheelZoom = (e: WheelEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 12 : -12;
      onZoomChange(zoomPxPerSec + delta);
    }
  };

  const handleTrackDragOver = (e: DragEvent<HTMLDivElement>, track: TimelineTrack) => {
    if (disabled) return;
    if (e.dataTransfer.types.includes('application/x-maya-asset-id')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      if (dropHoverTrackId !== track.id) {
        setDropHoverTrackId(track.id);
      }
    }
  };

  const handleTrackDrop = (e: DragEvent<HTMLDivElement>, track: TimelineTrack) => {
    setDropHoverTrackId(null);
    if (disabled) return;
    const assetId = e.dataTransfer.getData('application/x-maya-asset-id');
    if (!assetId) return;
    e.preventDefault();
    e.stopPropagation();

    let dropTime = timeFromClientX(e.clientX);
    const snapToleranceSec = 10 / zoomPxPerSec;
    if (Math.abs(dropTime - playhead) <= snapToleranceSec) {
      dropTime = playhead;
    }
    onDropAssetOnTimeline(assetId, dropTime, track.id);
  };

  const renderTrackToggle = (track: TimelineTrack) => {
    const isAudioOrVideo = track.kind === 'video' || track.kind === 'audio';
    if (track.kind === 'audio') {
      return (
        <button
          type="button"
          onClick={() => onToggleTrackMute(track.id)}
          title={track.muted ? 'Unmute audio track' : 'Mute audio track'}
          aria-label={track.muted ? 'Unmute audio track' : 'Mute audio track'}
          className={`inline-flex h-6 w-6 items-center justify-center rounded transition-colors ${
            track.muted ? 'text-red-400' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          {track.muted ? (
            <VolumeX className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />
          )}
        </button>
      );
    }

    if (track.kind === 'video') {
      return (
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => onToggleTrackMute(track.id)}
            title={track.muted ? 'Unmute video audio' : 'Mute video audio'}
            aria-label={track.muted ? 'Unmute video audio' : 'Mute video audio'}
            className={`inline-flex h-6 w-6 items-center justify-center rounded transition-colors ${
              track.muted ? 'text-red-400' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {track.muted ? (
              <VolumeX className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />
            )}
          </button>
          <button
            type="button"
            onClick={() => onToggleTrackHide(track.id)}
            title={track.hidden ? 'Show video track' : 'Hide video track'}
            aria-label={track.hidden ? 'Show video track' : 'Hide video track'}
            className={`inline-flex h-6 w-6 items-center justify-center rounded transition-colors ${
              track.hidden ? 'text-red-400' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {track.hidden ? (
              <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <Eye className="h-3.5 w-3.5" aria-hidden="true" />
            )}
          </button>
        </div>
      );
    }

    if (!isAudioOrVideo) {
      return (
        <button
          type="button"
          onClick={() => onToggleTrackHide(track.id)}
          title={track.hidden ? 'Show track' : 'Hide track'}
          aria-label={track.hidden ? 'Show track' : 'Hide track'}
          className={`inline-flex h-6 w-6 items-center justify-center rounded transition-colors ${
            track.hidden ? 'text-red-400' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          {track.hidden ? (
            <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <Eye className="h-3.5 w-3.5" aria-hidden="true" />
          )}
        </button>
      );
    }

    return null;
  };

  return (
    <section
      aria-label="Timeline"
      onWheel={handleWheelZoom}
      className="flex h-[272px] shrink-0 flex-col border-t border-[#232A38] bg-[#131720] select-none"
    >
      {/* Timeline toolbar */}
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-[#232A38] bg-[#11141B] px-3">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={disabled || projectDuration <= 0}
            onClick={onSplitAtPlayhead}
            title="Split clip at playhead (S)"
            className="inline-flex h-7 items-center gap-1 rounded-lg border border-[#232A38] bg-[#131720] px-2.5 text-[11px] font-medium text-slate-200 hover:border-[#3A455C] disabled:opacity-40"
          >
            <Scissors className="h-3 w-3" aria-hidden="true" />
            <span>Split</span>
          </button>

          <button
            type="button"
            disabled={disabled || !selectedClipId}
            onClick={onDuplicateSelected}
            title="Duplicate selected clip (Ctrl/Cmd+D)"
            className="inline-flex h-7 items-center gap-1 rounded-lg border border-[#232A38] bg-[#131720] px-2.5 text-[11px] font-medium text-slate-200 hover:border-[#3A455C] disabled:opacity-40"
          >
            <Copy className="h-3 w-3" aria-hidden="true" />
            <span>Duplicate</span>
          </button>

          <button
            type="button"
            disabled={disabled || !selectedClipId}
            onClick={onDeleteSelected}
            title="Delete selected clip (Delete)"
            className="inline-flex h-7 items-center gap-1 rounded-lg border border-[#232A38] bg-[#131720] px-2.5 text-[11px] font-medium text-slate-200 hover:border-red-500/50 hover:text-red-200 disabled:opacity-40"
          >
            <Trash2 className="h-3 w-3" aria-hidden="true" />
            <span>Delete</span>
          </button>

          <div className="mx-1 h-4 w-px bg-[#232A38]" aria-hidden="true" />

          <button
            type="button"
            onClick={onToggleSnap}
            title="Toggle snapping to playhead and clip edges"
            className={`inline-flex h-7 items-center gap-1 rounded-lg border px-2.5 text-[11px] font-medium transition-colors ${
              snapEnabled
                ? 'border-blue-500 bg-blue-500/15 text-blue-200'
                : 'border-[#232A38] bg-[#131720] text-slate-400 hover:text-slate-200'
            }`}
          >
            <Magnet className="h-3 w-3" aria-hidden="true" />
            <span>Snap</span>
          </button>

          <button
            type="button"
            disabled={disabled}
            onClick={() => onAddTrackRow('effects')}
            title="Add stacked effect row"
            className="inline-flex h-7 items-center gap-1 rounded-lg border border-[#232A38] bg-[#131720] px-2 text-[11px] text-slate-300 hover:border-[#3A455C] disabled:opacity-40"
          >
            <Plus className="h-3 w-3" aria-hidden="true" />
            <span>Effect row</span>
          </button>

          <button
            type="button"
            disabled={disabled}
            onClick={() => onAddTrackRow('text')}
            title="Add stacked text row"
            className="inline-flex h-7 items-center gap-1 rounded-lg border border-[#232A38] bg-[#131720] px-2 text-[11px] text-slate-300 hover:border-[#3A455C] disabled:opacity-40"
          >
            <Plus className="h-3 w-3" aria-hidden="true" />
            <span>Text row</span>
          </button>

          <button
            type="button"
            disabled={disabled}
            onClick={() => onAddTrackRow('image')}
            title="Add stacked image overlay row"
            className="inline-flex h-7 items-center gap-1 rounded-lg border border-[#232A38] bg-[#131720] px-2 text-[11px] text-slate-300 hover:border-[#3A455C] disabled:opacity-40"
          >
            <Plus className="h-3 w-3" aria-hidden="true" />
            <span>Overlay row</span>
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onZoomChange(zoomPxPerSec - 15)}
            title="Zoom out (-)"
            aria-label="Zoom out"
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-[#232A38] bg-[#131720] text-slate-300 hover:border-[#3A455C]"
          >
            <ZoomOut className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <input
            type="range"
            aria-label="Timeline zoom"
            min={MIN_TIMELINE_ZOOM}
            max={MAX_TIMELINE_ZOOM}
            step={5}
            value={zoomPxPerSec}
            onChange={(e) => onZoomChange(Number(e.target.value))}
            className="h-1.5 w-24 cursor-pointer accent-blue-500"
          />
          <button
            type="button"
            onClick={() => onZoomChange(zoomPxPerSec + 15)}
            title="Zoom in (+)"
            aria-label="Zoom in"
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-[#232A38] bg-[#131720] text-slate-300 hover:border-[#3A455C]"
          >
            <ZoomIn className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Tracks + Scrollable Time Lanes */}
      <div className="flex min-h-0 flex-1 overflow-y-auto">
        {/* Track labels column */}
        <div
          style={{ width: HEADER_WIDTH }}
          className="shrink-0 border-r border-[#232A38] bg-[#11141B]"
        >
          <div className="flex h-7 items-center border-b border-[#232A38] px-3 text-[11px] font-medium text-slate-500">
            Tracks
          </div>
          {project.tracks.map((track) => (
            <div
              key={track.id}
              style={{ height: TRACK_HEIGHT }}
              className="flex items-center justify-between border-b border-[#232A38] px-2.5"
            >
              <div className="flex min-w-0 items-center gap-2">
                <TrackIcon kind={track.kind} />
                <span className="truncate text-xs font-medium text-slate-200">
                  {track.name}
                </span>
              </div>
              {renderTrackToggle(track)}
            </div>
          ))}
        </div>

        {/* Scrollable timeline canvas */}
        <div
          ref={scrollContainerRef}
          onClick={(e: MouseEvent<HTMLDivElement>) => {
            if (e.target === e.currentTarget) {
              onSelectClip(null);
              onSelectTransition(null);
            }
          }}
          className="relative flex-1 overflow-x-auto bg-[#0B0D11]"
        >
          <div style={{ width: canvasWidth }} className="relative min-h-full">
            {/* Time ruler */}
            <div
              onPointerDown={handleRulerPointerDown}
              className="relative h-7 cursor-pointer border-b border-[#232A38] bg-[#11141B]"
            >
              {ticks.map((t) => (
                <div
                  key={t}
                  style={{ left: t * zoomPxPerSec }}
                  className="pointer-events-none absolute top-0 bottom-0 flex flex-col justify-between"
                >
                  <span className="pl-1 font-mono text-[10px] text-slate-500 tabular-nums">
                    {t % 1 === 0 ? `${t}s` : `${t.toFixed(1)}s`}
                  </span>
                  <div className="h-1.5 w-px bg-[#2C3547]" />
                </div>
              ))}
            </div>

            {/* Track lanes */}
            <div ref={trackRowsRef} className="relative">
              {project.tracks.map((track) => {
                const isDimmed = track.hidden || track.muted;
                const isDropTarget = dropHoverTrackId === track.id;
                return (
                  <div
                    key={track.id}
                    style={{ height: TRACK_HEIGHT }}
                    onDragOver={(e) => handleTrackDragOver(e, track)}
                    onDragLeave={() => {
                      if (dropHoverTrackId === track.id) setDropHoverTrackId(null);
                    }}
                    onDrop={(e) => handleTrackDrop(e, track)}
                    onClick={(e) => {
                      if (e.target === e.currentTarget) {
                        onSelectClip(null);
                        onSelectTransition(null);
                      }
                    }}
                    className={`relative border-b border-[#232A38] transition-colors ${
                      isDimmed ? 'opacity-45' : ''
                    } ${isDropTarget ? 'bg-blue-500/10' : ''}`}
                  >
                    {track.clips.map((clip) => {
                      const leftPx = clip.start * zoomPxPerSec;
                      const widthPx = Math.max(16, clip.duration * zoomPxPerSec);
                      const isSelected = selectedClipId === clip.id;
                      const audioAsset =
                        clip.type === 'audio' ? assets.get(clip.assetId) : undefined;
                      const videoAsset =
                        clip.type === 'video' ? assets.get(clip.assetId) : undefined;
                      const isEffect = clip.type === 'effect';

                      return (
                        <div
                          key={clip.id}
                          style={{ left: leftPx, width: widthPx }}
                          onPointerDown={(e) => {
                            if (disabled) return;
                            e.stopPropagation();
                            onSelectClip(clip.id);
                            onBeginDragTransaction();
                            setDragState({
                              mode: 'move',
                              clip,
                              trackKind: track.kind,
                              startClientX: e.clientX,
                              origStart: clip.start,
                            });
                          }}
                          className={`group absolute top-1 bottom-1 flex cursor-grab items-center overflow-hidden rounded-lg border px-2 transition-colors active:cursor-grabbing ${
                            isEffect
                              ? isSelected
                                ? 'border-amber-400 bg-amber-500/25 text-white'
                                : 'border-amber-500/45 bg-amber-500/12 text-amber-100 hover:border-amber-400/80'
                              : isSelected
                                ? 'border-blue-500 bg-[#1B2A44] text-white'
                                : 'border-[#2E384D] bg-[#181E2B] text-slate-200 hover:border-[#475573]'
                          }`}
                        >
                          {/* Left resize edge */}
                          <div
                            onPointerDown={(e) => {
                              if (disabled) return;
                              e.stopPropagation();
                              prevResizeDxRef.current = 0;
                              onSelectClip(clip.id);
                              onBeginDragTransaction();
                              setDragState({
                                mode: 'resize-left',
                                clip,
                                trackKind: track.kind,
                                startClientX: e.clientX,
                                origStart: clip.start,
                                origEnd: clip.start + clip.duration,
                              });
                            }}
                            title="Drag left edge to trim"
                            className="absolute top-0 bottom-0 left-0 z-10 w-2 cursor-ew-resize hover:bg-blue-400/50"
                          />

                          {/* Clip content visualization */}
                          {clip.type === 'audio' ? (
                            <div className="pointer-events-none flex h-full w-full flex-col justify-center gap-0.5 overflow-hidden">
                              <span className="truncate text-[10px] leading-none font-medium">
                                {clip.name}
                              </span>
                              <div className="flex h-3 items-end gap-[2px] overflow-hidden opacity-75">
                                {(audioAsset && audioAsset.kind === 'audio'
                                  ? audioAsset.waveform
                                  : [0.4, 0.7, 0.5, 0.9, 0.6, 0.8, 0.3, 0.7, 0.5, 0.8]
                                ).map((amp, i) => (
                                  <div
                                    key={i}
                                    style={{ height: `${Math.round(amp * 100)}%` }}
                                    className="w-[3px] shrink-0 rounded-[1px] bg-blue-400/80"
                                  />
                                ))}
                              </div>
                            </div>
                          ) : clip.type === 'video' ? (
                            <div className="pointer-events-none flex min-w-0 flex-1 items-center gap-2">
                              {videoAsset && videoAsset.kind === 'video' && videoAsset.thumbnailUrl && widthPx > 56 && (
                                <img
                                  src={videoAsset.thumbnailUrl}
                                  alt=""
                                  className="h-6 w-9 shrink-0 rounded-sm object-cover opacity-85"
                                />
                              )}
                              <span className="min-w-0 flex-1 truncate text-[11px] font-medium">
                                {clip.name}
                              </span>
                              {widthPx > 120 && (
                                <span className="shrink-0 font-mono text-[10px] text-slate-400 tabular-nums">
                                  {formatTimecode(clip.sourceOffset)}–{formatTimecode(clip.sourceOffset + clip.duration * clip.speed)}
                                </span>
                              )}
                            </div>
                          ) : clip.type === 'text' ? (
                            <span className="pointer-events-none truncate text-[11px] font-medium">
                              {clip.text || 'Text'}
                            </span>
                          ) : clip.type === 'effect' ? (
                            <div className="pointer-events-none flex min-w-0 flex-1 items-center justify-between gap-1.5">
                              <span className="truncate text-[11px] font-medium">
                                {clip.name}
                              </span>
                              {widthPx > 64 && (
                                <span className="shrink-0 font-mono text-[10px] text-amber-200/80 tabular-nums">
                                  {clip.intensity}%
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="pointer-events-none truncate text-[11px] font-medium">
                              {clip.name}
                            </span>
                          )}

                          {/* Right resize edge */}
                          <div
                            onPointerDown={(e) => {
                              if (disabled) return;
                              e.stopPropagation();
                              onSelectClip(clip.id);
                              onBeginDragTransaction();
                              setDragState({
                                mode: 'resize-right',
                                clip,
                                trackKind: track.kind,
                                startClientX: e.clientX,
                                origStart: clip.start,
                                origEnd: clip.start + clip.duration,
                              });
                            }}
                            title="Drag right edge to trim"
                            className="absolute top-0 right-0 bottom-0 z-10 w-2 cursor-ew-resize hover:bg-blue-400/50"
                          />
                        </div>
                      );
                    })}

                    {/* Transition handles between adjacent Video clips */}
                    {track.kind === 'video' &&
                      track.clips.slice(0, -1).map((rawPrev, idx) => {
                        const rawNext = track.clips[idx + 1];
                        if (rawPrev.type !== 'video' || !rawNext || rawNext.type !== 'video') {
                          return null;
                        }
                        const effDur = getEffectiveTransitionDuration(rawPrev, rawNext);
                        const hasTransition =
                          Boolean(rawPrev.transitionOut && rawPrev.transitionOut.type !== 'none') &&
                          effDur > 0;
                        const cutCenterTime =
                          (rawPrev.start + rawPrev.duration + rawNext.start) / 2;
                        const isTrSelected = selectedTransitionClipId === rawPrev.id;
                        const trLabel =
                          hasTransition && rawPrev.transitionOut
                            ? `${VIDEO_TRANSITION_META[rawPrev.transitionOut.type].label} (${effDur.toFixed(1)}s)`
                            : 'Add transition at cut';

                        return (
                          <div key={`tr_${rawPrev.id}`}>
                            {hasTransition && (
                              <div
                                style={{
                                  left: rawNext.start * zoomPxPerSec,
                                  width: Math.max(4, effDur * zoomPxPerSec),
                                }}
                                className="pointer-events-none absolute top-1 bottom-1 z-10 rounded bg-blue-400/20 ring-1 ring-blue-400/50"
                              />
                            )}
                            <button
                              type="button"
                              disabled={disabled}
                              title={trLabel}
                              aria-label={trLabel}
                              onPointerDown={(e) => e.stopPropagation()}
                              onClick={(e) => {
                                e.stopPropagation();
                                onSelectTransition(rawPrev.id);
                              }}
                              style={{ left: cutCenterTime * zoomPxPerSec }}
                              className={`absolute top-1/2 z-20 flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded border transition-colors disabled:opacity-40 ${
                                isTrSelected
                                  ? 'border-white bg-blue-500 text-white shadow'
                                  : hasTransition
                                    ? 'border-blue-400 bg-[#1B2A44] text-blue-200 hover:bg-blue-600 hover:text-white'
                                    : 'border-[#3A455C] bg-[#11141B]/90 text-slate-400 hover:border-blue-400 hover:text-white'
                              }`}
                            >
                              <ArrowLeftRight className="h-2.5 w-2.5" aria-hidden="true" />
                            </button>
                          </div>
                        );
                      })}
                  </div>
                );
              })}
            </div>

            {/* Snap vertical guide */}
            {snapGuideTime !== null && (
              <div
                style={{ left: snapGuideTime * zoomPxPerSec }}
                className="pointer-events-none absolute top-7 bottom-0 z-20 w-px bg-amber-400"
              />
            )}

            {/* Full-height Playhead */}
            <div
              style={{ left: playhead * zoomPxPerSec }}
              className="pointer-events-none absolute top-0 bottom-0 z-30 w-px bg-blue-500"
            >
              <div
                onPointerDown={handleRulerPointerDown}
                className="pointer-events-auto -ml-1.5 h-3 w-3 cursor-ew-resize rounded-b bg-blue-500"
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
