import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowLeftRight,
  FlipHorizontal2,
  Info,
  RotateCcw,
  RotateCw,
  Trash2,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {
  ALLOWED_COLOR_PRESETS,
  ALLOWED_CROP_ASPECTS,
  ALLOWED_OVERLAY_COLORS,
  ALLOWED_OVERLAY_SIZES,
  ALLOWED_SPEEDS,
  ALLOWED_TEXT_ANIMATIONS,
  ALLOWED_VIDEO_TRANSITIONS,
  createDefaultColorFilter,
  DEFAULT_TRANSITION_DURATION_SECONDS,
  isSlideTextAnimation,
  MAX_ADDED_AUDIO_FADE_SECONDS,
  MAX_FADE_SECONDS,
  MAX_IMAGE_SIZE_PERCENT,
  MAX_TEXT_ANIMATION_SECONDS,
  MAX_TEXT_CLIP_LENGTH,
  MAX_TRANSITION_DURATION_SECONDS,
  MIN_CLIP_DURATION_SECONDS,
  MIN_IMAGE_SIZE_PERCENT,
  MIN_TEXT_ANIMATION_SECONDS,
  MIN_TRANSITION_DURATION_SECONDS,
  resolveTextClipAnimationConfig,
  TEXT_ANIMATION_LABELS,
  VIDEO_EFFECT_CATALOG,
  VIDEO_EFFECT_META_MAP,
  VIDEO_TRANSITION_META,
  type ClipPropsPatch,
  type ColorFilterPreset,
  type CropAspectRatio,
  type PlaybackSpeed,
  type RotationDegrees,
  type TextAnimationType,
  type TextClipAlign,
  type TextOverlayColor,
  type TextOverlaySize,
  type TimelineClip,
  type VideoClip,
  type VideoEffectType,
  type VideoTransition,
  type VideoTransitionType,
} from '../lib/editor';

export interface SelectedTransitionContext {
  clip: VideoClip;
  nextClip: VideoClip;
  effectiveDuration: number;
}

interface InspectorPanelProps {
  selectedClip: TimelineClip | null;
  selectedTransition: SelectedTransitionContext | null;
  hasCaptions: boolean;
  onUpdateClip: (clipId: string, patch: ClipPropsPatch) => void;
  onDeleteClip: (clipId: string) => void;
  onSetVideoTransition: (clipId: string, transition: VideoTransition | undefined) => void;
  onApplyAnimationToAllCaptions: (config: {
    animInType: TextAnimationType;
    animInDuration: number;
    animOutType: TextAnimationType;
    animOutDuration: number;
    fadeWithSlide: boolean;
  }) => void;
  disabled: boolean;
}

const CROP_LABELS: Record<CropAspectRatio, string> = {
  original: 'Orig',
  '9:16': '9:16',
  '1:1': '1:1',
  '16:9': '16:9',
};

const COLOR_PRESET_LABELS: Record<ColorFilterPreset, string> = {
  none: 'None',
  bw: 'B&W',
  warm: 'Warm',
  cool: 'Cool',
};

