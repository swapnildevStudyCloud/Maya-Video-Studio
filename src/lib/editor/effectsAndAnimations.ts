import {
  ALLOWED_TEXT_ANIMATIONS,
  ALLOWED_VIDEO_EFFECTS,
  ALLOWED_VIDEO_TRANSITIONS,
  DEFAULT_EFFECT_CLIP_DURATION,
  DEFAULT_TEXT_ANIMATION_SECONDS,
  DEFAULT_TRANSITION_DURATION_SECONDS,
  HEAVY_EFFECTS_MIN_COUNT,
  HEAVY_EFFECTS_WARNING_SECONDS,
  MAX_EFFECT_INTENSITY,
  MAX_TEXT_ANIMATION_SECONDS,
  MAX_TRANSITION_DURATION_SECONDS,
  MIN_CLIP_DURATION_SECONDS,
  MIN_EFFECT_INTENSITY,
  MIN_TEXT_ANIMATION_SECONDS,
  MIN_TRANSITION_DURATION_SECONDS,
  TEXT_SLIDE_HORIZONTAL_PCT,
  TEXT_SLIDE_VERTICAL_PCT,
  type EffectClip,
  type ProjectState,
  type TextAnimationType,
  type TextClip,
  type ValidationResult,
  type VideoClip,
  type VideoEffectType,
  type VideoTransition,
  type VideoTransitionType,
} from './types';

function fmtSec(value: number): string {
  return Math.max(0, value).toFixed(3);
}

// ---------------------------------------------------------------------------
// Text Animations (drawtext alpha / x / y / fontsize expressions)
// ---------------------------------------------------------------------------

export const TEXT_ANIMATION_LABELS: Record<TextAnimationType, string> = {
  none: 'None',
  fade: 'Fade',
  'slide-up': 'Slide Up',
  'slide-down': 'Slide Down',
  'slide-left': 'Slide Left',
  'slide-right': 'Slide Right',
  pop: 'Pop (Scale)',
};

export function clampTextAnimationDuration(seconds: number | undefined): number {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) {
    return DEFAULT_TEXT_ANIMATION_SECONDS;
  }
  return Math.max(
    MIN_TEXT_ANIMATION_SECONDS,
    Math.min(MAX_TEXT_ANIMATION_SECONDS, Number(seconds.toFixed(2)))
  );
}

export function resolveTextClipAnimationConfig(clip: TextClip): {
  animInType: TextAnimationType;
  animInDuration: number;
  animOutType: TextAnimationType;
  animOutDuration: number;
} {
  const animInType: TextAnimationType =
    clip.animInType && ALLOWED_TEXT_ANIMATIONS.includes(clip.animInType)
      ? clip.animInType
      : 'none';
  const animOutType: TextAnimationType =
    clip.animOutType && ALLOWED_TEXT_ANIMATIONS.includes(clip.animOutType)
      ? clip.animOutType
      : 'none';
  return {
    animInType,
    animInDuration: clampTextAnimationDuration(clip.animInDuration),
    animOutType,
    animOutDuration: clampTextAnimationDuration(clip.animOutDuration),
  };
}

export function resolveEffectiveAnimationDurations(params: {
  clipDuration: number;
  animInType: TextAnimationType;
  animInDuration: number;
  animOutType: TextAnimationType;
  animOutDuration: number;
}): { inDuration: number; outDuration: number } {
  const safeClipDur = Math.max(MIN_CLIP_DURATION_SECONDS, params.clipDuration);
  let inDur =
    params.animInType === 'none' ? 0 : clampTextAnimationDuration(params.animInDuration);
  let outDur =
    params.animOutType === 'none' ? 0 : clampTextAnimationDuration(params.animOutDuration);

  const sum = inDur + outDur;
  if (sum > safeClipDur && sum > 0) {
    const ratio = safeClipDur / sum;
    inDur = Number((inDur * ratio).toFixed(3));
    outDur = Number((outDur * ratio).toFixed(3));
  }
  return { inDuration: inDur, outDuration: outDur };
}

