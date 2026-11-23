import { describe, expect, it } from 'vitest';
import {
  ALLOWED_VIDEO_EFFECTS,
  ALLOWED_VIDEO_TRANSITIONS,
  buildDrawtextAnimationExpressions,
  buildEffectFilterChain,
  canUndo,
  clampEffectIntensity,
  compileProjectToFfmpegPlan,
  compileVideoTransitionsChain,
  createEffectClip,
  createEmptyProject,
  createInitialEditorState,
  createVideoClipFromMeta,
  DEFAULT_TEXT_ANIMATION_SECONDS,
  DRAFT_EXPORT_FPS,
  DRAFT_MAX_SHORT_SIDE,
  evaluateTextAnimationPreview,
  getEffectiveTransitionDuration,
  getHeavyExportWarningInfo,
  getProjectDuration,
  nextProjectId,
  projectReducer,
  resolveEffectiveAnimationDurations,
  resolveProjectCanvasDimensions,
  resolveTextClipAnimationConfig,
  TEXT_SLIDE_HORIZONTAL_PCT,
  TEXT_SLIDE_VERTICAL_PCT,
  validateEffectClip,
  validateProjectForExport,
  validateVideoTransition,
  type EffectClip,
  type MediaAsset,
  type TextClip,
  type VideoFileMetadata,
} from '../index';

function makeVideoMeta(overrides: Partial<VideoFileMetadata> = {}): VideoFileMetadata {
  return {
    name: 'clip.mp4',
    size: 4_000_000,
    mimeType: 'video/mp4',
    extension: 'mp4',
    duration: 12,
    width: 1920,
    height: 1080,
    ...overrides,
  };
}

function makeAssets(): Map<string, MediaAsset> {
  const map = new Map<string, MediaAsset>();
  map.set('asset_1', {
    id: 'asset_1',
    kind: 'video',
    name: 'clip1.mp4',
    size: 4_000_000,
    file: new File(['ftyp'], 'clip1.mp4', { type: 'video/mp4' }),
    objectUrl: 'blob:v1',
    duration: 12,
    width: 1920,
    height: 1080,
    extension: 'mp4',
  });
  map.set('asset_2', {
    id: 'asset_2',
    kind: 'video',
    name: 'clip2.mp4',
    size: 4_000_000,
    file: new File(['ftyp'], 'clip2.mp4', { type: 'video/mp4' }),
    objectUrl: 'blob:v2',
    duration: 10,
    width: 1920,
    height: 1080,
    extension: 'mp4',
  });
  map.set('asset_portrait', {
    id: 'asset_portrait',
    kind: 'video',
    name: 'portrait.mov',
    size: 4_000_000,
    file: new File(['ftyp'], 'portrait.mov', { type: 'video/quicktime' }),
    objectUrl: 'blob:vp',
    duration: 10,
    width: 1080,
    height: 1920,
    extension: 'mov',
  });
  return map;
}

