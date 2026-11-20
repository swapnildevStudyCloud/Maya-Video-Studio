import { describe, expect, it } from 'vitest';
import {
  compileProjectToFfmpegPlan,
  createEmptyProject,
  createInitialEditorState,
  createProjectWithVideo,
  createVideoClipFromMeta,
  isSingleSimpleVideoClipProject,
  projectReducer,
  projectToCaptions,
  resolveProjectCanvasDimensions,
  validateProjectForExport,
  type AudioClip,
  type ImageClip,
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
    duration: 20,
    width: 1920,
    height: 1080,
    ...overrides,
  };
}

function makeAssets(meta = makeVideoMeta()): Map<string, MediaAsset> {
  const map = new Map<string, MediaAsset>();
  map.set('asset_v1', {
    id: 'asset_v1',
    kind: 'video',
    name: meta.name,
    size: meta.size,
    file: new File(['ftyp'], meta.name, { type: 'video/mp4' }),
    objectUrl: 'blob:video',
    duration: meta.duration,
    width: meta.width,
    height: meta.height,
    extension: meta.extension,
  });
  map.set('asset_v2', {
    id: 'asset_v2',
    kind: 'video',
    name: 'portrait.mov',
    size: 3_000_000,
    file: new File(['ftyp'], 'portrait.mov', { type: 'video/quicktime' }),
    objectUrl: 'blob:video2',
    duration: 10,
    width: 1080,
    height: 1920,
    extension: 'mov',
  });
  map.set('asset_v3', {
    id: 'asset_v3',
    kind: 'video',
    name: 'square.mp4',
    size: 2_000_000,
    file: new File(['ftyp'], 'square.mp4', { type: 'video/mp4' }),
    objectUrl: 'blob:video3',
    duration: 8,
    width: 720,
    height: 720,
    extension: 'mp4',
  });
  map.set('asset_img1', {
    id: 'asset_img1',
    kind: 'image',
    name: 'watermark.png',
    size: 1024,
    file: new File(['png'], 'watermark.png', { type: 'image/png' }),
    objectUrl: 'blob:img',
    format: 'png',
    width: 200,
    height: 100,
  });
  map.set('asset_aud1', {
    id: 'asset_aud1',
    kind: 'audio',
    name: 'bgm.mp3',
    size: 2048,
    file: new File(['ID3'], 'bgm.mp3', { type: 'audio/mpeg' }),
    objectUrl: 'blob:aud',
    format: 'mp3',
    duration: 15,
    waveform: [0.5, 0.7],
  });
  return map;
}

