import {
  ChevronLeft,
  ChevronRight,
  Film,
  Pause,
  Play,
  Scissors,
  Upload,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type PointerEvent } from 'react';
import {
  evaluateTextAnimationPreview,
  formatTimecode,
  getEffectiveTransitionDuration,
  getProjectDuration,
  resolveProjectCanvasDimensions,
  VIDEO_EFFECT_META_MAP,
  type ClipPropsPatch,
  type CropAspectRatio,
  type EffectClip,
  type ImageClip,
  type MediaAsset,
  type ProjectState,
  type TextClip,
  type VideoClip,
  type VideoTransitionType,
} from '../lib/editor';

interface PreviewCanvasProps {
  project: ProjectState;
  assets: Map<string, MediaAsset>;
  playhead: number;
  selectedClipId: string | null;
  isPlaying: boolean;
  isPreviewMuted: boolean;
  isBusy: boolean;
  onTogglePlay: () => void;
  onPlayheadChange: (time: number) => void;
  onStepFrame: (deltaSeconds: number) => void;
  onTogglePreviewMuted: () => void;
  onSelectClip: (clipId: string | null) => void;
  onBeginDragTransaction: () => void;
  onUpdateClipProps: (clipId: string, patch: ClipPropsPatch) => void;
  onCommitDragTransaction: () => void;
  onSplitAtPlayhead: () => void;
  onImportVideos: (files: File[]) => void;
}

function getCssColorFilter(clip: VideoClip | null): string | undefined {
  if (!clip) return undefined;
  const { brightness, contrast, saturation, preset } = clip.colorFilter;
  const filters: string[] = [];
  if (Math.abs(brightness) > 1e-6) {
    filters.push(`brightness(${(1 + brightness).toFixed(2)})`);
  }
  if (Math.abs(contrast - 1) > 1e-6) {
    filters.push(`contrast(${contrast.toFixed(2)})`);
  }
  if (Math.abs(saturation - 1) > 1e-6) {
    filters.push(`saturate(${saturation.toFixed(2)})`);
  }
  if (preset === 'bw') {
    filters.push('grayscale(1)');
  } else if (preset === 'warm') {
    filters.push('sepia(0.28) saturate(1.1)');
  } else if (preset === 'cool') {
    filters.push('hue-rotate(15deg) saturate(1.05)');
  }
  return filters.length > 0 ? filters.join(' ') : undefined;
}

function getCropGuideClass(cropAspect: CropAspectRatio): string | null {
  switch (cropAspect) {
    case '9:16':
      return 'aspect-[9/16] h-full max-h-full w-auto';
    case '1:1':
      return 'aspect-square h-full max-h-full w-auto';
    case '16:9':
      return 'aspect-video w-full max-w-full h-auto';
    default:
      return null;
  }
}