/**
 * Builds deterministic drawtext expressions (`alpha`, `x`, `y`, `fontsize`) tested
 * against the bundled ffmpeg-core.wasm build. User text never touches any expression.
 */
export function buildDrawtextAnimationExpressions(params: {
  start: number;
  duration: number;
  baseFontSize: number;
  baseXExpr: string;
  baseYExpr: string;
  animInType: TextAnimationType;
  animInDuration: number;
  animOutType: TextAnimationType;
  animOutDuration: number;
}): {
  xExpr: string;
  yExpr: string;
  fontsizeExpr: string;
  alphaExpr: string | null;
} {
  const sNum = Math.max(0, params.start);
  const durNum = Math.max(MIN_CLIP_DURATION_SECONDS, params.duration);
  const eNum = sNum + durNum;
  const s = fmtSec(sNum);
  const e = fmtSec(eNum);
  const baseFont = Math.max(12, Math.round(params.baseFontSize));

  const { inDuration, outDuration } = resolveEffectiveAnimationDurations({
    clipDuration: durNum,
    animInType: params.animInType,
    animInDuration: params.animInDuration,
    animOutType: params.animOutType,
    animOutDuration: params.animOutDuration,
  });

  const inD = inDuration > 0.001 ? fmtSec(inDuration) : null;
  const outD = outDuration > 0.001 ? fmtSec(outDuration) : null;
  const inU = inD ? `clip((t-${s})/${inD}\\,0\\,1)` : '1';
  const outV = outD ? `clip((${e}-t)/${outD}\\,0\\,1)` : '1';
  const inSlideRem = inD ? `pow(clip(1-(t-${s})/${inD}\\,0\\,1)\\,3)` : '0';
  const outSlideMove = outD ? `(1-pow(clip((${e}-t)/${outD}\\,0\\,1)\\,3))` : '0';
  const hFactor = (TEXT_SLIDE_HORIZONTAL_PCT / 100).toFixed(2);
  const vFactor = (TEXT_SLIDE_VERTICAL_PCT / 100).toFixed(2);

  // Alpha (fade in / fade out)
  const alphaFactors: string[] = [];
  if (params.animInType === 'fade' && inD) {
    alphaFactors.push(inU);
  }
  if (params.animOutType === 'fade' && outD) {
    alphaFactors.push(outV);
  }
  const alphaExpr = alphaFactors.length > 0 ? `'${alphaFactors.join('*')}'` : null;

  // Font size (pop scale 0.2 -> 1.0 on In, 1.0 -> 0.2 on Out)
  const scaleFactors: string[] = [];
  if (params.animInType === 'pop' && inD) {
    scaleFactors.push(`(0.2+0.8*${inU})`);
  }
  if (params.animOutType === 'pop' && outD) {
    scaleFactors.push(`(0.2+0.8*${outV})`);
  }
  const fontsizeExpr =
    scaleFactors.length > 0 ? `'${baseFont}*${scaleFactors.join('*')}'` : String(baseFont);

  // X slide offsets (cubic ease-out, proportional to frame width)
  const dxTerms: string[] = [];
  if (params.animInType === 'slide-left' && inD) {
    dxTerms.push(`${inSlideRem}*w*${hFactor}`);
  } else if (params.animInType === 'slide-right' && inD) {
    dxTerms.push(`-${inSlideRem}*w*${hFactor}`);
  }
  if (params.animOutType === 'slide-left' && outD) {
    dxTerms.push(`-${outSlideMove}*w*${hFactor}`);
  } else if (params.animOutType === 'slide-right' && outD) {
    dxTerms.push(`${outSlideMove}*w*${hFactor}`);
  }
  const xExpr =
    dxTerms.length > 0 ? `'${params.baseXExpr}+(${dxTerms.join('+')})'` : params.baseXExpr;

  // Y slide offsets (cubic ease-out, proportional to frame height)
  const dyTerms: string[] = [];
  if (params.animInType === 'slide-up' && inD) {
    dyTerms.push(`${inSlideRem}*h*${vFactor}`);
  } else if (params.animInType === 'slide-down' && inD) {
    dyTerms.push(`-${inSlideRem}*h*${vFactor}`);
  }
  if (params.animOutType === 'slide-up' && outD) {
    dyTerms.push(`-${outSlideMove}*h*${vFactor}`);
  } else if (params.animOutType === 'slide-down' && outD) {
    dyTerms.push(`${outSlideMove}*h*${vFactor}`);
  }
  const yExpr =
    dyTerms.length > 0 ? `'${params.baseYExpr}+(${dyTerms.join('+')})'` : params.baseYExpr;

  return { xExpr, yExpr, fontsizeExpr, alphaExpr };
}