describe('Text animation expression & preview builders', () => {
  it('builds deterministic drawtext alpha, fontsize, x, and y expressions with clip() bounds', () => {
    const fadePop = buildDrawtextAnimationExpressions({
      start: 2,
      duration: 4,
      baseFontSize: 48,
      baseXExpr: '(w-text_w)/2',
      baseYExpr: 'h*0.5-(text_h/2)',
      animInType: 'pop',
      animInDuration: 0.5,
      animOutType: 'fade',
      animOutDuration: 0.8,
    });

    expect(fadePop.alphaExpr).toContain('clip((6.000-t)/0.800\\,0\\,1)');
    expect(fadePop.fontsizeExpr).toContain('48*(0.2+0.8*clip((t-2.000)/0.500\\,0\\,1))');
    expect(fadePop.xExpr).toBe('(w-text_w)/2');
    expect(fadePop.yExpr).toBe('h*0.5-(text_h/2)');

    const slides = buildDrawtextAnimationExpressions({
      start: 1,
      duration: 3,
      baseFontSize: 36,
      baseXExpr: 'w*0.5',
      baseYExpr: 'h*0.8',
      animInType: 'slide-up',
      animInDuration: 0.5,
      animOutType: 'slide-left',
      animOutDuration: 0.5,
    });

    expect(slides.xExpr).toContain('(1-pow(clip((4.000-t)/0.500\\,0\\,1)\\,3))*w*0.20');
    expect(slides.yExpr).toContain('pow(clip(1-(t-1.000)/0.500\\,0\\,1)\\,3)*h*0.12');
    expect(slides.alphaExpr).toBe("'clip((t-1.000)/0.500\\,0\\,1)*clip((4.000-t)/0.500\\,0\\,1)'");
    expect(slides.fontsizeExpr).toBe('36');

    const slideInOnly = buildDrawtextAnimationExpressions({
      start: 2,
      duration: 4,
      baseFontSize: 36,
      baseXExpr: 'w*0.5',
      baseYExpr: 'h*0.5',
      animInType: 'slide-right',
      animInDuration: 0.5,
      animOutType: 'none',
      animOutDuration: 0.5,
    });
    expect(slideInOnly.alphaExpr).toBe("'clip((t-2.000)/0.500\\,0\\,1)'");

    const slideOutOnly = buildDrawtextAnimationExpressions({
      start: 2,
      duration: 4,
      baseFontSize: 36,
      baseXExpr: 'w*0.5',
      baseYExpr: 'h*0.5',
      animInType: 'none',
      animInDuration: 0.5,
      animOutType: 'slide-down',
      animOutDuration: 0.5,
    });
    expect(slideOutOnly.alphaExpr).toBe("'clip((6.000-t)/0.500\\,0\\,1)'");

    const mixedSlideFade = buildDrawtextAnimationExpressions({
      start: 1,
      duration: 3,
      baseFontSize: 36,
      baseXExpr: 'w*0.5',
      baseYExpr: 'h*0.5',
      animInType: 'slide-left',
      animInDuration: 0.5,
      animOutType: 'fade',
      animOutDuration: 0.6,
    });
    expect(mixedSlideFade.alphaExpr).toBe(
      "'clip((t-1.000)/0.500\\,0\\,1)*clip((4.000-t)/0.600\\,0\\,1)'"
    );

    const slideNoFade = buildDrawtextAnimationExpressions({
      start: 1,
      duration: 3,
      baseFontSize: 36,
      baseXExpr: 'w*0.5',
      baseYExpr: 'h*0.8',
      animInType: 'slide-up',
      animInDuration: 0.5,
      animOutType: 'slide-left',
      animOutDuration: 0.5,
      fadeWithSlide: false,
    });
    expect(slideNoFade.alphaExpr).toBeNull();

    const mixedSlideOffFadeOn = buildDrawtextAnimationExpressions({
      start: 1,
      duration: 3,
      baseFontSize: 36,
      baseXExpr: 'w*0.5',
      baseYExpr: 'h*0.5',
      animInType: 'slide-up',
      animInDuration: 0.5,
      animOutType: 'fade',
      animOutDuration: 0.6,
      fadeWithSlide: false,
    });
    expect(mixedSlideOffFadeOn.alphaExpr).toBe("'clip((4.000-t)/0.600\\,0\\,1)'");
  });

  it('defaults In/Out animation duration to 0.5 s, fadeWithSlide to true, and uses 20% width / 12% height constants', () => {
    expect(DEFAULT_TEXT_ANIMATION_SECONDS).toBe(0.5);
    expect(TEXT_SLIDE_HORIZONTAL_PCT).toBe(20);
    expect(TEXT_SLIDE_VERTICAL_PCT).toBe(12);

    const resolved = resolveTextClipAnimationConfig({
      id: 'txt_default',
      type: 'text',
      name: 'Default',
      start: 0,
      duration: 3,
      sourceOffset: 0,
      text: 'Hello',
      size: 'medium',
      color: 'white',
      backgroundBox: false,
      align: 'center',
      xPercent: 50,
      yPercent: 50,
    });
    expect(resolved.animInDuration).toBe(0.5);
    expect(resolved.animOutDuration).toBe(0.5);
    expect(resolved.fadeWithSlide).toBe(true);
  });

  it('scales down animation durations proportionally when animIn + animOut exceed clip duration', () => {
    const res = resolveEffectiveAnimationDurations({
      clipDuration: 1.0,
      animInType: 'fade',
      animInDuration: 1.5,
      animOutType: 'pop',
      animOutDuration: 1.5,
    });
    expect(res.inDuration + res.outDuration).toBeLessThanOrEqual(1.001);
    expect(res.inDuration).toBeCloseTo(0.5, 2);
    expect(res.outDuration).toBeCloseTo(0.5, 2);
  });

  it('evaluates CSS preview animation curve cleanly at start, middle, and end', () => {
    const clip: TextClip = {
      id: 'txt_1',
      type: 'text',
      name: 'Title',
      start: 2,
      duration: 4,
      sourceOffset: 0,
      text: 'Title',
      size: 'large',
      color: 'white',
      backgroundBox: false,
      align: 'center',
      xPercent: 50,
      yPercent: 50,
      animInType: 'fade',
      animInDuration: 1,
      animOutType: 'pop',
      animOutDuration: 1,
    };

    const atStart = evaluateTextAnimationPreview(clip, 2);
    expect(atStart.opacity).toBeCloseTo(0, 3);
    expect(atStart.scale).toBeCloseTo(1, 3);

    const atMid = evaluateTextAnimationPreview(clip, 4);
    expect(atMid.opacity).toBeCloseTo(1, 3);
    expect(atMid.scale).toBeCloseTo(1, 3);

    const atEnd = evaluateTextAnimationPreview(clip, 6);
    expect(atEnd.opacity).toBeCloseTo(1, 3);
    expect(atEnd.scale).toBeCloseTo(0.2, 3);
  });

  it('evaluates slide ease-out preview identically to ffmpeg (20% width / 12% height)', () => {
    const clip: TextClip = {
      id: 'txt_slide',
      type: 'text',
      name: 'Slide',
      start: 1,
      duration: 3,
      sourceOffset: 0,
      text: 'Slide',
      size: 'medium',
      color: 'white',
      backgroundBox: false,
      align: 'center',
      xPercent: 50,
      yPercent: 50,
      animInType: 'slide-up',
      animInDuration: 0.5,
      animOutType: 'slide-left',
      animOutDuration: 0.5,
    };

    // t=1.0: start of slide-up in (+12% frame height, opacity 0)
    const atInStart = evaluateTextAnimationPreview(clip, 1.0);
    expect(atInStart.offsetYPct).toBeCloseTo(12, 4);
    expect(atInStart.offsetXPct).toBeCloseTo(0, 4);
    expect(atInStart.opacity).toBeCloseTo(0, 4);

    // t=1.25 (50% of 0.5s in): cubic ease-out leaves 0.5^3 = 12.5% remaining (1.5%, not linear 6%), opacity 0.5
    const atInHalf = evaluateTextAnimationPreview(clip, 1.25);
    expect(atInHalf.offsetYPct).toBeCloseTo(1.5, 4);
    expect(atInHalf.opacity).toBeCloseTo(0.5, 4);

    // t=2.0: settled in center, opacity 1
    const atRest = evaluateTextAnimationPreview(clip, 2.0);
    expect(atRest.offsetXPct).toBeCloseTo(0, 4);
    expect(atRest.offsetYPct).toBeCloseTo(0, 4);
    expect(atRest.opacity).toBeCloseTo(1, 4);

    // t=3.75 (50% of 0.5s out): cubic ease-out reaches 1 - 0.5^3 = 87.5% of -20% (-17.5%), opacity 0.5
    const atOutHalf = evaluateTextAnimationPreview(clip, 3.75);
    expect(atOutHalf.offsetXPct).toBeCloseTo(-17.5, 4);
    expect(atOutHalf.opacity).toBeCloseTo(0.5, 4);

    // t=4.0: end of slide-left out (-20% frame width, opacity 0)
    const atOutEnd = evaluateTextAnimationPreview(clip, 4.0);
    expect(atOutEnd.offsetXPct).toBeCloseTo(-20, 4);
    expect(atOutEnd.opacity).toBeCloseTo(0, 4);

    // Mixed In=slide-up + Out=fade multiplies opacity factors
    const mixedClip: TextClip = {
      ...clip,
      duration: 1.0,
      animInType: 'slide-up',
      animInDuration: 0.6,
      animOutType: 'fade',
      animOutDuration: 0.6,
    };
    // Scaled proportionally to 0.5s in + 0.5s out; at t=1.25 -> inU=0.5, outV=1.0 -> opacity 0.5
    expect(evaluateTextAnimationPreview(mixedClip, 1.25).opacity).toBeCloseTo(0.5, 4);
    // At t=1.75 -> inU=1.0, outV=0.5 -> opacity 0.5
    expect(evaluateTextAnimationPreview(mixedClip, 1.75).opacity).toBeCloseTo(0.5, 4);

    // fadeWithSlide: false keeps opacity=1 during slide while preserving slide motion
    const slideNoFadeClip: TextClip = { ...clip, fadeWithSlide: false };
    const noFadeAtStart = evaluateTextAnimationPreview(slideNoFadeClip, 1.0);
    expect(noFadeAtStart.offsetYPct).toBeCloseTo(12, 4);
    expect(noFadeAtStart.opacity).toBeCloseTo(1, 4);
    expect(evaluateTextAnimationPreview(slideNoFadeClip, 4.0).opacity).toBeCloseTo(1, 4);
  });
});

