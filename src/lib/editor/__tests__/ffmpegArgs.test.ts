import { describe, expect, it } from 'vitest';
import {
  buildExtractAudioArgs,
  buildFfmpegArgs,
  buildToolsExportPlan,
} from '../ffmpegArgs';
import {
  createDefaultEditTools,
  INTERNAL_AUDIO_FILENAME,
  INTERNAL_FONT_FILENAME,
  INTERNAL_INPUT_FILENAME,
  INTERNAL_OUTPUT_AUDIO_FILENAME,
  INTERNAL_OUTPUT_FILENAME,
} from '../types';

describe('buildFfmpegArgs (Phase 1)', () => {
  it('builds expected stream-copy arguments for Fast mode with fixed internal names', () => {
    const args = buildFfmpegArgs({
      start: 2.5,
      end: 12.5,
      duration: 30,
      mode: 'fast',
    });

    expect(args).toEqual([
      '-ss',
      '2.500',
      '-i',
      INTERNAL_INPUT_FILENAME,
      '-t',
      '10.000',
      '-c',
      'copy',
      '-avoid_negative_ts',
      'make_zero',
      '-movflags',
      '+faststart',
      INTERNAL_OUTPUT_FILENAME,
    ]);
  });

  it('builds expected H.264 + AAC arguments for Precise mode with fixed internal names', () => {
    const args = buildFfmpegArgs({
      start: 5,
      end: 15.25,
      duration: 45,
      mode: 'precise',
    });

    expect(args).toEqual([
      '-ss',
      '5.000',
      '-i',
      INTERNAL_INPUT_FILENAME,
      '-t',
      '10.250',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-crf',
      '23',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-movflags',
      '+faststart',
      INTERNAL_OUTPUT_FILENAME,
    ]);
  });

  it('rejects invalid numbers, negative values, out-of-bounds, and short clips', () => {
    expect(() =>
      buildFfmpegArgs({ start: Number.NaN, end: 10, duration: 30, mode: 'fast' })
    ).toThrow();
    expect(() =>
      buildFfmpegArgs({ start: 0, end: Number.POSITIVE_INFINITY, duration: 30, mode: 'precise' })
    ).toThrow();
    expect(() =>
      buildFfmpegArgs({ start: -1, end: 5, duration: 30, mode: 'fast' })
    ).toThrow();
    expect(() =>
      buildFfmpegArgs({ start: 10, end: 10, duration: 30, mode: 'fast' })
    ).toThrow();
    expect(() =>
      buildFfmpegArgs({ start: 10, end: 10.4, duration: 30, mode: 'precise' })
    ).toThrow();
    expect(() =>
      buildFfmpegArgs({ start: 0, end: 35, duration: 30, mode: 'fast' })
    ).toThrow();
  });
});

describe('buildExtractAudioArgs', () => {
  it('builds mono 32kbps mp3 extraction args for trimmed range', () => {
    const args = buildExtractAudioArgs({ start: 2, end: 12, duration: 30 });
    expect(args).toEqual([
      '-ss',
      '2.000',
      '-i',
      INTERNAL_INPUT_FILENAME,
      '-t',
      '10.000',
      '-vn',
      '-ac',
      '1',
      '-ar',
      '16000',
      '-b:a',
      '32k',
      '-c:a',
      'libmp3lame',
      INTERNAL_AUDIO_FILENAME,
    ]);
  });
});