/**
 * Computes CSS-approximated animation transform/opacity values for PreviewCanvas at playhead `t`.
 * Slide percentages are relative to the video frame width/height so preview matches ffmpeg export.
 */
export function evaluateTextAnimationPreview(
  clip: TextClip,
  playhead: number
): { opacity: number; scale: number; offsetXPct: number; offsetYPct: number } {
  const { animInType, animInDuration, animOutType, animOutDuration } =
    resolveTextClipAnimationConfig(clip);
  const { inDuration, outDuration } = resolveEffectiveAnimationDurations({
    clipDuration: clip.duration,
    animInType,
    animInDuration,
    animOutType,
    animOutDuration,
  });

  const s = clip.start;
  const e = clip.start + clip.duration;
  const inU = inDuration > 0.001 ? Math.max(0, Math.min(1, (playhead - s) / inDuration)) : 1;
  const outV = outDuration > 0.001 ? Math.max(0, Math.min(1, (e - playhead) / outDuration)) : 1;
  const inSlideRem =
    inDuration > 0.001
      ? Math.pow(Math.max(0, Math.min(1, 1 - (playhead - s) / inDuration)), 3)
      : 0;
  const outSlideMove =
    outDuration > 0.001
      ? 1 - Math.pow(Math.max(0, Math.min(1, (e - playhead) / outDuration)), 3)
      : 0;

  let opacity = 1;
  if (animInType === 'fade' && inDuration > 0) opacity *= inU;
  if (animOutType === 'fade' && outDuration > 0) opacity *= outV;

  let scale = 1;
  if (animInType === 'pop' && inDuration > 0) scale *= 0.2 + 0.8 * inU;
  if (animOutType === 'pop' && outDuration > 0) scale *= 0.2 + 0.8 * outV;

  let offsetXPct = 0;
  if (animInType === 'slide-left' && inDuration > 0) {
    offsetXPct += inSlideRem * TEXT_SLIDE_HORIZONTAL_PCT;
  }
  if (animInType === 'slide-right' && inDuration > 0) {
    offsetXPct -= inSlideRem * TEXT_SLIDE_HORIZONTAL_PCT;
  }
  if (animOutType === 'slide-left' && outDuration > 0) {
    offsetXPct -= outSlideMove * TEXT_SLIDE_HORIZONTAL_PCT;
  }
  if (animOutType === 'slide-right' && outDuration > 0) {
    offsetXPct += outSlideMove * TEXT_SLIDE_HORIZONTAL_PCT;
  }

  let offsetYPct = 0;
  if (animInType === 'slide-up' && inDuration > 0) {
    offsetYPct += inSlideRem * TEXT_SLIDE_VERTICAL_PCT;
  }
  if (animInType === 'slide-down' && inDuration > 0) {
    offsetYPct -= inSlideRem * TEXT_SLIDE_VERTICAL_PCT;
  }
  if (animOutType === 'slide-up' && outDuration > 0) {
    offsetYPct -= outSlideMove * TEXT_SLIDE_VERTICAL_PCT;
  }
  if (animOutType === 'slide-down' && outDuration > 0) {
    offsetYPct += outSlideMove * TEXT_SLIDE_VERTICAL_PCT;
  }

  return { opacity, scale, offsetXPct, offsetYPct };
}

// ---------------------------------------------------------------------------
// VFX Effects (tested against bundled ffmpeg-core.wasm)
// ---------------------------------------------------------------------------

export interface VideoEffectMeta {
  type: VideoEffectType;
  label: string;
  description: string;
  defaultIntensity: number;
  hasExactCssPreview: boolean;
}