describe('VFX effect filter builders and validation', () => {
  it('clamps effect intensity between 0 and 100 and skips filter generation at intensity 0', () => {
    expect(clampEffectIntensity(-20)).toBe(0);
    expect(clampEffectIntensity(140)).toBe(100);

    const zeroClip = createEffectClip({
      id: 'efx_zero',
      effectType: 'blur',
      start: 1,
      duration: 2,
      intensity: 0,
    });
    expect(
      buildEffectFilterChain({
        inputLabel: '[v0]',
        effect: zeroClip,
        width: 1280,
        height: 720,
        fps: 30,
        index: 0,
      })
    ).toBeNull();
  });

  it('generates valid time-bounded filter fragments for every supported VFX type', () => {
    let label = '[vbase]';
    ALLOWED_VIDEO_EFFECTS.forEach((effectType, idx) => {
      const clip = createEffectClip({
        id: `efx_${idx}`,
        effectType,
        start: 1.5,
        duration: 2.5,
        intensity: 75,
      });
      const built = buildEffectFilterChain({
        inputLabel: label,
        effect: clip,
        width: 1920,
        height: 1080,
        fps: 30,
        index: idx,
      });
      expect(built).not.toBeNull();
      expect(built!.filterFragments.length).toBeGreaterThan(0);
      expect(built!.filterFragments.join(';')).toContain('between(t,1.500,4.000)');
      expect(built!.outputLabel).toBe(`[vefx${idx}]`);
      label = built!.outputLabel;
    });
  });

  it('rejects invalid effect type, negative start, short duration, or out-of-range intensity', () => {
    const valid = createEffectClip({ id: 'e1', effectType: 'sepia', start: 0, duration: 2, intensity: 60 });
    expect(validateEffectClip(valid).ok).toBe(true);

    expect(
      validateEffectClip({ ...valid, start: -0.2 }).ok
    ).toBe(false);
    expect(
      validateEffectClip({ ...valid, duration: 0.05 }).ok
    ).toBe(false);
    expect(
      validateEffectClip({ ...valid, intensity: 105 }).ok
    ).toBe(false);
    expect(
      validateEffectClip({ ...valid, effectType: 'nonexistent' as EffectClip['effectType'] }).ok
    ).toBe(false);
  });
});