export function InspectorPanel({
  selectedClip,
  selectedTransition,
  hasCaptions,
  onUpdateClip,
  onDeleteClip,
  onSetVideoTransition,
  onApplyAnimationToAllCaptions,
  disabled,
}: InspectorPanelProps) {
  const activeTransitionType: VideoTransitionType =
    selectedTransition?.clip.transitionOut?.type ?? 'none';
  const activeTransitionDuration =
    selectedTransition?.clip.transitionOut?.duration ?? DEFAULT_TRANSITION_DURATION_SECONDS;

  return (
    <aside className="flex w-[296px] shrink-0 flex-col border-l border-[#232A38] bg-[#131720]">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-[#232A38] px-4">
        <span className="text-xs font-semibold text-slate-200">
          {selectedTransition
            ? 'Cut Transition'
            : selectedClip
              ? `${selectedClip.type.charAt(0).toUpperCase() + selectedClip.type.slice(1)} Clip`
              : 'Inspector'}
        </span>
        {selectedClip && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onDeleteClip(selectedClip.id)}
            title="Delete selected clip (Del)"
            aria-label="Delete selected clip"
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-[#1D2433] hover:text-red-300 disabled:opacity-40"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
        {!selectedClip && selectedTransition && activeTransitionType !== 'none' && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onSetVideoTransition(selectedTransition.clip.id, undefined)}
            title="Remove transition"
            aria-label="Remove transition"
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-[#1D2433] hover:text-red-300 disabled:opacity-40"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
      </div>

      {selectedTransition ? (
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
          <div className="flex items-center gap-2 rounded-lg border border-[#232A38] bg-[#0B0D11] px-3 py-2 text-xs text-slate-300">
            <ArrowLeftRight className="h-3.5 w-3.5 shrink-0 text-blue-400" aria-hidden="true" />
            <span className="min-w-0 truncate">
              {selectedTransition.clip.name} → {selectedTransition.nextClip.name}
            </span>
          </div>

          <div>
            <span className="mb-1.5 block text-[11px] font-medium text-slate-300">
              Transition Type
            </span>
            <div className="grid grid-cols-2 gap-1.5">
              {ALLOWED_VIDEO_TRANSITIONS.map((type) => (
                <button
                  key={type}
                  type="button"
                  disabled={disabled}
                  onClick={() =>
                    onSetVideoTransition(
                      selectedTransition.clip.id,
                      type === 'none'
                        ? undefined
                        : { type, duration: activeTransitionDuration }
                    )
                  }
                  className={`h-8 rounded-lg border px-2 text-xs font-medium transition-colors ${
                    activeTransitionType === type
                      ? 'border-blue-500 bg-blue-500/15 text-white'
                      : 'border-[#232A38] bg-[#0B0D11] text-slate-300 hover:border-[#3A455C]'
                  }`}
                >
                  {VIDEO_TRANSITION_META[type].label}
                </button>
              ))}
            </div>
          </div>

          {activeTransitionType !== 'none' && (
            <div>
              <div className="mb-1 flex justify-between text-[11px] text-slate-400">
                <span>Duration</span>
                <span className="font-mono tabular-nums">
                  {activeTransitionDuration.toFixed(1)}s
                </span>
              </div>
              <input
                type="range"
                min={MIN_TRANSITION_DURATION_SECONDS}
                max={MAX_TRANSITION_DURATION_SECONDS}
                step={0.1}
                disabled={disabled}
                value={activeTransitionDuration}
                onChange={(e) =>
                  onSetVideoTransition(selectedTransition.clip.id, {
                    type: activeTransitionType,
                    duration: Number(e.target.value),
                  })
                }
                className="h-2 w-full cursor-pointer accent-blue-500"
              />
              {selectedTransition.effectiveDuration < activeTransitionDuration - 0.02 && (
                <p className="mt-1.5 text-[11px] text-amber-300">
                  Capped at {selectedTransition.effectiveDuration.toFixed(2)}s (45% of shorter clip).
                </p>
              )}
            </div>
          )}

          <p className="text-[11px] leading-relaxed text-slate-500">
            Transitions overlap adjacent clips seamlessly and shift later clips on other tracks automatically.
          </p>
        </div>
      ) : !selectedClip ? (
        <div className="flex flex-1 items-center justify-center p-6 text-center">
          <p className="text-xs text-slate-400">Select a clip or cut transition to edit it.</p>
        </div>
      ) : (
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
          {/* Shared Start & Duration timing controls */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-[11px] text-slate-400">Start (s)</label>
              <input
                type="number"
                step="0.1"
                min={0}
                disabled={disabled}
                value={Number(selectedClip.start.toFixed(2))}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  if (Number.isFinite(val)) {
                    onUpdateClip(selectedClip.id, { start: val });
                  }
                }}
                className="h-8 w-full rounded-lg border border-[#232A38] bg-[#0B0D11] px-2 font-mono text-xs text-slate-100 tabular-nums focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] text-slate-400">Duration (s)</label>
              <input
                type="number"
                step="0.1"
                min={MIN_CLIP_DURATION_SECONDS}
                disabled={disabled}
                value={Number(selectedClip.duration.toFixed(2))}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  if (Number.isFinite(val)) {
                    onUpdateClip(selectedClip.id, { duration: val });
                  }
                }}
                className="h-8 w-full rounded-lg border border-[#232A38] bg-[#0B0D11] px-2 font-mono text-xs text-slate-100 tabular-nums focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="h-px bg-[#232A38]" />

          {/* TEXT CLIP PROPERTIES */}
          {selectedClip.type === 'text' && (
            <>
              <div>
                <div className="mb-1 flex items-center justify-between text-[11px] text-slate-400">
                  <label htmlFor="inspector-text-content">Content</label>
                  <span className="font-mono tabular-nums">
                    {selectedClip.text.length}/{MAX_TEXT_CLIP_LENGTH}
                  </span>
                </div>
                <textarea
                  id="inspector-text-content"
                  rows={3}
                  maxLength={MAX_TEXT_CLIP_LENGTH}
                  disabled={disabled}
                  value={selectedClip.text}
                  onChange={(e) => onUpdateClip(selectedClip.id, { text: e.target.value })}
                  className="w-full resize-none rounded-lg border border-[#232A38] bg-[#0B0D11] p-2 text-xs text-slate-100 focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-[11px] text-slate-400">Size</label>
                  <select
                    disabled={disabled}
                    value={selectedClip.size}
                    onChange={(e) =>
                      onUpdateClip(selectedClip.id, { size: e.target.value as TextOverlaySize })
                    }
                    className="h-8 w-full rounded-lg border border-[#232A38] bg-[#0B0D11] px-2 text-xs text-slate-100 focus:border-blue-500 focus:outline-none"
                  >
                    {ALLOWED_OVERLAY_SIZES.map((sz) => (
                      <option key={sz} value={sz}>
                        {sz.charAt(0).toUpperCase() + sz.slice(1)}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-[11px] text-slate-400">Color</label>
                  <select
                    disabled={disabled}
                    value={selectedClip.color}
                    onChange={(e) =>
                      onUpdateClip(selectedClip.id, { color: e.target.value as TextOverlayColor })
                    }
                    className="h-8 w-full rounded-lg border border-[#232A38] bg-[#0B0D11] px-2 text-xs text-slate-100 focus:border-blue-500 focus:outline-none"
                  >
                    {ALLOWED_OVERLAY_COLORS.map((col) => (
                      <option key={col} value={col}>
                        {col.charAt(0).toUpperCase() + col.slice(1)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <span className="mb-1 block text-[11px] text-slate-400">Alignment</span>
                <div className="grid grid-cols-3 gap-1 rounded-lg border border-[#232A38] bg-[#0B0D11] p-1">
                  {(
                    [
                      { id: 'left', icon: AlignLeft, label: 'Left' },
                      { id: 'center', icon: AlignCenter, label: 'Center' },
                      { id: 'right', icon: AlignRight, label: 'Right' },
                    ] as const
                  ).map(({ id, icon: Icon, label }) => (
                    <button
                      key={id}
                      type="button"
                      disabled={disabled}
                      title={label}
                      onClick={() => onUpdateClip(selectedClip.id, { align: id as TextClipAlign })}
                      className={`flex h-7 items-center justify-center rounded-lg transition-colors ${
                        selectedClip.align === id
                          ? 'bg-[#1D2433] text-white'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  ))}
                </div>
              </div>

              <label className="flex cursor-pointer items-center justify-between rounded-lg border border-[#232A38] bg-[#0B0D11] px-3 py-2 text-xs text-slate-200">
                <span>Background box</span>
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={selectedClip.backgroundBox}
                  onChange={(e) =>
                    onUpdateClip(selectedClip.id, { backgroundBox: e.target.checked })
                  }
                  className="h-4 w-4 rounded border-[#2C3547] accent-blue-600"
                />
              </label>

              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span className="font-mono tabular-nums">
                  Pos {Math.round(selectedClip.xPercent)}% · {Math.round(selectedClip.yPercent)}%
                </span>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onUpdateClip(selectedClip.id, { xPercent: 50, yPercent: 50 })}
                  className="text-blue-400 hover:text-blue-300"
                >
                  Center
                </button>
              </div>

              <div className="h-px bg-[#232A38]" />

              {/* Text Animations (In / Out) */}
              {(() => {
                const animCfg = resolveTextClipAnimationConfig(selectedClip);
                const hasSlideAnimation =
                  isSlideTextAnimation(animCfg.animInType) ||
                  isSlideTextAnimation(animCfg.animOutType);
                return (
                  <div className="flex flex-col gap-3">
                    <span className="text-[11px] font-medium text-slate-300">Animations</span>

                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <label
                          htmlFor="inspector-anim-in"
                          className="text-[11px] text-slate-400"
                        >
                          In
                        </label>
                        {animCfg.animInType !== 'none' && (
                          <span className="font-mono text-[11px] text-slate-300 tabular-nums">
                            {animCfg.animInDuration.toFixed(1)}s
                          </span>
                        )}
                      </div>
                      <select
                        id="inspector-anim-in"
                        disabled={disabled}
                        value={animCfg.animInType}
                        onChange={(e) => {
                          const nextIn = e.target.value as TextAnimationType;
                          onUpdateClip(selectedClip.id, {
                            animInType: nextIn,
                            animInDuration: animCfg.animInDuration,
                            ...(isSlideTextAnimation(nextIn) &&
                            selectedClip.fadeWithSlide === undefined
                              ? { fadeWithSlide: true }
                              : {}),
                          });
                        }}
                        className="h-8 w-full rounded-lg border border-[#232A38] bg-[#0B0D11] px-2 text-xs text-slate-100 focus:border-blue-500 focus:outline-none"
                      >
                        {ALLOWED_TEXT_ANIMATIONS.map((anim) => (
                          <option key={anim} value={anim}>
                            {TEXT_ANIMATION_LABELS[anim]}
                          </option>
                        ))}
                      </select>
                      {animCfg.animInType !== 'none' && (
                        <input
                          type="range"
                          aria-label="In animation duration"
                          min={MIN_TEXT_ANIMATION_SECONDS}
                          max={MAX_TEXT_ANIMATION_SECONDS}
                          step={0.1}
                          disabled={disabled}
                          value={animCfg.animInDuration}
                          onChange={(e) =>
                            onUpdateClip(selectedClip.id, {
                              animInDuration: Number(e.target.value),
                            })
                          }
                          className="h-2 w-full cursor-pointer accent-blue-500"
                        />
                      )}
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <label
                          htmlFor="inspector-anim-out"
                          className="text-[11px] text-slate-400"
                        >
                          Out
                        </label>
                        {animCfg.animOutType !== 'none' && (
                          <span className="font-mono text-[11px] text-slate-300 tabular-nums">
                            {animCfg.animOutDuration.toFixed(1)}s
                          </span>
                        )}
                      </div>
                      <select
                        id="inspector-anim-out"
                        disabled={disabled}
                        value={animCfg.animOutType}
                        onChange={(e) => {
                          const nextOut = e.target.value as TextAnimationType;
                          onUpdateClip(selectedClip.id, {
                            animOutType: nextOut,
                            animOutDuration: animCfg.animOutDuration,
                            ...(isSlideTextAnimation(nextOut) &&
                            selectedClip.fadeWithSlide === undefined
                              ? { fadeWithSlide: true }
                              : {}),
                          });
                        }}
                        className="h-8 w-full rounded-lg border border-[#232A38] bg-[#0B0D11] px-2 text-xs text-slate-100 focus:border-blue-500 focus:outline-none"
                      >
                        {ALLOWED_TEXT_ANIMATIONS.map((anim) => (
                          <option key={anim} value={anim}>
                            {TEXT_ANIMATION_LABELS[anim]}
                          </option>
                        ))}
                      </select>
                      {animCfg.animOutType !== 'none' && (
                        <input
                          type="range"
                          aria-label="Out animation duration"
                          min={MIN_TEXT_ANIMATION_SECONDS}
                          max={MAX_TEXT_ANIMATION_SECONDS}
                          step={0.1}
                          disabled={disabled}
                          value={animCfg.animOutDuration}
                          onChange={(e) =>
                            onUpdateClip(selectedClip.id, {
                              animOutDuration: Number(e.target.value),
                            })
                          }
                          className="h-2 w-full cursor-pointer accent-blue-500"
                        />
                      )}
                    </div>

                    {hasSlideAnimation && (
                      <label className="flex cursor-pointer items-center justify-between text-[11px] text-slate-300">
                        <span>Fade with slide</span>
                        <input
                          type="checkbox"
                          disabled={disabled}
                          checked={animCfg.fadeWithSlide}
                          onChange={(e) =>
                            onUpdateClip(selectedClip.id, { fadeWithSlide: e.target.checked })
                          }
                          className="h-4 w-4 rounded border-[#2C3547] accent-blue-600"
                        />
                      </label>
                    )}

                    {hasCaptions && (
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => onApplyAnimationToAllCaptions(animCfg)}
                        className="h-8 w-full rounded-lg border border-[#2C3547] bg-[#0B0D11] px-2.5 text-xs font-medium text-blue-300 transition-colors hover:border-blue-500 hover:text-white disabled:opacity-40"
                      >
                        Apply to all captions
                      </button>
                    )}
                  </div>
                );
              })()}
            </>
          )}

          {/* EFFECT CLIP PROPERTIES */}
          {selectedClip.type === 'effect' && (
            <>
              <div>
                <label
                  htmlFor="inspector-effect-type"
                  className="mb-1 block text-[11px] font-medium text-slate-300"
                >
                  Effect
                </label>
                <select
                  id="inspector-effect-type"
                  disabled={disabled}
                  value={selectedClip.effectType}
                  onChange={(e) => {
                    const nextType = e.target.value as VideoEffectType;
                    onUpdateClip(selectedClip.id, {
                      effectType: nextType,
                      name: VIDEO_EFFECT_META_MAP[nextType].label,
                    });
                  }}
                  className="h-8 w-full rounded-lg border border-[#232A38] bg-[#0B0D11] px-2 text-xs text-slate-100 focus:border-blue-500 focus:outline-none"
                >
                  {VIDEO_EFFECT_CATALOG.map((ef) => (
                    <option key={ef.type} value={ef.type}>
                      {ef.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div className="mb-1 flex justify-between text-[11px] text-slate-400">
                  <span>Intensity</span>
                  <span className="font-mono tabular-nums">{selectedClip.intensity}%</span>
                </div>
                <input
                  type="range"
                  aria-label="Effect intensity"
                  min={0}
                  max={100}
                  step={1}
                  disabled={disabled}
                  value={selectedClip.intensity}
                  onChange={(e) =>
                    onUpdateClip(selectedClip.id, { intensity: Number(e.target.value) })
                  }
                  className="h-2 w-full cursor-pointer accent-amber-500"
                />
              </div>

              {!VIDEO_EFFECT_META_MAP[selectedClip.effectType].hasExactCssPreview && (
                <div className="flex items-start gap-2 rounded-lg border border-[#232A38] bg-[#0B0D11] p-2.5 text-[11px] text-slate-400">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" aria-hidden="true" />
                  <span>
                    Approximate preview in browser; full effect is rendered accurately on export.
                  </span>
                </div>
              )}
            </>
          )}

          {/* AUDIO CLIP PROPERTIES */}
          {selectedClip.type === 'audio' && (
            <>
              <p className="truncate text-xs font-medium text-slate-200" title={selectedClip.name}>
                {selectedClip.name}
              </p>

              <div>
                <div className="mb-1 flex items-center justify-between text-[11px] text-slate-400">
                  <span>Volume</span>
                  <span className="font-mono tabular-nums">
                    {selectedClip.muted ? 'Muted' : `${selectedClip.volumePercent}%`}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onUpdateClip(selectedClip.id, { muted: !selectedClip.muted })}
                    aria-label={selectedClip.muted ? 'Unmute audio clip' : 'Mute audio clip'}
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#232A38] bg-[#0B0D11] text-slate-300 hover:border-[#3A455C]"
                  >
                    {selectedClip.muted ? (
                      <VolumeX className="h-3.5 w-3.5" aria-hidden="true" />
                    ) : (
                      <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={200}
                    step={5}
                    disabled={disabled || selectedClip.muted}
                    value={selectedClip.volumePercent}
                    onChange={(e) =>
                      onUpdateClip(selectedClip.id, { volumePercent: Number(e.target.value) })
                    }
                    className="h-2 flex-1 cursor-pointer accent-blue-500 disabled:opacity-40"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="mb-1 flex justify-between text-[11px] text-slate-400">
                    <span>Fade in</span>
                    <span className="font-mono tabular-nums">
                      {selectedClip.fadeInSeconds.toFixed(1)}s
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={MAX_ADDED_AUDIO_FADE_SECONDS}
                    step={0.1}
                    disabled={disabled}
                    value={selectedClip.fadeInSeconds}
                    onChange={(e) =>
                      onUpdateClip(selectedClip.id, { fadeInSeconds: Number(e.target.value) })
                    }
                    className="h-2 w-full cursor-pointer accent-blue-500"
                  />
                </div>
                <div>
                  <div className="mb-1 flex justify-between text-[11px] text-slate-400">
                    <span>Fade out</span>
                    <span className="font-mono tabular-nums">
                      {selectedClip.fadeOutSeconds.toFixed(1)}s
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={MAX_ADDED_AUDIO_FADE_SECONDS}
                    step={0.1}
                    disabled={disabled}
                    value={selectedClip.fadeOutSeconds}
                    onChange={(e) =>
                      onUpdateClip(selectedClip.id, { fadeOutSeconds: Number(e.target.value) })
                    }
                    className="h-2 w-full cursor-pointer accent-blue-500"
                  />
                </div>
              </div>

              <label className="flex cursor-pointer items-center justify-between rounded-lg border border-[#232A38] bg-[#0B0D11] px-3 py-2 text-xs text-slate-200">
                <span>Loop audio clip</span>
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={selectedClip.loop}
                  onChange={(e) => onUpdateClip(selectedClip.id, { loop: e.target.checked })}
                  className="h-4 w-4 rounded border-[#2C3547] accent-blue-600"
                />
              </label>
            </>
          )}

          {/* IMAGE CLIP PROPERTIES */}
          {selectedClip.type === 'image' && (
            <>
              <p className="truncate text-xs font-medium text-slate-200" title={selectedClip.name}>
                {selectedClip.name}
              </p>

              <div>
                <div className="mb-1 flex justify-between text-[11px] text-slate-400">
                  <span>Width</span>
                  <span className="font-mono tabular-nums">{selectedClip.sizePercent}%</span>
                </div>
                <input
                  type="range"
                  min={MIN_IMAGE_SIZE_PERCENT}
                  max={MAX_IMAGE_SIZE_PERCENT}
                  step={1}
                  disabled={disabled}
                  value={selectedClip.sizePercent}
                  onChange={(e) =>
                    onUpdateClip(selectedClip.id, { sizePercent: Number(e.target.value) })
                  }
                  className="h-2 w-full cursor-pointer accent-blue-500"
                />
              </div>

              <div>
                <div className="mb-1 flex justify-between text-[11px] text-slate-400">
                  <span>Opacity</span>
                  <span className="font-mono tabular-nums">{selectedClip.opacityPercent}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  disabled={disabled}
                  value={selectedClip.opacityPercent}
                  onChange={(e) =>
                    onUpdateClip(selectedClip.id, { opacityPercent: Number(e.target.value) })
                  }
                  className="h-2 w-full cursor-pointer accent-blue-500"
                />
              </div>

              <div>
                <span className="mb-1.5 block text-[11px] text-slate-400">
                  Quick position (or drag on preview)
                </span>
                <div className="grid grid-cols-5 gap-1">
                  {[
                    { label: 'TL', x: 5, y: 5 },
                    { label: 'TR', x: 95, y: 5 },
                    { label: 'Ctr', x: 50, y: 50 },
                    { label: 'BL', x: 5, y: 95 },
                    { label: 'BR', x: 95, y: 95 },
                  ].map((pos) => (
                    <button
                      key={pos.label}
                      type="button"
                      disabled={disabled}
                      onClick={() =>
                        onUpdateClip(selectedClip.id, { xPercent: pos.x, yPercent: pos.y })
                      }
                      className="h-7 rounded-lg border border-[#232A38] bg-[#0B0D11] text-[11px] font-medium text-slate-300 hover:border-blue-500"
                    >
                      {pos.label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* VIDEO CLIP PROPERTIES */}
          {selectedClip.type === 'video' && (
            <>
              <div>
                <span className="mb-1.5 block text-[11px] font-medium text-slate-300">Speed</span>
                <div className="grid grid-cols-4 gap-1 rounded-lg border border-[#232A38] bg-[#0B0D11] p-1">
                  {ALLOWED_SPEEDS.map((spd: PlaybackSpeed) => (
                    <button
                      key={spd}
                      type="button"
                      disabled={disabled}
                      onClick={() => onUpdateClip(selectedClip.id, { speed: spd })}
                      className={`h-7 rounded-lg font-mono text-xs transition-colors tabular-nums ${
                        selectedClip.speed === spd
                          ? 'bg-[#1D2433] text-white'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {spd}x
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between text-[11px] text-slate-400">
                  <span>Audio volume</span>
                  <span className="font-mono tabular-nums">
                    {selectedClip.muted ? 'Muted' : `${selectedClip.volumePercent}%`}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onUpdateClip(selectedClip.id, { muted: !selectedClip.muted })}
                    aria-label={selectedClip.muted ? 'Unmute clip' : 'Mute clip'}
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#232A38] bg-[#0B0D11] text-slate-300 hover:border-[#3A455C]"
                  >
                    {selectedClip.muted ? (
                      <VolumeX className="h-3.5 w-3.5" aria-hidden="true" />
                    ) : (
                      <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={200}
                    step={5}
                    disabled={disabled || selectedClip.muted}
                    value={selectedClip.volumePercent}
                    onChange={(e) =>
                      onUpdateClip(selectedClip.id, { volumePercent: Number(e.target.value) })
                    }
                    className="h-2 flex-1 cursor-pointer accent-blue-500 disabled:opacity-40"
                  />
                </div>
              </div>

              <div>
                <span className="mb-1.5 block text-[11px] font-medium text-slate-300">
                  Transform
                </span>
                <div className="grid grid-cols-3 gap-1.5">
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() =>
                      onUpdateClip(selectedClip.id, {
                        rotationDegrees: ((selectedClip.rotationDegrees + 270) % 360) as RotationDegrees,
                      })
                    }
                    className="flex h-8 items-center justify-center gap-1 rounded-lg border border-[#232A38] bg-[#0B0D11] text-[11px] text-slate-200 hover:border-[#3A455C]"
                  >
                    <RotateCcw className="h-3 w-3" aria-hidden="true" />
                    <span>-90°</span>
                  </button>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() =>
                      onUpdateClip(selectedClip.id, {
                        rotationDegrees: ((selectedClip.rotationDegrees + 90) % 360) as RotationDegrees,
                      })
                    }
                    className="flex h-8 items-center justify-center gap-1 rounded-lg border border-[#232A38] bg-[#0B0D11] text-[11px] text-slate-200 hover:border-[#3A455C]"
                  >
                    <RotateCw className="h-3 w-3" aria-hidden="true" />
                    <span>+90°</span>
                  </button>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() =>
                      onUpdateClip(selectedClip.id, { flipHorizontal: !selectedClip.flipHorizontal })
                    }
                    className={`flex h-8 items-center justify-center gap-1 rounded-lg border text-[11px] transition-colors ${
                      selectedClip.flipHorizontal
                        ? 'border-blue-500 bg-blue-500/15 text-blue-200'
                        : 'border-[#232A38] bg-[#0B0D11] text-slate-200 hover:border-[#3A455C]'
                    }`}
                  >
                    <FlipHorizontal2 className="h-3 w-3" aria-hidden="true" />
                    <span>Flip</span>
                  </button>
                </div>
              </div>

              <div>
                <span className="mb-1.5 block text-[11px] font-medium text-slate-300">Crop</span>
                <div className="grid grid-cols-4 gap-1 rounded-lg border border-[#232A38] bg-[#0B0D11] p-1">
                  {ALLOWED_CROP_ASPECTS.map((aspect) => (
                    <button
                      key={aspect}
                      type="button"
                      disabled={disabled}
                      onClick={() => onUpdateClip(selectedClip.id, { cropAspect: aspect })}
                      className={`h-7 rounded-lg text-[11px] font-medium transition-colors ${
                        selectedClip.cropAspect === aspect
                          ? 'bg-[#1D2433] text-white'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {CROP_LABELS[aspect]}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-[11px] font-medium text-slate-300">Color Filters</span>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() =>
                      onUpdateClip(selectedClip.id, { colorFilter: createDefaultColorFilter() })
                    }
                    className="text-[11px] text-blue-400 hover:text-blue-300"
                  >
                    Reset
                  </button>
                </div>

                <div className="grid grid-cols-4 gap-1 rounded-lg border border-[#232A38] bg-[#0B0D11] p-1">
                  {ALLOWED_COLOR_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      disabled={disabled}
                      onClick={() =>
                        onUpdateClip(selectedClip.id, {
                          colorFilter: { ...selectedClip.colorFilter, preset },
                        })
                      }
                      className={`h-7 rounded-lg text-[11px] font-medium transition-colors ${
                        selectedClip.colorFilter.preset === preset
                          ? 'bg-[#1D2433] text-white'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {COLOR_PRESET_LABELS[preset]}
                    </button>
                  ))}
                </div>

                <div className="mt-2.5 flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <span className="w-16 text-[11px] text-slate-400">Bright</span>
                    <input
                      type="range"
                      min={-0.5}
                      max={0.5}
                      step={0.05}
                      disabled={disabled}
                      value={selectedClip.colorFilter.brightness}
                      onChange={(e) =>
                        onUpdateClip(selectedClip.id, {
                          colorFilter: {
                            ...selectedClip.colorFilter,
                            brightness: Number(e.target.value),
                          },
                        })
                      }
                      className="h-2 flex-1 cursor-pointer accent-blue-500"
                    />
                    <span className="w-9 text-right font-mono text-[11px] text-slate-300 tabular-nums">
                      {selectedClip.colorFilter.brightness.toFixed(2)}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="w-16 text-[11px] text-slate-400">Contrast</span>
                    <input
                      type="range"
                      min={0.5}
                      max={1.5}
                      step={0.05}
                      disabled={disabled}
                      value={selectedClip.colorFilter.contrast}
                      onChange={(e) =>
                        onUpdateClip(selectedClip.id, {
                          colorFilter: {
                            ...selectedClip.colorFilter,
                            contrast: Number(e.target.value),
                          },
                        })
                      }
                      className="h-2 flex-1 cursor-pointer accent-blue-500"
                    />
                    <span className="w-9 text-right font-mono text-[11px] text-slate-300 tabular-nums">
                      {selectedClip.colorFilter.contrast.toFixed(2)}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="w-16 text-[11px] text-slate-400">Saturate</span>
                    <input
                      type="range"
                      min={0}
                      max={2}
                      step={0.05}
                      disabled={disabled}
                      value={selectedClip.colorFilter.saturation}
                      onChange={(e) =>
                        onUpdateClip(selectedClip.id, {
                          colorFilter: {
                            ...selectedClip.colorFilter,
                            saturation: Number(e.target.value),
                          },
                        })
                      }
                      className="h-2 flex-1 cursor-pointer accent-blue-500"
                    />
                    <span className="w-9 text-right font-mono text-[11px] text-slate-300 tabular-nums">
                      {selectedClip.colorFilter.saturation.toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="mb-1 flex justify-between text-[11px] text-slate-400">
                    <span>Fade in</span>
                    <span className="font-mono tabular-nums">
                      {selectedClip.fadeInSeconds.toFixed(1)}s
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={MAX_FADE_SECONDS}
                    step={0.1}
                    disabled={disabled}
                    value={selectedClip.fadeInSeconds}
                    onChange={(e) =>
                      onUpdateClip(selectedClip.id, { fadeInSeconds: Number(e.target.value) })
                    }
                    className="h-2 w-full cursor-pointer accent-blue-500"
                  />
                </div>
                <div>
                  <div className="mb-1 flex justify-between text-[11px] text-slate-400">
                    <span>Fade out</span>
                    <span className="font-mono tabular-nums">
                      {selectedClip.fadeOutSeconds.toFixed(1)}s
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={MAX_FADE_SECONDS}
                    step={0.1}
                    disabled={disabled}
                    value={selectedClip.fadeOutSeconds}
                    onChange={(e) =>
                      onUpdateClip(selectedClip.id, { fadeOutSeconds: Number(e.target.value) })
                    }
                    className="h-2 w-full cursor-pointer accent-blue-500"
                  />
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </aside>
  );
}