export const VIDEO_EFFECT_CATALOG: readonly VideoEffectMeta[] = [
  {
    type: 'blur',
    label: 'Blur',
    description: 'Gaussian blur',
    defaultIntensity: 55,
    hasExactCssPreview: true,
  },
  {
    type: 'sharpen',
    label: 'Sharpen',
    description: 'Crisp edge boost',
    defaultIntensity: 60,
    hasExactCssPreview: false,
  },
  {
    type: 'vignette',
    label: 'Vignette',
    description: 'Dark corner falloff',
    defaultIntensity: 65,
    hasExactCssPreview: true,
  },
  {
    type: 'film-grain',
    label: 'Film Grain',
    description: 'Analog noise texture',
    defaultIntensity: 45,
    hasExactCssPreview: false,
  },
  {
    type: 'glitch-rgb',
    label: 'Glitch / RGB Split',
    description: 'Chromatic channel shift',
    defaultIntensity: 60,
    hasExactCssPreview: false,
  },
  {
    type: 'camera-shake',
    label: 'Camera Shake',
    description: 'Handheld motion jitter',
    defaultIntensity: 50,
    hasExactCssPreview: false,
  },
  {
    type: 'bw',
    label: 'Black & White',
    description: 'Monochrome desaturation',
    defaultIntensity: 100,
    hasExactCssPreview: true,
  },
  {
    type: 'sepia',
    label: 'Sepia',
    description: 'Warm vintage tone',
    defaultIntensity: 85,
    hasExactCssPreview: true,
  },
  {
    type: 'invert',
    label: 'Invert',
    description: 'Negative color invert',
    defaultIntensity: 100,
    hasExactCssPreview: true,
  },
  {
    type: 'pixelate',
    label: 'Pixelate',
    description: 'Mosaic block grid',
    defaultIntensity: 50,
    hasExactCssPreview: false,
  },
  {
    type: 'mirror',
    label: 'Mirror',
    description: 'Horizontal flip',
    defaultIntensity: 100,
    hasExactCssPreview: true,
  },
  {
    type: 'flash',
    label: 'Flash (White)',
    description: 'White pulse fade',
    defaultIntensity: 85,
    hasExactCssPreview: true,
  },
];

export const VIDEO_EFFECT_META_MAP: Record<VideoEffectType, VideoEffectMeta> =
  VIDEO_EFFECT_CATALOG.reduce(
    (acc, item) => {
      acc[item.type] = item;
      return acc;
    },
    {} as Record<VideoEffectType, VideoEffectMeta>
  );

export function clampEffectIntensity(intensity: number): number {
  if (!Number.isFinite(intensity)) return 50;
  return Math.max(MIN_EFFECT_INTENSITY, Math.min(MAX_EFFECT_INTENSITY, Math.round(intensity)));
}

export function validateEffectClip(clip: EffectClip): ValidationResult<EffectClip> {
  if (!ALLOWED_VIDEO_EFFECTS.includes(clip.effectType)) {
    return {
      ok: false,
      code: 'INVALID_TOOL_CONFIG',
      error: `Unsupported video effect "${clip.effectType}".`,
    };
  }
  if (!Number.isFinite(clip.start) || clip.start < 0) {
    return {
      ok: false,
      code: 'NEGATIVE_TIME',
      error: `Effect "${clip.name}" has a negative start time.`,
    };
  }
  if (!Number.isFinite(clip.duration) || clip.duration < MIN_CLIP_DURATION_SECONDS - 1e-6) {
    return {
      ok: false,
      code: 'CLIP_TOO_SHORT',
      error: `Effect "${clip.name}" must be at least ${MIN_CLIP_DURATION_SECONDS} s long.`,
    };
  }
  if (
    !Number.isFinite(clip.intensity) ||
    clip.intensity < MIN_EFFECT_INTENSITY ||
    clip.intensity > MAX_EFFECT_INTENSITY
  ) {
    return {
      ok: false,
      code: 'INVALID_TOOL_CONFIG',
      error: `Effect "${clip.name}" intensity must be between 0 and 100.`,
    };
  }
  return { ok: true, value: clip };
}