describe('Video transition compiler & validators', () => {
  it('validates transition config and caps effective overlap at 45% of shorter clip', () => {
    expect(validateVideoTransition(undefined).ok).toBe(true);
    expect(validateVideoTransition({ type: 'fade', duration: 0.6 }).ok).toBe(true);
    expect(validateVideoTransition({ type: 'fade', duration: 0.05 }).ok).toBe(false);
    expect(validateVideoTransition({ type: 'fade', duration: 4 }).ok).toBe(false);
    expect(
      validateVideoTransition({ type: 'swirl' as 'fade', duration: 0.6 }).ok
    ).toBe(false);

    const shortPrev = createVideoClipFromMeta(makeVideoMeta({ duration: 1 }), 'asset_1', 0);
    shortPrev.transitionOut = { type: 'dissolve', duration: 2 };
    const longNext = createVideoClipFromMeta(makeVideoMeta({ duration: 8 }), 'asset_2', 0);
    // 45% of 1.0s = 0.45s
    expect(getEffectiveTransitionDuration(shortPrev, longNext)).toBeCloseTo(0.45, 2);
  });

  it('compiles pairwise xfade + acrossfade and mixed concat cleanly for multi-clip timelines', () => {
    const c1 = createVideoClipFromMeta(makeVideoMeta({ duration: 4 }), 'asset_1', 0);
    c1.transitionOut = { type: 'wipe-left', duration: 1.0 };
    const c2 = createVideoClipFromMeta(makeVideoMeta({ duration: 5 }), 'asset_2', 3);
    // c2 has no transitionOut -> concat to c3
    const c3 = createVideoClipFromMeta(makeVideoMeta({ duration: 3 }), 'asset_1', 8);

    const chain = compileVideoTransitionsChain({
      videoSegLabels: ['[vc0]', '[vc1]', '[vc2]'],
      videoClips: [c1, c2, c3],
      audioSegLabels: ['[ac0]', '[ac1]', '[ac2]'],
    });

    expect(chain.videoFilterParts).toHaveLength(2);
    expect(chain.videoFilterParts[0]).toContain(
      'xfade=transition=wipeleft:duration=1.000:offset=3.000'
    );
    expect(chain.videoFilterParts[1]).toContain('concat=n=2:v=1:a=0');

    expect(chain.audioFilterParts).toHaveLength(2);
    expect(chain.audioFilterParts[0]).toContain('acrossfade=d=1.000:c1=tri:c2=tri');
    expect(chain.audioFilterParts[1]).toContain('concat=n=2:v=0:a=1');

    // Total = 4 + 5 - 1 + 3 = 11s
    expect(chain.totalDuration).toBeCloseTo(11, 3);
    expect(ALLOWED_VIDEO_TRANSITIONS).toContain('slide-right');
  });
});