export function PreviewCanvas({
  project,
  assets,
  playhead,
  selectedClipId,
  isPlaying,
  isPreviewMuted,
  isBusy,
  onTogglePlay,
  onPlayheadChange,
  onStepFrame,
  onTogglePreviewMuted,
  onSelectClip,
  onBeginDragTransaction,
  onUpdateClipProps,
  onCommitDragTransaction,
  onSplitAtPlayhead,
  onImportVideos,
}: PreviewCanvasProps) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const videoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());
  const audioRefs = useRef<Map<string, HTMLAudioElement>>(new Map());
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDraggingDrop, setIsDraggingDrop] = useState(false);

  const [dragOverlay, setDragOverlay] = useState<{
    clipId: string;
    startClientX: number;
    startClientY: number;
    origX: number;
    origY: number;
  } | null>(null);

  const projectDuration = useMemo(() => getProjectDuration(project), [project]);
  const videoTrack = project.tracks.find((t) => t.kind === 'video');

  const videoAssets = useMemo(() => {
    const out: Array<Extract<MediaAsset, { kind: 'video' }>> = [];
    for (const asset of assets.values()) {
      if (asset.kind === 'video') out.push(asset);
    }
    return out;
  }, [assets]);

  const videoClips = useMemo<VideoClip[]>(() => {
    if (!videoTrack) return [];
    return videoTrack.clips.filter((c): c is VideoClip => c.type === 'video');
  }, [videoTrack]);

  const activeTransitionOverlap = useMemo<{
    prevClip: VideoClip;
    nextClip: VideoClip;
    type: VideoTransitionType;
    progress: number;
  } | null>(() => {
    if (!videoTrack || videoTrack.hidden || videoClips.length < 2) return null;
    for (let i = 0; i < videoClips.length - 1; i++) {
      const prevClip = videoClips[i];
      const nextClip = videoClips[i + 1];
      const effDur = getEffectiveTransitionDuration(prevClip, nextClip);
      if (effDur <= 0 || !prevClip.transitionOut) continue;
      const overlapStart = nextClip.start;
      const overlapEnd = prevClip.start + prevClip.duration;
      if (playhead >= overlapStart && playhead <= overlapEnd && overlapEnd > overlapStart) {
        const progress = Math.max(0, Math.min(1, (playhead - overlapStart) / effDur));
        return {
          prevClip,
          nextClip,
          type: prevClip.transitionOut.type,
          progress,
        };
      }
    }
    return null;
  }, [playhead, videoClips, videoTrack]);

  const activeVideoClip = useMemo<VideoClip | null>(() => {
    if (!videoTrack || videoTrack.hidden || videoClips.length === 0) return null;
    if (activeTransitionOverlap) {
      return activeTransitionOverlap.progress < 0.5
        ? activeTransitionOverlap.prevClip
        : activeTransitionOverlap.nextClip;
    }
    for (let i = 0; i < videoClips.length; i++) {
      const c = videoClips[i];
      const isLast = i === videoClips.length - 1;
      if (playhead >= c.start - 0.002 && (isLast ? playhead <= c.start + c.duration + 0.02 : playhead < c.start + c.duration)) {
        return c;
      }
    }
    return null;
  }, [activeTransitionOverlap, playhead, videoClips, videoTrack]);

  const canvasDims = useMemo(
    () =>
      resolveProjectCanvasDimensions({
        project,
        assets,
        videoClips,
      }),
    [assets, project, videoClips]
  );

  const stageAspectRatio = `${canvasDims.width} / ${canvasDims.height}`;
  const canvasFit = project.exportSettings.canvasFit ?? 'fit';

  const activeEffectClips = useMemo<EffectClip[]>(() => {
    const list: EffectClip[] = [];
    for (const t of project.tracks) {
      if (t.kind !== 'effects' || t.hidden) continue;
      for (const c of t.clips) {
        if (
          c.type === 'effect' &&
          c.intensity > 0 &&
          playhead >= c.start &&
          playhead <= c.start + c.duration
        ) {
          list.push(c);
        }
      }
    }
    return list;
  }, [playhead, project.tracks]);

  const activeImageClips = useMemo<ImageClip[]>(() => {
    const list: ImageClip[] = [];
    for (const t of project.tracks) {
      if (t.kind !== 'image' || t.hidden) continue;
      for (const c of t.clips) {
        if (c.type === 'image' && playhead >= c.start && playhead <= c.start + c.duration) {
          list.push(c);
        }
      }
    }
    return list;
  }, [playhead, project.tracks]);

  const activeTextClips = useMemo<TextClip[]>(() => {
    const list: TextClip[] = [];
    for (const t of project.tracks) {
      if ((t.kind !== 'text' && t.kind !== 'captions') || t.hidden) continue;
      for (const c of t.clips) {
        if (
          c.type === 'text' &&
          c.text.trim().length > 0 &&
          playhead >= c.start &&
          playhead <= c.start + c.duration
        ) {
          list.push(c);
        }
      }
    }
    return list;
  }, [playhead, project.tracks]);

  const audioTrackClips = useMemo(() => {
    const out: Array<{
      clipId: string;
      asset: MediaAsset;
      start: number;
      duration: number;
      sourceOffset: number;
      loop: boolean;
      muted: boolean;
      volumePercent: number;
      trackMuted: boolean;
    }> = [];
    for (const t of project.tracks) {
      if (t.kind !== 'audio') continue;
      for (const c of t.clips) {
        if (c.type !== 'audio') continue;
        const asset = assets.get(c.assetId);
        if (!asset || asset.kind !== 'audio') continue;
        out.push({
          clipId: c.id,
          asset,
          start: c.start,
          duration: c.duration,
          sourceOffset: c.sourceOffset,
          loop: c.loop,
          muted: c.muted,
          volumePercent: c.volumePercent,
          trackMuted: t.muted,
        });
      }
    }
    return out;
  }, [assets, project.tracks]);

  // Playback loop via requestAnimationFrame running in continuous project time
  useEffect(() => {
    if (!isPlaying) return;
    let rafId = 0;
    let lastTs = performance.now();
    let current = playhead;

    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - lastTs) / 1000);
      lastTs = now;
      current += dt;
      if (current >= projectDuration && projectDuration > 0) {
        onPlayheadChange(projectDuration);
        onTogglePlay();
        return;
      }
      onPlayheadChange(current);
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying, onPlayheadChange, onTogglePlay, projectDuration]);

  // Sync per-asset <video> elements so cuts and cross-asset transitions switch cleanly
  useEffect(() => {
    for (const [assetId, video] of videoRefs.current.entries()) {
      let matchingClip: VideoClip | null = null;
      if (activeTransitionOverlap) {
        if (activeTransitionOverlap.prevClip.assetId === assetId) {
          matchingClip = activeTransitionOverlap.prevClip;
        }
        if (activeTransitionOverlap.nextClip.assetId === assetId) {
          matchingClip =
            activeTransitionOverlap.prevClip.assetId === assetId &&
            activeTransitionOverlap.progress < 0.5
              ? activeTransitionOverlap.prevClip
              : activeTransitionOverlap.nextClip;
        }
      } else if (activeVideoClip?.assetId === assetId) {
        matchingClip = activeVideoClip;
      }

      if (!matchingClip) {
        if (!video.paused) video.pause();
        continue;
      }

      const expectedTime = Math.max(
        0,
        Math.min(
          matchingClip.sourceDuration,
          matchingClip.sourceOffset + (playhead - matchingClip.start) * matchingClip.speed
        )
      );

      if (Math.abs(video.currentTime - expectedTime) > (isPlaying ? 0.16 : 0.03)) {
        video.currentTime = expectedTime;
      }
      video.playbackRate = matchingClip.speed;
      video.muted =
        isPreviewMuted ||
        Boolean(videoTrack?.muted) ||
        matchingClip.muted ||
        matchingClip.volumePercent === 0;
      video.volume = Math.min(1, Math.max(0, matchingClip.volumePercent / 100));

      if (isPlaying && video.paused) {
        void video.play().catch(() => {});
      } else if (!isPlaying && !video.paused) {
        video.pause();
      }
    }
  }, [
    activeTransitionOverlap,
    activeVideoClip,
    isPlaying,
    isPreviewMuted,
    playhead,
    videoAssets.length,
    videoTrack?.muted,
  ]);

  // Sync Audio track <audio> elements during playback
  useEffect(() => {
    for (const item of audioTrackClips) {
      const el = audioRefs.current.get(item.clipId);
      if (!el) continue;

      const inWindow =
        isPlaying &&
        !item.trackMuted &&
        !item.muted &&
        !isPreviewMuted &&
        playhead >= item.start &&
        playhead <= item.start + item.duration;

      if (!inWindow) {
        if (!el.paused) el.pause();
        continue;
      }

      const rawOffset = item.sourceOffset + (playhead - item.start);
      const dur = item.asset.kind === 'audio' && item.asset.duration > 0 ? item.asset.duration : 10;
      const targetAudioTime = item.loop ? rawOffset % dur : Math.min(dur, rawOffset);

      if (Math.abs(el.currentTime - targetAudioTime) > 0.18) {
        el.currentTime = targetAudioTime;
      }
      el.volume = Math.min(1, Math.max(0, item.volumePercent / 100));
      if (el.paused) {
        void el.play().catch(() => {});
      }
    }
  }, [audioTrackClips, isPlaying, isPreviewMuted, playhead]);

  // Pointer drag for Text & Image clips directly on the preview frame
  useEffect(() => {
    if (!dragOverlay) return;

    const handleMove = (e: globalThis.PointerEvent) => {
      const stage = stageRef.current;
      if (!stage) return;
      const rect = stage.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      const dxPct = ((e.clientX - dragOverlay.startClientX) / rect.width) * 100;
      const dyPct = ((e.clientY - dragOverlay.startClientY) / rect.height) * 100;
      onUpdateClipProps(dragOverlay.clipId, {
        xPercent: Math.max(2, Math.min(98, dragOverlay.origX + dxPct)),
        yPercent: Math.max(2, Math.min(98, dragOverlay.origY + dyPct)),
      });
    };

    const handleUp = () => {
      setDragOverlay(null);
      onCommitDragTransaction();
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
  }, [dragOverlay, onCommitDragTransaction, onUpdateClipProps]);

  const startOverlayDrag = (
    e: PointerEvent<HTMLDivElement>,
    clipId: string,
    origX: number,
    origY: number
  ) => {
    if (isBusy) return;
    e.stopPropagation();
    e.preventDefault();
    onSelectClip(clipId);
    onBeginDragTransaction();
    setDragOverlay({
      clipId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      origX,
      origY,
    });
  };

  const handleStageDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDraggingDrop(false);
    const files = e.dataTransfer.files ? Array.from(e.dataTransfer.files) : [];
    if (files.length > 0) onImportVideos(files);
  };

  const cropGuideClass = activeVideoClip ? getCropGuideClass(activeVideoClip.cropAspect) : null;
  const isSideways =
    activeVideoClip?.rotationDegrees === 90 || activeVideoClip?.rotationDegrees === 270;

  let hasApproximatePreview = Boolean(activeTransitionOverlap);
  let mirrorCount = 0;
  let vignetteAlpha = 0;
  let flashAlpha = 0;
  const effectFilters: string[] = [];

  for (const ef of activeEffectClips) {
    const meta = VIDEO_EFFECT_META_MAP[ef.effectType];
    if (!meta.hasExactCssPreview) {
      hasApproximatePreview = true;
    }
    const k = Math.max(0, Math.min(1, ef.intensity / 100));
    switch (ef.effectType) {
      case 'blur':
        effectFilters.push(`blur(${(k * 14).toFixed(1)}px)`);
        break;
      case 'bw':
        effectFilters.push(`grayscale(${k.toFixed(2)})`);
        break;
      case 'sepia':
        effectFilters.push(`sepia(${k.toFixed(2)})`);
        break;
      case 'invert':
        effectFilters.push(`invert(${k.toFixed(2)})`);
        break;
      case 'mirror':
        mirrorCount += 1;
        break;
      case 'vignette':
        vignetteAlpha = Math.max(vignetteAlpha, 0.25 + k * 0.65);
        break;
      case 'flash': {
        const half = Math.max(0.001, ef.duration / 2);
        const rel = playhead - ef.start;
        const tri = rel <= half ? rel / half : (ef.duration - rel) / half;
        flashAlpha = Math.max(flashAlpha, Math.max(0, Math.min(1, tri)) * k);
        break;
      }
      default:
        break;
    }
  }

  const combinedFlip =
    (activeVideoClip?.flipHorizontal ? -1 : 1) * (mirrorCount % 2 === 1 ? -1 : 1);
  const videoTransform = activeVideoClip
    ? `rotate(${activeVideoClip.rotationDegrees}deg) scaleX(${combinedFlip})${
        isSideways ? ' scale(0.5625)' : ''
      }`
    : mirrorCount % 2 === 1
      ? 'scaleX(-1)'
      : undefined;

  const baseFilter = getCssColorFilter(activeVideoClip);
  const combinedFilterParts = [baseFilter, ...effectFilters].filter(Boolean);
  const videoCssFilter =
    combinedFilterParts.length > 0 ? combinedFilterParts.join(' ') : undefined;

  const hasPlayableContent = videoAssets.length > 0 || projectDuration > 0;

  return (
    <section
      aria-label="Preview stage"
      className="flex min-w-0 flex-1 flex-col bg-[#0B0D11]"
    >
      {/* Hidden audio elements for timeline preview audio tracks */}
      {audioTrackClips.map((item) => (
        <audio
          key={item.clipId}
          ref={(el) => {
            if (el) audioRefs.current.set(item.clipId, el);
            else audioRefs.current.delete(item.clipId);
          }}
          src={item.asset.objectUrl}
          preload="auto"
          className="hidden"
        />
      ))}

      {/* Video canvas viewport */}
      <div className="flex min-h-0 flex-1 items-center justify-center p-4">
        {videoAssets.length === 0 && projectDuration <= 0 ? (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDraggingDrop(true);
            }}
            onDragLeave={() => setIsDraggingDrop(false)}
            onDrop={handleStageDrop}
            className={`flex aspect-video w-full max-w-[760px] flex-col items-center justify-center rounded-lg border border-dashed bg-[#131720] p-8 text-center transition-colors ${
              isDraggingDrop ? 'border-blue-500 bg-blue-500/10' : 'border-[#232A38]'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".mp4,.mov,video/mp4,video/quicktime"
              onChange={(e) => {
                const files = e.target.files ? Array.from(e.target.files) : [];
                e.target.value = '';
                if (files.length > 0) onImportVideos(files);
              }}
              className="sr-only"
            />
            <Film className="mb-3 h-7 w-7 text-slate-400" aria-hidden="true" />
            <h1 className="text-base font-semibold text-slate-100">
              Open videos to start editing
            </h1>
            <p className="mt-1.5 max-w-sm text-xs text-slate-400">
              Drop one or more MP4 or MOV files here (max 200 MB each, 400 MB total). All processing runs locally in your browser.
            </p>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="mt-4 inline-flex h-9 items-center gap-2 rounded-lg bg-blue-600 px-4 text-xs font-semibold text-white transition-colors hover:bg-blue-500"
            >
              <Upload className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Import Video</span>
            </button>
          </div>
        ) : (
          <div
            ref={stageRef}
            onClick={() => onSelectClip(null)}
            style={{ aspectRatio: stageAspectRatio }}
            className="relative flex h-full max-h-full max-w-full items-center justify-center overflow-hidden rounded-lg border border-[#232A38] bg-black"
          >
            {/* Render one <video> element per imported video asset for seamless clip cuts and transitions */}
            {videoAssets.map((asset) => {
              let style: CSSProperties = {
                opacity: 0,
                pointerEvents: 'none',
              };

              if (activeTransitionOverlap) {
                const { prevClip, nextClip, type, progress } = activeTransitionOverlap;
                const isPrev = prevClip.assetId === asset.id;
                const isNext = nextClip.assetId === asset.id;

                if (isPrev && isNext) {
                  // Same-asset cut approximation
                  const dipOpacity =
                    type === 'fade' || type === 'dissolve'
                      ? Math.max(0.25, 1 - Math.sin(progress * Math.PI) * 0.65)
                      : 1;
                  style = {
                    transform: videoTransform,
                    filter: videoCssFilter,
                    opacity: dipOpacity,
                    pointerEvents: 'auto',
                  };
                } else if (isPrev) {
                  let extraTransform = '';
                  if (type === 'slide-left') {
                    extraTransform = ` translateX(${(-progress * 100).toFixed(2)}%)`;
                  } else if (type === 'slide-right') {
                    extraTransform = ` translateX(${(progress * 100).toFixed(2)}%)`;
                  }
                  style = {
                    transform: `${videoTransform ?? ''}${extraTransform}`.trim() || undefined,
                    filter: videoCssFilter,
                    opacity: type === 'fade' || type === 'dissolve' ? 1 - progress : 1,
                    zIndex: 1,
                    pointerEvents: 'auto',
                  };
                } else if (isNext) {
                  let clipPath: string | undefined;
                  let extraTransform = '';
                  let opacity = 1;
                  if (type === 'fade' || type === 'dissolve') {
                    opacity = progress;
                  } else if (type === 'wipe-left') {
                    clipPath = `inset(0 0 0 ${((1 - progress) * 100).toFixed(2)}%)`;
                  } else if (type === 'wipe-right') {
                    clipPath = `inset(0 ${((1 - progress) * 100).toFixed(2)}% 0 0)`;
                  } else if (type === 'slide-left') {
                    extraTransform = ` translateX(${((1 - progress) * 100).toFixed(2)}%)`;
                  } else if (type === 'slide-right') {
                    extraTransform = ` translateX(${(-(1 - progress) * 100).toFixed(2)}%)`;
                  }
                  style = {
                    transform: `${videoTransform ?? ''}${extraTransform}`.trim() || undefined,
                    filter: videoCssFilter,
                    opacity,
                    clipPath,
                    zIndex: 2,
                    pointerEvents: 'auto',
                  };
                }
              } else if (activeVideoClip?.assetId === asset.id) {
                style = {
                  transform: videoTransform,
                  filter: videoCssFilter,
                  opacity: 1,
                  pointerEvents: 'auto',
                };
              }

              return (
                <video
                  key={asset.id}
                  ref={(el) => {
                    if (el) videoRefs.current.set(asset.id, el);
                    else videoRefs.current.delete(asset.id);
                  }}
                  src={asset.objectUrl}
                  playsInline
                  preload="auto"
                  onClick={(e) => {
                    e.stopPropagation();
                    onTogglePlay();
                  }}
                  style={style}
                  className={`absolute inset-0 h-full w-full cursor-pointer ${
                    canvasFit === 'fill' ? 'object-cover' : 'object-contain'
                  }`}
                />
              );
            })}

            {/* Vignette & Flash VFX overlays */}
            {vignetteAlpha > 0 && (
              <div
                className="pointer-events-none absolute inset-0 z-10"
                style={{
                  background: `radial-gradient(circle, transparent 42%, rgba(0,0,0,${vignetteAlpha.toFixed(
                    2
                  )}) 100%)`,
                }}
              />
            )}
            {flashAlpha > 0.01 && (
              <div
                className="pointer-events-none absolute inset-0 z-10 bg-white"
                style={{ opacity: flashAlpha }}
              />
            )}

            {/* Crop aspect guide */}
            {cropGuideClass && (
              <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
                <div
                  className={`${cropGuideClass} border border-dashed border-blue-400/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]`}
                />
              </div>
            )}

            {/* Draggable Image Overlays */}
            {activeImageClips.map((img) => {
              const asset = assets.get(img.assetId);
              if (!asset || asset.kind !== 'image') return null;
              const isSelected = selectedClipId === img.id;

              return (
                <div
                  key={img.id}
                  role="button"
                  tabIndex={0}
                  onPointerDown={(e) => startOverlayDrag(e, img.id, img.xPercent, img.yPercent)}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectClip(img.id);
                  }}
                  style={{
                    left: `${img.xPercent}%`,
                    top: `${img.yPercent}%`,
                    width: `${img.sizePercent}%`,
                    opacity: img.opacityPercent / 100,
                    transform: `translate(-${img.xPercent}%, -${img.yPercent}%)`,
                  }}
                  title="Drag to move image overlay"
                  className={`absolute cursor-move rounded select-none ${
                    isSelected ? 'ring-2 ring-blue-500' : 'hover:ring-1 hover:ring-blue-400/60'
                  }`}
                >
                  <img
                    src={asset.objectUrl}
                    alt={img.name}
                    draggable={false}
                    className="h-auto w-full object-contain"
                  />
                </div>
              );
            })}

            {/* Draggable Text & Caption Overlays */}
            {activeTextClips.map((txt) => {
              const isSelected = selectedClipId === txt.id;
              const sizeClass =
                txt.size === 'small'
                  ? 'text-sm'
                  : txt.size === 'medium'
                    ? 'text-lg'
                    : 'text-2xl';
              const colorClass =
                txt.color === 'yellow'
                  ? 'text-yellow-300'
                  : txt.color === 'black'
                    ? 'text-black'
                    : 'text-white';
              const boxClass = txt.backgroundBox
                ? txt.color === 'black'
                  ? 'bg-white/85 px-2.5 py-1 rounded'
                  : 'bg-black/75 px-2.5 py-1 rounded'
                : txt.color === 'black'
                  ? '[text-shadow:0_0_3px_rgba(255,255,255,0.9)]'
                  : '[text-shadow:0_1px_4px_rgba(0,0,0,0.85)]';
              const translateX =
                txt.align === 'left' ? '0%' : txt.align === 'right' ? '-100%' : '-50%';
              const anim = evaluateTextAnimationPreview(txt, playhead);

              return (
                <div
                  key={txt.id}
                  className="pointer-events-none absolute inset-0 z-20"
                  style={{
                    transform: `translate(${anim.offsetXPct.toFixed(3)}%, ${anim.offsetYPct.toFixed(
                      3
                    )}%)`,
                  }}
                >
                  <div
                    role="button"
                    tabIndex={0}
                    onPointerDown={(e) => startOverlayDrag(e, txt.id, txt.xPercent, txt.yPercent)}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectClip(txt.id);
                    }}
                    style={{
                      left: `${txt.xPercent}%`,
                      top: `${txt.yPercent}%`,
                      opacity: anim.opacity,
                      transform: `translate(${translateX}, -50%) scale(${anim.scale.toFixed(3)})`,
                      textAlign: txt.align,
                    }}
                    title="Drag to move text on preview"
                    className={`pointer-events-auto absolute max-w-[85%] cursor-move leading-snug font-semibold whitespace-pre-wrap select-none ${sizeClass} ${colorClass} ${boxClass} ${
                      isSelected ? 'ring-2 ring-blue-500 ring-offset-2 ring-offset-black/40' : ''
                    }`}
                  >
                    {txt.text}
                  </div>
                </div>
              );
            })}

            {hasApproximatePreview && (
              <div className="pointer-events-none absolute top-2.5 right-2.5 z-30 rounded border border-amber-400/40 bg-black/75 px-2 py-0.5 text-[10px] font-medium text-amber-200">
                Approximate preview · applied on export
              </div>
            )}
          </div>
        )}
      </div>

      {/* Transport bar */}
      <div className="flex h-11 shrink-0 items-center justify-between border-t border-[#232A38] bg-[#11141B] px-4">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={!hasPlayableContent}
            onClick={() => onStepFrame(-1 / 30)}
            title="Previous frame (Left arrow · Shift = 1s)"
            aria-label="Previous frame"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#232A38] bg-[#131720] text-slate-300 hover:border-[#3A455C] disabled:opacity-40"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </button>

          <button
            type="button"
            disabled={!hasPlayableContent}
            onClick={onTogglePlay}
            title="Play / Pause (Space)"
            aria-label={isPlaying ? 'Pause' : 'Play'}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#1D2433] px-3 text-xs font-semibold text-white hover:bg-[#263044] disabled:opacity-40"
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
            disabled={!hasPlayableContent}
            onClick={() => onStepFrame(1 / 30)}
            title="Next frame (Right arrow · Shift = 1s)"
            aria-label="Next frame"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#232A38] bg-[#131720] text-slate-300 hover:border-[#3A455C] disabled:opacity-40"
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>

          <button
            type="button"
            disabled={isBusy || projectDuration <= 0}
            onClick={onSplitAtPlayhead}
            title="Split clip at playhead (S)"
            className="ml-2 inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#232A38] bg-[#131720] px-2.5 text-xs font-medium text-slate-200 hover:border-[#3A455C] disabled:opacity-40"
          >
            <Scissors className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Split</span>
          </button>
        </div>

        <div className="flex items-center gap-3">
          <div className="font-mono text-xs text-slate-200 tabular-nums">
            <span>{formatTimecode(playhead)}</span>
            <span className="mx-1.5 text-slate-600">/</span>
            <span className="text-slate-400">{formatTimecode(projectDuration)}</span>
          </div>

          <button
            type="button"
            onClick={onTogglePreviewMuted}
            title={isPreviewMuted ? 'Unmute preview' : 'Mute preview'}
            aria-label={isPreviewMuted ? 'Unmute preview' : 'Mute preview'}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#232A38] bg-[#131720] text-slate-300 hover:border-[#3A455C]"
          >
            {isPreviewMuted ? (
              <VolumeX className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>
    </section>
  );
}
