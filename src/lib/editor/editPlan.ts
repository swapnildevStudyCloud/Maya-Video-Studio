import {
  createVideoClipFromMeta,
  nextProjectId,
  projectReducer,
  type ProjectAction,
  type ProjectEditorState,
} from './projectReducer';
import {
  MAX_TEXT_CLIP_LENGTH,
  MAX_VIDEO_TRACK_CLIPS,
  type MediaAsset,
  type TextClip,
  type VideoClip,
} from './types';

export const MAX_EDIT_PLAN_BYTES = 256 * 1024; // 256 KB
export const MAX_EDIT_PLAN_ERRORS = 20;
export const MAX_EDIT_PLAN_TEXTS = 50;
export const EDIT_PLAN_CAPTIONS_NOTICE =
  'captions is not applied yet; use the AI tab to generate captions.';

export interface EditPlanClipInput {
  file: string;
  start: number;
  end: number;
}

export interface EditPlanTextInput {
  text: string;
  start: number;
  end: number;
}

export interface ValidatedEditPlanClip {
  file: string;
  assetId: string;
  start: number;
  end: number;
}

export interface ValidatedEditPlanText {
  text: string;
  start: number;
  end: number;
}

export interface ValidatedEditPlan {
  version: 1;
  clips: ValidatedEditPlanClip[];
  texts: ValidatedEditPlanText[];
  captions: boolean;
  totalDuration: number;
  captionsNotice: string | null;
}

export type EditPlanValidationResult =
  | { ok: true; plan: ValidatedEditPlan }
  | { ok: false; errors: string[]; error: string };

export const EXAMPLE_EDIT_PLAN_JSON = JSON.stringify(
  {
    version: 1,
    clips: [
      { file: 'intro.mp4', start: 0, end: 5 },
      { file: 'ai_scene1.mp4', start: 0, end: 8 },
    ],
    texts: [{ text: 'GTA 6 news', start: 0, end: 3 }],
    captions: false,
  },
  null,
  2
);