describe('projectCompiler', () => {
  it('uses Fast stream copy shortcut for a single untouched video clip', () => {
    const project = createProjectWithVideo(makeVideoMeta(), 'asset_v1');
    const assets = makeAssets();

    expect(isSingleSimpleVideoClipProject(project)).toBe(true);
    const plan = compileProjectToFfmpegPlan({
      project,
      assets,
      videoWidth: 1920,
      videoHeight: 1080,
      hasSourceAudio: true,
    });

    expect(plan.effectiveMode).toBe('fast');
    expect(plan.forcedPrecise).toBe(false);
    expect(plan.requiresFont).toBe(false);
    expect(plan.args).toContain('-c');
    expect(plan.args).toContain('copy');
  });

  it('compiles split ripple video with transforms, textfile drawtext, image overlay, audio mix, and deduplicated video input', () => {
    const meta = makeVideoMeta({ duration: 20 });
    let state = createInitialEditorState();
    state = projectReducer(state, {
      type: 'LOAD_VIDEO_PROJECT',
      meta,
      assetId: 'asset_v1',
    });
    const vidId = state.selectedClipId!;
    state = projectReducer(state, { type: 'SET_PLAYHEAD', time: 5 });
    state = projectReducer(state, { type: 'SPLIT_CLIP_AT_PLAYHEAD', clipId: vidId });

    const videoClips = state.history.present.tracks.find((t) => t.kind === 'video')!.clips;
    // Add filter + transforms to first segment
    state = projectReducer(state, {
      type: 'UPDATE_CLIP_PROPS',
      clipId: videoClips[0].id,
      patch: {
        rotationDegrees: 90,
        flipHorizontal: true,
        cropAspect: '1:1',
        colorFilter: { preset: 'bw', brightness: 0.1, contrast: 1.2, saturation: 1 },
      },
    });

    const dangerousUserText = "100% %{pts} 'quoted:text'";
    const textClip: TextClip = {
      id: 'txt_1',
      type: 'text',
      name: 'Overlay',
      start: 3,
      duration: 4,
      sourceOffset: 0,
      text: dangerousUserText,
      size: 'large',
      color: 'yellow',
      backgroundBox: true,
      align: 'left',
      xPercent: 25,
      yPercent: 75,
    };
    const imgClip: ImageClip = {
      id: 'img_1',
      type: 'image',
      assetId: 'asset_img1',
      name: 'logo',
      format: 'png',
      start: 0,
      duration: 6,
      sourceOffset: 0,
      xPercent: 90,
      yPercent: 10,
      sizePercent: 20,
      opacityPercent: 80,
    };
    const audioClip: AudioClip = {
      id: 'aud_1',
      type: 'audio',
      assetId: 'asset_aud1',
      name: 'bgm.mp3',
      format: 'mp3',
      start: 2,
      duration: 8,
      sourceOffset: 0,
      sourceDuration: 15,
      volumePercent: 75,
      muted: false,
      loop: true,
      fadeInSeconds: 1,
      fadeOutSeconds: 1,
    };

    state = projectReducer(state, { type: 'ADD_CLIP', clip: textClip });
    state = projectReducer(state, { type: 'ADD_CLIP', clip: imgClip });
    state = projectReducer(state, { type: 'ADD_CLIP', clip: audioClip });

    const plan = compileProjectToFfmpegPlan({
      project: state.history.present,
      assets: makeAssets(meta),
      videoWidth: 1920,
      videoHeight: 1080,
      hasSourceAudio: true,
    });

    expect(plan.effectiveMode).toBe('precise');
    expect(plan.forcedPrecise).toBe(true);
    expect(plan.requiresFont).toBe(true);
    expect(plan.textFiles).toEqual([{ path: 'text_0.txt', content: dangerousUserText }]);
    // Single source asset_v1 used by two split clips is registered ONCE as vid_src_0.mp4
    expect(plan.extraMediaFiles.map((m) => m.internalPath)).toEqual([
      'vid_src_0.mp4',
      'audio_clip_0.mp3',
      'overlay_img_0.png',
    ]);

    const joinedArgs = plan.args.join(' ');
    expect(joinedArgs).not.toContain(dangerousUserText);
    expect(joinedArgs).toContain('textfile=text_0.txt:expansion=none');
    expect(joinedArgs).toContain('fps=30,setsar=1');
    expect(joinedArgs).toContain('concat=n=2:v=1:a=0');
    expect(joinedArgs).toContain('overlay=');
    expect(joinedArgs).toContain('-stream_loop -1');
    expect(joinedArgs).toContain('amix=inputs=2');
    expect(joinedArgs).toContain('adelay=2000|2000');
  });

  it('compiles 3 mixed-resolution clips with Fit vs Fill scaling, normalized fps/audio, and silence for silent clips', () => {
    const assets = makeAssets();
    let state = createInitialEditorState();

    state = projectReducer(state, {
      type: 'ADD_CLIP',
      clip: createVideoClipFromMeta(makeVideoMeta({ name: 'clip1.mp4', width: 1920, height: 1080, duration: 5 }), 'asset_v1'),
    });
    state = projectReducer(state, {
      type: 'ADD_CLIP',
      clip: createVideoClipFromMeta(makeVideoMeta({ name: 'portrait.mov', extension: 'mov', width: 1080, height: 1920, duration: 4 }), 'asset_v2'),
    });
    state = projectReducer(state, {
      type: 'ADD_CLIP',
      clip: createVideoClipFromMeta(makeVideoMeta({ name: 'square.mp4', width: 720, height: 720, duration: 3 }), 'asset_v3'),
    });

    // Clip 2 (asset_v2) has NO audio stream
    const audioPresence = new Map<string, boolean>([
      ['asset_v1', true],
      ['asset_v2', false],
      ['asset_v3', true],
    ]);

    // Check canvas dimension presets
    expect(
      resolveProjectCanvasDimensions({
        project: state.history.present,
        assets,
        videoClips: state.history.present.tracks[0].clips.filter((c) => c.type === 'video'),
      })
    ).toEqual({ width: 1920, height: 1080 });

    state = projectReducer(state, {
      type: 'SET_EXPORT_SETTINGS',
      settings: {
        ...state.history.present.exportSettings,
        canvasPreset: '9:16',
        canvasFit: 'fit',
      },
    });

    const fitPlan = compileProjectToFfmpegPlan({
      project: state.history.present,
      assets,
      videoAudioPresence: audioPresence,
    });

    expect(fitPlan.extraMediaFiles.map((m) => m.internalPath)).toEqual([
      'vid_src_0.mp4',
      'vid_src_1.mov',
      'vid_src_2.mp4',
    ]);

    const fitArgs = fitPlan.args.join(' ');
    expect(fitArgs).toContain('scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2:black');
    expect(fitArgs).toContain('fps=30,setsar=1');
    expect(fitArgs).toContain('aformat=sample_rates=44100:channel_layouts=stereo');
    expect(fitArgs).toContain('aresample=async=1');
    // Silence generated for clip 2 (duration 4.000s) and concatenated across all 3 clips
    expect(fitArgs).toContain('anullsrc=r=44100:cl=stereo:d=4.000[aseg1]');
    expect(fitArgs).toContain('[aseg0][aseg1][aseg2]concat=n=3:v=0:a=1[aorig]');

    // Switch to 1:1 Fill (crop)
    state = projectReducer(state, {
      type: 'SET_EXPORT_SETTINGS',
      settings: {
        ...state.history.present.exportSettings,
        canvasPreset: '1:1',
        canvasFit: 'fill',
      },
    });
    const fillPlan = compileProjectToFfmpegPlan({
      project: state.history.present,
      assets,
      videoAudioPresence: audioPresence,
    });
    const fillArgs = fillPlan.args.join(' ');
    expect(fillArgs).toContain('scale=720:720:force_original_aspect_ratio=increase,crop=720:720:(iw-ow)/2:(ih-oh)/2');
  });

  it('handles silent source video cleanly and supports audio-only MP3 export', () => {
    const project = createProjectWithVideo(makeVideoMeta(), 'asset_v1');
    const mp3Project = {
      ...project,
      exportSettings: { ...project.exportSettings, audioOnlyMp3: true, quality: 'high' as const },
    };

    // Silent source + no added audio -> throws clear error on MP3-only export
    expect(() =>
      compileProjectToFfmpegPlan({
        project: mp3Project,
        assets: makeAssets(),
        hasSourceAudio: false,
      })
    ).toThrow(/No audio stream is available/);

    // Silent video + added audio clip on Audio track -> MP3-only export indexes audio from 0 without -i input.mp4
    let state = createInitialEditorState(mp3Project);
    const aud: AudioClip = {
      id: 'aud_1',
      type: 'audio',
      assetId: 'asset_aud1',
      name: 'bgm.mp3',
      format: 'mp3',
      start: 0,
      duration: 5,
      sourceOffset: 0,
      sourceDuration: 15,
      volumePercent: 100,
      muted: false,
      loop: false,
      fadeInSeconds: 0,
      fadeOutSeconds: 0,
    };
    state = projectReducer(state, { type: 'ADD_CLIP', clip: aud });

    const plan = compileProjectToFfmpegPlan({
      project: state.history.present,
      assets: makeAssets(),
      hasSourceAudio: false,
    });
    expect(plan.isAudioOnly).toBe(true);
    expect(plan.args).toContain('-vn');
    expect(plan.args).toContain('libmp3lame');
    expect(plan.args).not.toContain('vid_src_0.mp4');
    expect(plan.args.join(' ')).toContain('[0:a]');
  });

  it('validates project export requirements and converts Captions track to CaptionSegment[]', () => {
    const empty = createEmptyProject();
    const res = validateProjectForExport(empty, new Map());
    expect(res.ok).toBe(false);

    let state = createInitialEditorState();
    state = projectReducer(state, {
      type: 'SET_CAPTION_CLIPS',
      captions: [{ id: 'c1', start: 1, end: 3.5, text: 'Test caption' }],
    });
    const caps = projectToCaptions(state.history.present);
    expect(caps).toHaveLength(1);
    expect(caps[0]).toMatchObject({ start: 1, end: 3.5, text: 'Test caption' });
  });
});