describe('buildToolsExportPlan (Phase 2)', () => {
  it('keeps Fast mode when no editing tools are active', () => {
    const plan = buildToolsExportPlan({
      start: 0,
      end: 10,
      duration: 30,
      mode: 'fast',
      tools: createDefaultEditTools(),
    });
    expect(plan.effectiveMode).toBe('fast');
    expect(plan.forcedPrecise).toBe(false);
    expect(plan.requiresFont).toBe(false);
    expect(plan.textFiles).toEqual([]);
  });

  it('forces Precise mode and applies filters in strict order: trim, crop, rotate/flip, speed, text, fade', () => {
    const tools = createDefaultEditTools();
    tools.cropAspect = '9:16';
    tools.rotationDegrees = 90;
    tools.flipHorizontal = true;
    tools.speed = 2;
    tools.audio = { muted: false, volumePercent: 150 };
    tools.fade = { fadeInSeconds: 1, fadeOutSeconds: 1 };
    tools.textOverlays = [
      {
        id: 'o1',
        text: "Secret: %{pts} 'quoted'",
        start: 0.5,
        end: 3.5,
        position: 'top',
        size: 'large',
        color: 'yellow',
      },
    ];

    const plan = buildToolsExportPlan({
      start: 4,
      end: 14, // 10s trimmed -> 5s output at 2x speed
      duration: 30,
      mode: 'fast',
      tools,
      videoWidth: 1920,
      videoHeight: 1080,
    });

    expect(plan.effectiveMode).toBe('precise');
    expect(plan.forcedPrecise).toBe(true);
    expect(plan.requiresFont).toBe(true);
    expect(plan.outputDuration).toBe(5);

    // User text must ONLY be in textFiles, NEVER inside args!
    expect(plan.textFiles).toEqual([
      { path: 'overlay_0.txt', content: "Secret: %{pts} 'quoted'" },
    ]);
    const joinedArgs = plan.args.join(' ');
    expect(joinedArgs).not.toContain('Secret:');
    expect(joinedArgs).not.toContain('%{pts}');

    const vfIdx = plan.args.indexOf('-vf');
    expect(vfIdx).toBeGreaterThan(-1);
    const vf = plan.args[vfIdx + 1];

    // Verify exact filter order in -vf: crop -> transpose -> hflip -> setpts -> drawtext -> fade
    const cropPos = vf.indexOf('crop=');
    const rotPos = vf.indexOf('transpose=1');
    const flipPos = vf.indexOf('hflip');
    const speedPos = vf.indexOf('setpts=0.5*PTS');
    const textPos = vf.indexOf(`drawtext=fontfile=${INTERNAL_FONT_FILENAME}:textfile=overlay_0.txt:expansion=none`);
    const fadeInPos = vf.indexOf('fade=t=in:st=0:d=1.000');
    const fadeOutPos = vf.indexOf('fade=t=out:st=4.000:d=1.000');

    expect(cropPos).toBeGreaterThanOrEqual(0);
    expect(rotPos).toBeGreaterThan(cropPos);
    expect(flipPos).toBeGreaterThan(rotPos);
    expect(speedPos).toBeGreaterThan(flipPos);
    expect(textPos).toBeGreaterThan(speedPos);
    expect(fadeInPos).toBeGreaterThan(textPos);
    expect(fadeOutPos).toBeGreaterThan(fadeInPos);

    // Verify synced audio filter chain
    const afIdx = plan.args.indexOf('-af');
    expect(afIdx).toBeGreaterThan(-1);
    const af = plan.args[afIdx + 1];
    expect(af).toContain('volume=1.50');
    expect(af).toContain('atempo=2.0');
    expect(af).toContain('afade=t=in:st=0:d=1.000');
    expect(af).toContain('afade=t=out:st=4.000:d=1.000');
  });

  it('strips audio with -an when muted or volume is 0%', () => {
    const tools = createDefaultEditTools();
    tools.audio = { muted: true, volumePercent: 100 };

    const plan = buildToolsExportPlan({
      start: 0,
      end: 10,
      duration: 20,
      mode: 'fast',
      tools,
    });

    expect(plan.args).toContain('-an');
    expect(plan.args).not.toContain('-af');
  });

  it('writes burned captions to virtual textfile= with bottom-center white-on-dark box styling', () => {
    const tools = createDefaultEditTools();
    tools.burnCaptions = true;
    tools.captions = [
      { id: 'c0', start: 1, end: 3.5, text: 'Hello Gemini captions!' },
    ];

    const plan = buildToolsExportPlan({
      start: 0,
      end: 10,
      duration: 20,
      mode: 'fast',
      tools,
      videoWidth: 1280,
      videoHeight: 720,
    });

    expect(plan.requiresFont).toBe(true);
    expect(plan.textFiles).toEqual([
      { path: 'caption_0.txt', content: 'Hello Gemini captions!' },
    ]);
    const joinedArgs = plan.args.join(' ');
    expect(joinedArgs).not.toContain('Hello Gemini captions!');
    expect(joinedArgs).toContain('textfile=caption_0.txt:expansion=none');
    expect(joinedArgs).toContain('fontcolor=white:box=1:boxcolor=black@0.75');
  });
});