const ALLOWED_TOP_LEVEL_KEYS = new Set(['version', 'clips', 'texts', 'captions']);
const ALLOWED_CLIP_KEYS = new Set(['file', 'start', 'end']);
const ALLOWED_TEXT_KEYS = new Set(['text', 'start', 'end']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getUtf8ByteLength(str: string): number {
  return new TextEncoder().encode(str).byteLength;
}

function formatDurationSeconds(seconds: number): string {
  return Number.isInteger(seconds) ? `${seconds}` : seconds.toFixed(2).replace(/\.?0+$/, '');
}

/**
 * Parses and validates a Maya v1 JSON edit plan against uploaded video assets.
 * Collects up to 20 problems before failing, and never echoes text overlay contents.
 */
export function validateAndParseEditPlan(
  rawJson: string,
  assets: Map<string, MediaAsset>
): EditPlanValidationResult {
  if (typeof rawJson !== 'string' || rawJson.trim().length === 0) {
    const msg = 'Paste or select a JSON edit plan first.';
    return { ok: false, errors: [msg], error: msg };
  }

  const byteLength = getUtf8ByteLength(rawJson);
  if (byteLength > MAX_EDIT_PLAN_BYTES) {
    const msg = `Edit plan JSON is too large (${Math.ceil(byteLength / 1024)} KB). Maximum size is 256 KB.`;
    return { ok: false, errors: [msg], error: msg };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Syntax error';
    const msg = `Invalid JSON: ${detail}`;
    return { ok: false, errors: [msg], error: msg };
  }

  if (!isPlainObject(parsed)) {
    const msg = 'Edit plan root must be a JSON object.';
    return { ok: false, errors: [msg], error: msg };
  }

  const errors: string[] = [];
  const pushError = (msg: string) => {
    if (errors.length < MAX_EDIT_PLAN_ERRORS) {
      errors.push(msg);
    }
  };

  for (const key of Object.getOwnPropertyNames(parsed)) {
    if (!ALLOWED_TOP_LEVEL_KEYS.has(key)) {
      pushError(`Unknown field "${key}" at top level.`);
    }
  }

  if (parsed.version !== 1) {
    pushError('version must be 1.');
  }

  // Index uploaded video assets by exact file name
  const videosByName = new Map<string, Array<Extract<MediaAsset, { kind: 'video' }>>>();
  for (const asset of assets.values()) {
    if (asset.kind !== 'video') continue;
    const list = videosByName.get(asset.name) ?? [];
    list.push(asset);
    videosByName.set(asset.name, list);
  }

  const validatedClips: ValidatedEditPlanClip[] = [];
  const missingFilesReported = new Set<string>();
  let totalClipDuration = 0;
  let allClipTimingValid = true;

  if (!Array.isArray(parsed.clips)) {
    pushError('clips is required and must be an array.');
    allClipTimingValid = false;
  } else {
    if (parsed.clips.length < 1 || parsed.clips.length > MAX_VIDEO_TRACK_CLIPS) {
      pushError(`clips must contain between 1 and ${MAX_VIDEO_TRACK_CLIPS} entries.`);
    }

    parsed.clips.forEach((entry, index) => {
      const prefix = `clips[${index}]`;
      if (!isPlainObject(entry)) {
        pushError(`${prefix} must be an object.`);
        allClipTimingValid = false;
        return;
      }

      for (const key of Object.getOwnPropertyNames(entry)) {
        if (!ALLOWED_CLIP_KEYS.has(key)) {
          pushError(`Unknown field "${prefix}.${key}".`);
        }
      }

      let matchedVideo: Extract<MediaAsset, { kind: 'video' }> | null = null;
      if (typeof entry.file !== 'string' || entry.file.length === 0) {
        pushError(`${prefix}.file must be a non-empty string.`);
      } else {
        const matches = videosByName.get(entry.file) ?? [];
        if (matches.length === 0) {
          if (!missingFilesReported.has(entry.file)) {
            missingFilesReported.add(entry.file);
            pushError(`Upload ${entry.file} first`);
          }
        } else if (matches.length > 1) {
          pushError(
            `${prefix}.file: "${entry.file}" is ambiguous (${matches.length} uploaded videos share that name).`
          );
        } else {
          matchedVideo = matches[0];
        }
      }

      const hasValidStart =
        typeof entry.start === 'number' && Number.isFinite(entry.start) && entry.start >= 0;
      if (typeof entry.start !== 'number' || !Number.isFinite(entry.start) || entry.start < 0) {
        pushError(`${prefix}.start must be a finite number >= 0.`);
        allClipTimingValid = false;
      }

      const hasValidEnd = typeof entry.end === 'number' && Number.isFinite(entry.end);
      if (!hasValidEnd) {
        pushError(`${prefix}.end must be a finite number.`);
        allClipTimingValid = false;
      }

      if (hasValidStart && hasValidEnd) {
        const start = entry.start as number;
        const end = entry.end as number;
        if (end <= start) {
          pushError(`${prefix}.end must be greater than ${prefix}.start.`);
          allClipTimingValid = false;
        } else {
          totalClipDuration += end - start;
          if (matchedVideo && end > matchedVideo.duration + 1e-6) {
            pushError(
              `${prefix}.end (${formatDurationSeconds(end)}s) exceeds "${matchedVideo.name}" duration (${formatDurationSeconds(matchedVideo.duration)}s).`
            );
          } else if (matchedVideo) {
            validatedClips.push({
              file: matchedVideo.name,
              assetId: matchedVideo.id,
              start,
              end,
            });
          }
        }
      }
    });
  }

  const validatedTexts: ValidatedEditPlanText[] = [];
  if (parsed.texts !== undefined) {
    if (!Array.isArray(parsed.texts)) {
      pushError('texts must be an array.');
    } else {
      if (parsed.texts.length > MAX_EDIT_PLAN_TEXTS) {
        pushError(`texts must contain at most ${MAX_EDIT_PLAN_TEXTS} entries.`);
      }

      parsed.texts.forEach((entry, index) => {
        const prefix = `texts[${index}]`;
        if (!isPlainObject(entry)) {
          pushError(`${prefix} must be an object.`);
          return;
        }

        for (const key of Object.getOwnPropertyNames(entry)) {
          if (!ALLOWED_TEXT_KEYS.has(key)) {
            pushError(`Unknown field "${prefix}.${key}".`);
          }
        }

        let validText = false;
        if (typeof entry.text !== 'string' || entry.text.trim().length === 0) {
          pushError(
            `${prefix}.text must be a non-empty string (1 to ${MAX_TEXT_CLIP_LENGTH} characters).`
          );
        } else if (entry.text.length > MAX_TEXT_CLIP_LENGTH) {
          pushError(
            `${prefix}.text must be at most ${MAX_TEXT_CLIP_LENGTH} characters (got ${entry.text.length}).`
          );
        } else {
          validText = true;
        }

        const hasValidStart =
          typeof entry.start === 'number' && Number.isFinite(entry.start) && entry.start >= 0;
        if (typeof entry.start !== 'number' || !Number.isFinite(entry.start) || entry.start < 0) {
          pushError(`${prefix}.start must be a finite number >= 0.`);
        }

        const hasValidEnd = typeof entry.end === 'number' && Number.isFinite(entry.end);
        if (!hasValidEnd) {
          pushError(`${prefix}.end must be a finite number.`);
        }

        if (hasValidStart && hasValidEnd) {
          const start = entry.start as number;
          const end = entry.end as number;
          if (end <= start) {
            pushError(`${prefix}.end must be greater than ${prefix}.start.`);
          } else if (
            allClipTimingValid &&
            totalClipDuration > 0 &&
            end > totalClipDuration + 1e-6
          ) {
            pushError(
              `${prefix}.end (${formatDurationSeconds(end)}s) exceeds total clip duration (${formatDurationSeconds(totalClipDuration)}s).`
            );
          } else if (validText) {
            validatedTexts.push({
              text: entry.text as string,
              start,
              end,
            });
          }
        }
      });
    }
  }

  let captions = false;
  if (parsed.captions !== undefined) {
    if (typeof parsed.captions !== 'boolean') {
      pushError('captions must be a boolean.');
    } else {
      captions = parsed.captions;
    }
  }

  if (errors.length > 0) {
    return {
      ok: false,
      errors,
      error: errors.join('\n'),
    };
  }

  return {
    ok: true,
    plan: {
      version: 1,
      clips: validatedClips,
      texts: validatedTexts,
      captions,
      totalDuration: totalClipDuration,
      captionsNotice: captions ? EDIT_PLAN_CAPTIONS_NOTICE : null,
    },
  };
}

/**
 * Returns true if any track in the project currently holds at least one clip.
 */
export function hasTimelineContent(editorState: ProjectEditorState): boolean {
  return editorState.history.present.tracks.some((t) => t.clips.length > 0);
}

/**
 * Builds the sequence of existing reducer actions to apply a validated edit plan
 * inside a single edit transaction (BEGIN_EDIT_TRANSACTION / COMMIT_EDIT_TRANSACTION).
 */
export function buildEditPlanImportActions(params: {
  editorState: ProjectEditorState;
  plan: ValidatedEditPlan;
  assets: Map<string, MediaAsset>;
  replaceExisting: boolean;
}): ProjectAction[] {
  const { editorState, plan, assets, replaceExisting } = params;
  const project = editorState.history.present;
  const actions: ProjectAction[] = [{ type: 'BEGIN_EDIT_TRANSACTION' }];

  if (replaceExisting) {
    for (const track of project.tracks) {
      for (const clip of track.clips) {
        actions.push({ type: 'DELETE_CLIP', clipId: clip.id });
      }
    }
    actions.push({ type: 'REMOVE_EMPTY_TRACK_ROWS' });
  }

  let runningStart = 0;
  let firstVideoClipId: string | null = null;

  for (const entry of plan.clips) {
    const asset = assets.get(entry.assetId);
    if (!asset || asset.kind !== 'video') {
      throw new Error(`Upload ${entry.file} first`);
    }
    const baseClip = createVideoClipFromMeta(
      {
        name: asset.name,
        size: asset.size,
        mimeType: asset.file.type || 'video/mp4',
        extension: asset.extension,
        duration: asset.duration,
        width: asset.width,
        height: asset.height,
      },
      asset.id,
      runningStart
    );
    const duration = entry.end - entry.start;
    const videoClip: VideoClip = {
      ...baseClip,
      start: runningStart,
      duration,
      sourceOffset: entry.start,
      sourceDuration: asset.duration,
    };
    if (!firstVideoClipId) firstVideoClipId = videoClip.id;
    runningStart += duration;
    actions.push({ type: 'ADD_CLIP', clip: videoClip });
  }

  for (const entry of plan.texts) {
    const trimmedName = entry.text.trim().slice(0, 24) || 'Text';
    const textClip: TextClip = {
      id: nextProjectId('txt'),
      type: 'text',
      name: trimmedName,
      start: entry.start,
      duration: entry.end - entry.start,
      sourceOffset: 0,
      text: entry.text,
      size: 'medium',
      color: 'white',
      backgroundBox: false,
      align: 'center',
      xPercent: 50,
      yPercent: 50,
    };
    actions.push({ type: 'ADD_CLIP', clip: textClip });
  }

  if (firstVideoClipId) {
    actions.push({ type: 'SELECT_CLIP', clipId: firstVideoClipId });
  }
  actions.push({ type: 'COMMIT_EDIT_TRANSACTION' });
  actions.push({ type: 'SET_PLAYHEAD', time: 0 });

  return actions;
}

/**
 * Dry-runs and verifies edit-plan actions against projectReducer so any failure rolls back
 * completely without mutating state, then returns the verified actions and resulting state.
 */
export function prepareAndVerifyEditPlanImport(params: {
  editorState: ProjectEditorState;
  plan: ValidatedEditPlan;
  assets: Map<string, MediaAsset>;
  replaceExisting: boolean;
}): { actions: ProjectAction[]; nextState: ProjectEditorState } {
  const { editorState, plan, assets, replaceExisting } = params;
  const actions = buildEditPlanImportActions({
    editorState,
    plan,
    assets,
    replaceExisting,
  });

  let nextState = editorState;
  for (const action of actions) {
    nextState = projectReducer(nextState, action);
  }

  const videoCount =
    nextState.history.present.tracks.find((t) => t.kind === 'video')?.clips.length ?? 0;
  const textCount = nextState.history.present.tracks
    .filter((t) => t.kind === 'text')
    .reduce((sum, t) => sum + t.clips.length, 0);

  if (videoCount < plan.clips.length || textCount < plan.texts.length) {
    throw new Error(
      `Could not apply all items from the edit plan (${videoCount}/${plan.clips.length} clips, ${textCount}/${plan.texts.length} texts).`
    );
  }

  return { actions, nextState };
}

export function buildExampleEditPlanJson(assets: Map<string, MediaAsset>): string {
  const videoAssets = Array.from(assets.values()).filter(
    (a): a is Extract<MediaAsset, { kind: 'video' }> => a.kind === 'video'
  );
  if (videoAssets.length === 0) {
    return EXAMPLE_EDIT_PLAN_JSON;
  }

  const clips = videoAssets.slice(0, 2).map((a) => ({
    file: a.name,
    start: 0,
    end: Number(Math.min(5, Math.max(0.5, a.duration)).toFixed(2)),
  }));
  const firstEnd = clips[0]?.end ?? 3;

  return JSON.stringify(
    {
      version: 1,
      clips,
      texts: [
        {
          text: 'Headline text',
          start: 0,
          end: Number(Math.min(3, firstEnd).toFixed(2)),
        },
      ],
      captions: false,
    },
    null,
    2
  );
}