export function createEffectClip(params: {
  id: string;
  effectType: VideoEffectType;
  start: number;
  duration?: number;
  intensity?: number;
}): EffectClip {
  const meta = VIDEO_EFFECT_META_MAP[params.effectType];
  return {
    id: params.id,
    type: 'effect',
    name: meta.label,
    effectType: params.effectType,
    start: Math.max(0, params.start),
    duration: Math.max(
      MIN_CLIP_DURATION_SECONDS,
      params.duration ?? DEFAULT_EFFECT_CLIP_DURATION
    ),
    sourceOffset: 0,
    intensity: clampEffectIntensity(params.intensity ?? meta.defaultIntensity),
  };
}

/**
 * Builds deterministic ffmpeg filtergraph fragment(s) for an EffectClip bounded
 * strictly to `between(t, start, end)`. Returns null if intensity === 0.
 */
export function buildEffectFilterChain(params: {
  inputLabel: string;
  effect: EffectClip;
  width: number;
  height: number;
  fps: number;
  index: number;
}): { filterFragments: string[]; outputLabel: string } | null {
  const { inputLabel, effect, width, height, fps, index } = params;
  const intensity = clampEffectIntensity(effect.intensity);
  if (intensity <= 0) return null;

  const k = intensity / 100;
  const sNum = Math.max(0, effect.start);
  const durNum = Math.max(MIN_CLIP_DURATION_SECONDS, effect.duration);
  const eNum = sNum + durNum;
  const s = fmtSec(sNum);
  const e = fmtSec(eNum);
  const outLbl = `[vefx${index}]`;
  const w = Math.max(2, Math.floor(width / 2) * 2);
  const h = Math.max(2, Math.floor(height / 2) * 2);

  switch (effect.effectType) {
    case 'blur': {
      const sigma = (0.5 + k * 17.5).toFixed(2);
      return {
        filterFragments: [`${inputLabel}gblur=sigma=${sigma}:enable='between(t,${s},${e})'${outLbl}`],
        outputLabel: outLbl,
      };
    }

    case 'sharpen': {
      const lumaAmount = (0.2 + k * 2.8).toFixed(2);
      return {
        filterFragments: [
          `${inputLabel}unsharp=5:5:${lumaAmount}:5:5:0.0:enable='between(t,${s},${e})'${outLbl}`,
        ],
        outputLabel: outLbl,
      };
    }

    case 'vignette': {
      const angle = (0.25 + k * 1.15).toFixed(3);
      return {
        filterFragments: [
          `${inputLabel}vignette=angle=${angle}:enable='between(t,${s},${e})'${outLbl}`,
        ],
        outputLabel: outLbl,
      };
    }

    case 'film-grain': {
      const strength = Math.max(3, Math.round(3 + k * 42));
      return {
        filterFragments: [
          `${inputLabel}noise=alls=${strength}:allf=t+u:enable='between(t,${s},${e})'${outLbl}`,
        ],
        outputLabel: outLbl,
      };
    }

    case 'glitch-rgb': {
      const shiftX = Math.max(2, Math.round(2 + k * 16));
      const shiftY = Math.max(1, Math.round(k * 4));
      const baseLbl = `[efx_rgb_a_${index}]`;
      const splitLbl = `[efx_rgb_b_${index}]`;
      const shiftedLbl = `[efx_rgb_s_${index}]`;
      return {
        filterFragments: [
          `${inputLabel}split${baseLbl}${splitLbl}`,
          `${splitLbl}format=rgba,rgbashift=rh=-${shiftX}:bh=${shiftX}:rv=${shiftY}:bv=-${shiftY},format=yuva420p${shiftedLbl}`,
          `${baseLbl}${shiftedLbl}overlay=enable='between(t,${s},${e})'${outLbl}`,
        ],
        outputLabel: outLbl,
      };
    }

    case 'camera-shake': {
      const keepRatio = (0.98 - k * 0.16).toFixed(3);
      const baseLbl = `[efx_shk_a_${index}]`;
      const splitLbl = `[efx_shk_b_${index}]`;
      const shookLbl = `[efx_shk_s_${index}]`;
      return {
        filterFragments: [
          `${inputLabel}split${baseLbl}${splitLbl}`,
          `${splitLbl}crop=w=trunc(iw*${keepRatio}/2)*2:h=trunc(ih*${keepRatio}/2)*2:x='(iw-ow)/2+sin(t*35)*(iw-ow)/2':y='(ih-oh)/2+cos(t*43)*(ih-oh)/2',scale=${w}:${h},setsar=1${shookLbl}`,
          `${baseLbl}${shookLbl}overlay=enable='between(t,${s},${e})'${outLbl}`,
        ],
        outputLabel: outLbl,
      };
    }

    case 'bw': {
      const sat = (1 - k).toFixed(2);
      return {
        filterFragments: [`${inputLabel}hue=s=${sat}:enable='between(t,${s},${e})'${outLbl}`],
        outputLabel: outLbl,
      };
    }

    case 'sepia': {
      const rr = (1 - k + k * 0.393).toFixed(3);
      const rg = (k * 0.769).toFixed(3);
      const rb = (k * 0.189).toFixed(3);
      const gr = (k * 0.349).toFixed(3);
      const gg = (1 - k + k * 0.686).toFixed(3);
      const gb = (k * 0.168).toFixed(3);
      const br = (k * 0.272).toFixed(3);
      const bg = (k * 0.534).toFixed(3);
      const bb = (1 - k + k * 0.131).toFixed(3);
      return {
        filterFragments: [
          `${inputLabel}colorchannelmixer=${rr}:${rg}:${rb}:0:${gr}:${gg}:${gb}:0:${br}:${bg}:${bb}:enable='between(t,${s},${e})'${outLbl}`,
        ],
        outputLabel: outLbl,
      };
    }

    case 'invert': {
      return {
        filterFragments: [`${inputLabel}negate=enable='between(t,${s},${e})'${outLbl}`],
        outputLabel: outLbl,
      };
    }

    case 'pixelate': {
      const block = Math.max(2, Math.round(2 + k * 34));
      return {
        filterFragments: [
          `${inputLabel}pixelize=width=${block}:height=${block}:enable='between(t,${s},${e})'${outLbl}`,
        ],
        outputLabel: outLbl,
      };
    }

    case 'mirror': {
      return {
        filterFragments: [`${inputLabel}hflip=enable='between(t,${s},${e})'${outLbl}`],
        outputLabel: outLbl,
      };
    }

    case 'flash': {
      const half = fmtSec(durNum / 2);
      const durStr = fmtSec(durNum);
      const alpha = k.toFixed(2);
      const safeFps = Math.max(15, Math.min(60, Math.round(fps)));
      const flLbl = `[efx_fl_${index}]`;
      return {
        filterFragments: [
          `color=c=white:s=${w}x${h}:d=${durStr}:r=${safeFps},format=yuva420p,colorchannelmixer=aa=${alpha},fade=t=in:st=0:d=${half}:alpha=1,fade=t=out:st=${half}:d=${half}:alpha=1,setpts=PTS+${s}/TB${flLbl}`,
          `${inputLabel}${flLbl}overlay=enable='between(t,${s},${e})':eof_action=pass${outLbl}`,
        ],
        outputLabel: outLbl,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Video Transitions (xfade + acrossfade synchronized with timeline)
// ---------------------------------------------------------------------------

export const VIDEO_TRANSITION_META: Record<
  VideoTransitionType,
  { label: string; xfadeName: string | null }
> = {
  none: { label: 'None', xfadeName: null },
  fade: { label: 'Fade', xfadeName: 'fade' },
  dissolve: { label: 'Dissolve', xfadeName: 'dissolve' },
  'wipe-left': { label: 'Wipe Left', xfadeName: 'wipeleft' },
  'wipe-right': { label: 'Wipe Right', xfadeName: 'wiperight' },
  'slide-left': { label: 'Slide Left', xfadeName: 'slideleft' },
  'slide-right': { label: 'Slide Right', xfadeName: 'slideright' },
};

export function normalizeVideoTransition(
  transition: VideoTransition | undefined
): VideoTransition | undefined {
  if (!transition || transition.type === 'none') return undefined;
  const type = ALLOWED_VIDEO_TRANSITIONS.includes(transition.type) ? transition.type : 'none';
  if (type === 'none') return undefined;
  const rawDur =
    typeof transition.duration === 'number' && Number.isFinite(transition.duration)
      ? transition.duration
      : DEFAULT_TRANSITION_DURATION_SECONDS;
  const duration = Math.max(
    MIN_TRANSITION_DURATION_SECONDS,
    Math.min(MAX_TRANSITION_DURATION_SECONDS, Number(rawDur.toFixed(2)))
  );
  return { type, duration };
}

export function validateVideoTransition(
  transition: VideoTransition | undefined
): ValidationResult<VideoTransition | undefined> {
  if (!transition || transition.type === 'none') {
    return { ok: true, value: undefined };
  }
  if (!ALLOWED_VIDEO_TRANSITIONS.includes(transition.type)) {
    return {
      ok: false,
      code: 'INVALID_TOOL_CONFIG',
      error: `Unsupported video transition "${transition.type}".`,
    };
  }
  if (
    !Number.isFinite(transition.duration) ||
    transition.duration < MIN_TRANSITION_DURATION_SECONDS ||
    transition.duration > MAX_TRANSITION_DURATION_SECONDS
  ) {
    return {
      ok: false,
      code: 'INVALID_TOOL_CONFIG',
      error: `Transition duration must be between ${MIN_TRANSITION_DURATION_SECONDS} and ${MAX_TRANSITION_DURATION_SECONDS} s.`,
    };
  }
  return { ok: true, value: transition };
}

/**
 * Returns the clamped transition overlap duration between two touching VideoClips.
 * Capped at 45% of the shorter clip so back-to-back transitions never invert or overlap.
 */
export function getEffectiveTransitionDuration(
  prevClip: Pick<VideoClip, 'duration' | 'transitionOut'>,
  nextClip: Pick<VideoClip, 'duration'>
): number {
  const tr = prevClip.transitionOut;
  if (!tr || tr.type === 'none') return 0;
  const requested = Math.max(
    MIN_TRANSITION_DURATION_SECONDS,
    Math.min(MAX_TRANSITION_DURATION_SECONDS, tr.duration)
  );
  const maxSafeOverlap = Math.min(prevClip.duration, nextClip.duration) * 0.45;
  if (maxSafeOverlap < MIN_TRANSITION_DURATION_SECONDS) {
    return 0;
  }
  return Number(Math.min(requested, maxSafeOverlap).toFixed(3));
}

/**
 * Compiles a sequential video clip list into pairwise `xfade` / `concat` video filters
 * and matching `acrossfade` / `concat` audio filters so A/V duration stays exact.
 */
export function compileVideoTransitionsChain(params: {
  videoSegLabels: string[];
  videoClips: VideoClip[];
  audioSegLabels?: string[];
}): {
  videoFilterParts: string[];
  videoOutputLabel: string | null;
  audioFilterParts: string[];
  audioOutputLabel: string | null;
  totalDuration: number;
} {
  const { videoSegLabels, videoClips, audioSegLabels } = params;
  const videoFilterParts: string[] = [];
  const audioFilterParts: string[] = [];

  if (videoSegLabels.length === 0) {
    return {
      videoFilterParts,
      videoOutputLabel: null,
      audioFilterParts,
      audioOutputLabel: null,
      totalDuration: 0,
    };
  }

  if (videoSegLabels.length === 1) {
    return {
      videoFilterParts,
      videoOutputLabel: videoSegLabels[0],
      audioFilterParts,
      audioOutputLabel: audioSegLabels?.[0] ?? null,
      totalDuration: videoClips[0]?.duration ?? 0,
    };
  }

  const hasAnyActiveTransition = videoClips.slice(0, -1).some((prevClip, idx) => {
    const nextClip = videoClips[idx + 1];
    const trMeta = prevClip.transitionOut ? VIDEO_TRANSITION_META[prevClip.transitionOut.type] : null;
    return Boolean(trMeta?.xfadeName) && getEffectiveTransitionDuration(prevClip, nextClip) > 0;
  });

  if (!hasAnyActiveTransition) {
    videoFilterParts.push(
      `${videoSegLabels.join('')}concat=n=${videoSegLabels.length}:v=1:a=0[vbase]`
    );
    let audioOutputLabel: string | null = null;
    if (audioSegLabels && audioSegLabels.length === videoSegLabels.length) {
      audioFilterParts.push(
        `${audioSegLabels.join('')}concat=n=${audioSegLabels.length}:v=0:a=1[aorig]`
      );
      audioOutputLabel = '[aorig]';
    }
    const totalDuration = videoClips.reduce((sum, c) => sum + c.duration, 0);
    return {
      videoFilterParts,
      videoOutputLabel: '[vbase]',
      audioFilterParts,
      audioOutputLabel,
      totalDuration,
    };
  }

  let currentVideo = videoSegLabels[0];
  let currentAudio = audioSegLabels?.[0] ?? null;
  let cumulativeDuration = videoClips[0].duration;

  for (let i = 1; i < videoSegLabels.length; i++) {
    const prevClip = videoClips[i - 1];
    const nextClip = videoClips[i];
    const effDur = getEffectiveTransitionDuration(prevClip, nextClip);
    const trMeta = prevClip.transitionOut ? VIDEO_TRANSITION_META[prevClip.transitionOut.type] : null;
    const xfadeName = trMeta?.xfadeName ?? null;
    const isLast = i === videoSegLabels.length - 1;
    const nextVideoLbl = isLast ? '[vbase]' : `[vtr_${i}]`;

    if (effDur > 0 && xfadeName) {
      const offset = Math.max(0, cumulativeDuration - effDur);
      videoFilterParts.push(
        `${currentVideo}${videoSegLabels[i]}xfade=transition=${xfadeName}:duration=${fmtSec(effDur)}:offset=${fmtSec(offset)}${nextVideoLbl}`
      );
      if (currentAudio && audioSegLabels?.[i]) {
        const nextAudioLbl = isLast ? '[aorig]' : `[atr_${i}]`;
        audioFilterParts.push(
          `${currentAudio}${audioSegLabels[i]}acrossfade=d=${fmtSec(effDur)}:c1=tri:c2=tri${nextAudioLbl}`
        );
        currentAudio = nextAudioLbl;
      }
      cumulativeDuration += nextClip.duration - effDur;
    } else {
      videoFilterParts.push(
        `${currentVideo}${videoSegLabels[i]}concat=n=2:v=1:a=0${nextVideoLbl}`
      );
      if (currentAudio && audioSegLabels?.[i]) {
        const nextAudioLbl = isLast ? '[aorig]' : `[atr_${i}]`;
        audioFilterParts.push(
          `${currentAudio}${audioSegLabels[i]}concat=n=2:v=0:a=1${nextAudioLbl}`
        );
        currentAudio = nextAudioLbl;
      }
      cumulativeDuration += nextClip.duration;
    }

    currentVideo = nextVideoLbl;
  }

  return {
    videoFilterParts,
    videoOutputLabel: currentVideo,
    audioFilterParts,
    audioOutputLabel: currentAudio,
    totalDuration: cumulativeDuration,
  };
}

export function getHeavyExportWarningInfo(
  project: ProjectState,
  projectDuration: number
): { hasManyEffectsOnLongVideo: boolean; activeEffectCount: number } {
  let activeEffectCount = 0;
  for (const track of project.tracks) {
    if (track.kind !== 'effects' || track.hidden) continue;
    for (const clip of track.clips) {
      if (clip.type === 'effect' && clip.intensity > 0) {
        activeEffectCount += 1;
      }
    }
  }
  return {
    activeEffectCount,
    hasManyEffectsOnLongVideo:
      projectDuration > HEAVY_EFFECTS_WARNING_SECONDS &&
      activeEffectCount >= HEAVY_EFFECTS_MIN_COUNT,
  };
}
