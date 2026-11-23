import { DEFAULT_EXPORT_FPS, type ProjectState } from './types';

/**
 * Produces a deterministic fingerprint of every project field and export setting
 * that affects the rendered output file (clips, tracks, effects, text, audio,
 * transitions, canvas preset/fit, mode, resolution, quality, fps, audio-only, name).
 * UI-only state (clip selection, playhead, timeline zoom, snap) is excluded.
 */
export function createExportOutputFingerprint(project: ProjectState): string {
  return JSON.stringify({
    name: project.name,
    tracks: project.tracks,
    exportMode: project.exportMode,
    exportSettings: {
      resolution: project.exportSettings.resolution,
      quality: project.exportSettings.quality,
      audioOnlyMp3: Boolean(project.exportSettings.audioOnlyMp3),
      canvasPreset: project.exportSettings.canvasPreset ?? 'original',
      canvasFit: project.exportSettings.canvasFit ?? 'fit',
      fps: project.exportSettings.fps ?? DEFAULT_EXPORT_FPS,
    },
  });
}

/**
 * Returns true when an existing export result no longer matches the current
 * project/export settings. Ignored while an export is actively running.
 */
export function shouldInvalidateExportResult(params: {
  hasResult: boolean;
  isExporting: boolean;
  exportedFingerprint: string | null;
  currentProject: ProjectState;
}): boolean {
  if (!params.hasResult || params.isExporting || !params.exportedFingerprint) {
    return false;
  }
  return createExportOutputFingerprint(params.currentProject) !== params.exportedFingerprint;
}