describe('projectReducer Effects track, transitions & caption animation sync', () => {
  it('supports adding, auto-stacking, moving, resizing, and undoing EffectClips', () => {
    let state = createInitialEditorState();
    const e1 = createEffectClip({ id: nextProjectId('efx'), effectType: 'blur', start: 1, duration: 3, intensity: 50 });
    const e2 = createEffectClip({ id: nextProjectId('efx'), effectType: 'bw', start: 2, duration: 2, intensity: 100 });

    state = projectReducer(state, { type: 'ADD_CLIP', clip: e1 });
    state = projectReducer(state, { type: 'ADD_CLIP', clip: e2 });

    const effectTracks = state.history.present.tracks.filter((t) => t.kind === 'effects');
    // Overlapping effect clips auto-stack onto a second Effects row
    expect(effectTracks).toHaveLength(2);
    expect(effectTracks[0].clips).toHaveLength(1);
    expect(effectTracks[1].clips).toHaveLength(1);

    state = projectReducer(state, { type: 'MOVE_CLIP', clipId: e1.id, start: 4 });
    expect(state.history.present.tracks.find((t) => t.id === effectTracks[0].id)?.clips[0].start).toBe(4);

    state = projectReducer(state, { type: 'RESIZE_CLIP', clipId: e1.id, edge: 'right', time: 8.5 });
    expect(state.history.present.tracks.find((t) => t.id === effectTracks[0].id)?.clips[0].duration).toBeCloseTo(4.5, 3);

    expect(canUndo(state.history)).toBe(true);
    state = projectReducer(state, { type: 'UNDO' });
    expect(state.history.present.tracks.find((t) => t.id === effectTracks[0].id)?.clips[0].duration).toBe(3);
  });

  it('ripples Video track and shifts non-video clips on SET_VIDEO_TRANSITION with clean Undo', () => {
    let state = createInitialEditorState();
    const v1 = createVideoClipFromMeta(makeVideoMeta({ duration: 5 }), 'asset_1');
    const v2 = createVideoClipFromMeta(makeVideoMeta({ duration: 5 }), 'asset_2');
    state = projectReducer(state, { type: 'ADD_CLIP', clip: v1 });
    state = projectReducer(state, { type: 'ADD_CLIP', clip: v2 });

    const efx = createEffectClip({ id: 'efx_after', effectType: 'invert', start: 6, duration: 2, intensity: 100 });
    state = projectReducer(state, { type: 'ADD_CLIP', clip: efx });

    state = projectReducer(state, {
      type: 'SET_VIDEO_TRANSITION',
      clipId: v1.id,
      transition: { type: 'fade', duration: 1.0 },
    });

    const videoTrack = state.history.present.tracks.find((t) => t.kind === 'video')!;
    expect(videoTrack.clips[1].start).toBeCloseTo(4, 3);
    expect(getProjectDuration(state.history.present)).toBeCloseTo(9, 3);

    // Effect starting after the cut (6s >= 5s) shifted earlier by -1s to stay synced!
    const shiftedEffect = state.history.present.tracks.find((t) => t.kind === 'effects')!.clips[0];
    expect(shiftedEffect.start).toBeCloseTo(5, 3);

    // Single Undo restores original non-overlapped start times
    state = projectReducer(state, { type: 'UNDO' });
    expect(state.history.present.tracks.find((t) => t.kind === 'video')!.clips[1].start).toBe(5);
    expect(state.history.present.tracks.find((t) => t.kind === 'effects')!.clips[0].start).toBe(6);
  });

  it('applies animation preset across all caption clips via APPLY_ANIMATION_TO_ALL_CAPTIONS', () => {
    let state = createInitialEditorState();
    state = projectReducer(state, {
      type: 'SET_CAPTION_CLIPS',
      captions: [
        { id: 'c1', start: 0, end: 2, text: 'First' },
        { id: 'c2', start: 2.2, end: 4.5, text: 'Second' },
      ],
    });

    state = projectReducer(state, {
      type: 'APPLY_ANIMATION_TO_ALL_CAPTIONS',
      animInType: 'slide-up',
      animInDuration: 0.3,
      animOutType: 'fade',
      animOutDuration: 0.4,
      fadeWithSlide: false,
    });

    const captionsTrack = state.history.present.tracks.find((t) => t.kind === 'captions')!;
    for (const clip of captionsTrack.clips) {
      expect(clip.type).toBe('text');
      if (clip.type === 'text') {
        expect(clip.animInType).toBe('slide-up');
        expect(clip.animInDuration).toBe(0.3);
        expect(clip.animOutType).toBe('fade');
        expect(clip.animOutDuration).toBe(0.4);
        expect(clip.fadeWithSlide).toBe(false);
      }
    }

    // Undo restores previous caption animation settings
    state = projectReducer(state, { type: 'UNDO' });
    const restoredTrack = state.history.present.tracks.find((t) => t.kind === 'captions')!;
    for (const clip of restoredTrack.clips) {
      if (clip.type === 'text') {
        expect(clip.animInType).toBeUndefined();
        expect(clip.fadeWithSlide).toBeUndefined();
      }
    }
  });

  it('defaults fadeWithSlide to ON for new slide animations and supports undo/redo', () => {
    let state = createInitialEditorState();
    const txt: TextClip = {
      id: 'txt_fade_default',
      type: 'text',
      name: 'Sample',
      start: 0,
      duration: 3,
      sourceOffset: 0,
      text: 'Sample',
      size: 'medium',
      color: 'white',
      backgroundBox: true,
      align: 'center',
      xPercent: 50,
      yPercent: 50,
    };
    state = projectReducer(state, { type: 'ADD_CLIP', clip: txt });

    // Selecting a slide animation defaults fadeWithSlide to true
    state = projectReducer(state, {
      type: 'UPDATE_CLIP_PROPS',
      clipId: txt.id,
      patch: { animInType: 'slide-left' },
    });
    const getText = () =>
      state.history.present.tracks.find((t) => t.kind === 'text')?.clips[0] as TextClip;
    expect(getText().animInType).toBe('slide-left');
    expect(getText().fadeWithSlide).toBe(true);

    // Unchecking "Fade with slide" sets false, and Undo/Redo toggles it cleanly
    state = projectReducer(state, {
      type: 'UPDATE_CLIP_PROPS',
      clipId: txt.id,
      patch: { fadeWithSlide: false },
    });
    expect(getText().fadeWithSlide).toBe(false);

    state = projectReducer(state, { type: 'UNDO' });
    expect(getText().fadeWithSlide).toBe(true);

    state = projectReducer(state, { type: 'REDO' });
    expect(getText().fadeWithSlide).toBe(false);
  });
});