describe('buildToolsExportPlan (Phase 3)', () => {
  it('concatenates kept segments with trim/atrim and handles silent source video cleanly', () => {
    const segments = [
      { id: 's1', start: 0, end: 4, deleted: false },
      { id: 's2', start: 4, end: 8, deleted: true },
      { id: 's3', start: 8, end: 14, deleted: false },
    ];

    const withAudio = buildToolsExportPlan({
      start: 0,
      end: 14,
      duration: 20,
      segments,
      mode: 'fast',
      tools: createDefaultEditTools(),
      hasSourceAudio: true,
    });

    expect(withAudio.forcedPrecise).toBe(true);
    expect(withAudio.outputDuration).toBe(10);
    const fcAudioIdx = withAudio.args.indexOf('-filter_complex');
    expect(fcAudioIdx).toBeGreaterThan(-1);
    const fcAudio = withAudio.args[fcAudioIdx + 1];
    expect(fcAudio).toContain('[0:v]trim=start=0.000:end=4.000,setpts=PTS-STARTPTS[vseg0]');
    expect(fcAudio).toContain('[0:v]trim=start=8.000:end=14.000,setpts=PTS-STARTPTS[vseg1]');
    expect(fcAudio).toContain('[vseg0][vseg1]concat=n=2:v=1:a=0[vcat]');
    expect(fcAudio).toContain('[0:a]atrim=start=0.000:end=4.000,asetpts=PTS-STARTPTS[aseg0]');
    expect(fcAudio).toContain('[0:a]atrim=start=8.000:end=14.000,asetpts=PTS-STARTPTS[aseg1]');
    expect(fcAudio).toContain('[aseg0][aseg1]concat=n=2:v=0:a=1[acat]');
    expect(withAudio.args).toContain('[vcat]');
    expect(withAudio.args).toContain('[acat]');

    // Silent source video omits [0:a] and passes -an
    const silent = buildToolsExportPlan({
      start: 0,
      end: 14,
      duration: 20,
      segments,
      mode: 'fast',
      tools: createDefaultEditTools(),
      hasSourceAudio: false,
    });
    const fcSilent = silent.args[silent.args.indexOf('-filter_complex') + 1];
    expect(fcSilent).not.toContain('[0:a]');
    expect(silent.args).toContain('-an');
  });

  it('builds audio mix args with loop, offset adelay, fades, amix, and supports silent source video', () => {
    const tools = createDefaultEditTools();
    const audioFile = new File([new Uint8Array(64)], 'bgm.mp3', { type: 'audio/mpeg' });
    tools.addedAudio = {
      file: audioFile,
      name: 'bgm.mp3',
      format: 'mp3',
      startOffsetSeconds: 1.5,
      volumePercent: 75,
      loopToVideo: true,
      fadeInSeconds: 1,
      fadeOutSeconds: 2,
    };

    const mixed = buildToolsExportPlan({
      start: 0,
      end: 10,
      duration: 20,
      mode: 'precise',
      tools,
      hasSourceAudio: true,
    });

    expect(mixed.extraMediaFiles).toEqual([
      { internalPath: 'added_audio.mp3', file: audioFile },
    ]);
    // Ensure original user filename NEVER appears in ffmpeg args
    expect(mixed.args.join(' ')).not.toContain('bgm.mp3');
    expect(mixed.args).toContain('-stream_loop');
    expect(mixed.args).toContain('-1');
    const fc = mixed.args[mixed.args.indexOf('-filter_complex') + 1];
    expect(fc).toContain('adelay=1500|1500');
    expect(fc).toContain('atrim=0:10.000');
    expect(fc).toContain('volume=0.75');
    expect(fc).toContain('afade=t=in:st=1.500:d=1.000');
    expect(fc).toContain('afade=t=out:st=8.000:d=2.000');
    expect(fc).toContain('amix=inputs=2:duration=first:dropout_transition=0:normalize=0[amixed]');
    expect(mixed.args).toContain('[amixed]');

    // When original video has no audio stream, maps added audio directly without amix
    const silentSource = buildToolsExportPlan({
      start: 0,
      end: 10,
      duration: 20,
      mode: 'precise',
      tools,
      hasSourceAudio: false,
    });
    const fcSilent = silentSource.args[silentSource.args.indexOf('-filter_complex') + 1];
    expect(fcSilent).not.toContain('amix=');
    expect(fcSilent).not.toContain('[0:a]');
    expect(silentSource.args).toContain('[aadd]');
  });

  it('builds image overlay, color filters, and resolution/quality presets', () => {
    const tools = createDefaultEditTools();
    const logoFile = new File([new Uint8Array(64)], 'brand.png', { type: 'image/png' });
    tools.imageOverlay = {
      file: logoFile,
      name: 'brand.png',
      format: 'png',
      position: 'bottom-left',
      sizePercent: 20,
      opacityPercent: 50,
      start: 1,
      end: 6,
    };
    tools.colorFilter = {
      preset: 'bw',
      brightness: 0.1,
      contrast: 1.2,
      saturation: 0.8,
    };
    tools.exportSettings = {
      resolution: '720p',
      quality: 'high',
      audioOnlyMp3: false,
    };

    const plan = buildToolsExportPlan({
      start: 0,
      end: 10,
      duration: 20,
      mode: 'fast',
      tools,
      videoWidth: 1920,
      videoHeight: 1080,
    });

    expect(plan.extraMediaFiles).toEqual([
      { internalPath: 'overlay_image.png', file: logoFile },
    ]);
    expect(plan.args.join(' ')).not.toContain('brand.png');
    expect(plan.args[plan.args.indexOf('-crf') + 1]).toBe('18');
    expect(plan.args[plan.args.indexOf('-b:a') + 1]).toBe('192k');

    const fc = plan.args[plan.args.indexOf('-filter_complex') + 1];
    expect(fc).toContain('eq=brightness=0.10:contrast=1.20:saturation=0.80');
    expect(fc).toContain('hue=s=0');
    expect(fc).toContain("scale=-2:'trunc(min(ih\\,720)/2)*2'");
    expect(fc).toContain('[1:v]format=rgba,colorchannelmixer=aa=0.50,scale=256:-2[ovimg]');
    expect(fc).toContain("[ovimg]overlay=x=W*0.03:y=H-h-H*0.03:enable='between(t,1.000,6.000)'[vimg]");
  });

  it('builds audio-only MP3 export args and rejects when no audio stream is available', () => {
    const tools = createDefaultEditTools();
    tools.exportSettings = {
      resolution: '1080p',
      quality: 'small',
      audioOnlyMp3: true,
    };

    const plan = buildToolsExportPlan({
      start: 0,
      end: 8,
      duration: 20,
      mode: 'fast',
      tools,
      hasSourceAudio: true,
    });

    expect(plan.isAudioOnly).toBe(true);
    expect(plan.args).toContain('-vn');
    expect(plan.args).toContain('libmp3lame');
    expect(plan.args[plan.args.indexOf('-b:a') + 1]).toBe('128k');
    expect(plan.args[plan.args.length - 1]).toBe(INTERNAL_OUTPUT_AUDIO_FILENAME);

    expect(() =>
      buildToolsExportPlan({
        start: 0,
        end: 8,
        duration: 20,
        mode: 'fast',
        tools,
        hasSourceAudio: false,
      })
    ).toThrow(/No audio stream/i);
  });
});