describe('Draft export dimensions, project compiler, and heavy-export warning', () => {
  it('caps short side at 480px and 24fps in Draft quality for both landscape and portrait projects', () => {
    const project = createEmptyProject('DraftTest');
    project.exportSettings.quality = 'draft';
    const assets = makeAssets();

    const landscapeDims = resolveProjectCanvasDimensions({
      project,
      assets,
      videoClips: [createVideoClipFromMeta(makeVideoMeta({ width: 1920, height: 1080 }), 'asset_1')],
    });
    expect(Math.min(landscapeDims.width, landscapeDims.height)).toBe(DRAFT_MAX_SHORT_SIDE);
    expect(landscapeDims.width).toBe(852);
    expect(landscapeDims.height).toBe(480);

    const portraitDims = resolveProjectCanvasDimensions({
      project,
      assets,
      videoClips: [createVideoClipFromMeta(makeVideoMeta({ width: 1080, height: 1920 }), 'asset_portrait')],
    });
    expect(portraitDims.width).toBe(480);
    expect(portraitDims.height).toBe(852);

    const v1 = createVideoClipFromMeta(makeVideoMeta({ duration: 5 }), 'asset_1', 0);
    project.tracks[0].clips = [v1];
    const plan = compileProjectToFfmpegPlan({
      project,
      assets,
      videoWidth: 1920,
      videoHeight: 1080,
      hasSourceAudio: true,
    });
    expect(plan.effectiveMode).toBe('precise');
    expect(plan.args.join(' ')).toContain(`fps=${DRAFT_EXPORT_FPS}`);
    expect(plan.args.join(' ')).toContain('852:480');
    expect(plan.args).toContain('30'); // Draft CRF 30
  });

  it('compiles animated text + 2 effects + 1 transition end-to-end into deterministic ffmpeg args', () => {
    let state = createInitialEditorState();
    const v1 = createVideoClipFromMeta(makeVideoMeta({ duration: 5 }), 'asset_1');
    const v2 = createVideoClipFromMeta(makeVideoMeta({ duration: 5 }), 'asset_2');
    state = projectReducer(state, { type: 'ADD_CLIP', clip: v1 });
    state = projectReducer(state, { type: 'ADD_CLIP', clip: v2 });
    state = projectReducer(state, {
      type: 'SET_VIDEO_TRANSITION',
      clipId: v1.id,
      transition: { type: 'dissolve', duration: 0.8 },
    });
    state = projectReducer(state, {
      type: 'ADD_CLIP',
      clip: createEffectClip({ id: 'e1', effectType: 'blur', start: 0.5, duration: 2, intensity: 50 }),
    });
    state = projectReducer(state, {
      type: 'ADD_CLIP',
      clip: createEffectClip({ id: 'e2', effectType: 'vignette', start: 4.5, duration: 3, intensity: 70 }),
    });
    state = projectReducer(state, {
      type: 'ADD_CLIP',
      clip: {
        id: 't1',
        type: 'text',
        name: 'Intro Title',
        start: 1,
        duration: 4,
        sourceOffset: 0,
        text: 'Hello Studio!',
        size: 'large',
        color: 'white',
        backgroundBox: true,
        align: 'center',
        xPercent: 50,
        yPercent: 50,
        animInType: 'pop',
        animInDuration: 0.4,
        animOutType: 'fade',
        animOutDuration: 0.5,
      },
    });

    const assets = makeAssets();
    expect(validateProjectForExport(state.history.present, assets).ok).toBe(true);

    const plan = compileProjectToFfmpegPlan({
      project: state.history.present,
      assets,
      videoWidth: 1920,
      videoHeight: 1080,
      hasSourceAudio: true,
    });

    expect(plan.requiresFont).toBe(true);
    expect(plan.textFiles).toHaveLength(1);
    const fcIndex = plan.args.indexOf('-filter_complex');
    expect(fcIndex).toBeGreaterThan(-1);
    const fc = plan.args[fcIndex + 1];
    expect(fc).toContain('xfade=transition=dissolve');
    expect(fc).toContain('acrossfade=');
    expect(fc).toContain('gblur=');
    expect(fc).toContain('vignette=');
    expect(fc).toContain('drawtext=');
    // User text must NOT appear inline inside ffmpeg filtergraph string
    expect(fc).not.toContain('Hello Studio!');
  });

  it('flags heavy-effects warning only when >= 3 active effects are combined with > 60s duration', () => {
    const project = createEmptyProject();
    const effectsTrack = project.tracks.find((t) => t.kind === 'effects')!;
    effectsTrack.clips = [
      createEffectClip({ id: 'e1', effectType: 'blur', start: 0, duration: 5, intensity: 40 }),
      createEffectClip({ id: 'e2', effectType: 'bw', start: 10, duration: 5, intensity: 100 }),
      createEffectClip({ id: 'e3', effectType: 'vignette', start: 20, duration: 5, intensity: 60 }),
    ];

    expect(getHeavyExportWarningInfo(project, 45).hasManyEffectsOnLongVideo).toBe(false);
    expect(getHeavyExportWarningInfo(project, 75).hasManyEffectsOnLongVideo).toBe(true);

    // Zero-intensity effects don't count
    (effectsTrack.clips[2] as EffectClip).intensity = 0;
    expect(getHeavyExportWarningInfo(project, 75).hasManyEffectsOnLongVideo).toBe(false);
  });
});
