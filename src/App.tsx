import { Monitor } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { ExportDialog } from './components/ExportDialog';
import { InspectorPanel } from './components/InspectorPanel';
import {
  LeftMediaPanel,
  type LeftPanelTab,
  type TextPresetOption,
} from './components/LeftMediaPanel';
import { PreviewCanvas } from './components/PreviewCanvas';
import { SettingsDialog } from './components/SettingsDialog';
import { Timeline } from './components/Timeline';
import { TopBar } from './components/TopBar';
import {
  canRedo,
  canUndo,
  captionsToSrt,
  captureVideoThumbnail,
  createEffectClip,
  createExportOutputFingerprint,
  createInitialEditorState,
  createVideoClipFromMeta,
  DEFAULT_IMAGE_CLIP_DURATION,
  DEFAULT_TEXT_CLIP_DURATION,
  extractAudioFromTrimmedRange,
  findClipInProject,
  generateCaptionsWithGemini,
  getEffectiveTransitionDuration,
  getProjectDuration,
  getStoredGeminiApiKey,
  getVideoTrackInsertIndexAtTime,
  isSingleSimpleVideoClipProject,
  nextProjectId,
  probeAudioAssetMeta,
  probeImageDimensions,
  projectReducer,
  projectToCaptions,
  redactApiKey,
  removeStoredGeminiApiKey,
  renderProjectExport,
  setStoredGeminiApiKey,
  shouldInvalidateExportResult,
  validateAudioFile,
  validateImageFile,
  validateProjectForExport,
  validateTotalVideoSize,
  validateVideoClipLimit,
  validateVideoFile,
  type AudioClip,
  type CaptionLanguageCode,
  type ClipPropsPatch,
  type ExportMode,
  type ExportSettings,
  type ImageClip,
  type MediaAsset,
  type RenderProgress,
  type RenderResult,
  type TextAnimationType,
  type TextClip,
  type VideoClip,
  type VideoEffectType,
  type VideoTransition,
} from './lib/editor';

function classifyDroppedFile(file: File): 'video' | 'audio' | 'image' {
  const lower = file.name.toLowerCase();
  if (
    lower.endsWith('.mp3') ||
    lower.endsWith('.wav') ||
    lower.endsWith('.m4a') ||
    file.type.startsWith('audio/')
  ) {
    return 'audio';
  }
  if (
    lower.endsWith('.png') ||
    lower.endsWith('.jpg') ||
    lower.endsWith('.jpeg') ||
    file.type.startsWith('image/')
  ) {
    return 'image';
  }
  return 'video';
}

export default function App() {
  const [editorState, dispatch] = useReducer(
    projectReducer,
    undefined,
    () => createInitialEditorState()
  );

  const project = editorState.history.present;
  const { selectedClipId, playhead, zoomPxPerSec, snapEnabled } = editorState;

  const [assetsMap, setAssetsMap] = useState<Map<string, MediaAsset>>(() => new Map());
  const assetsRef = useRef<Map<string, MediaAsset>>(assetsMap);
  assetsRef.current = assetsMap;

  const projectRef = useRef(project);
  projectRef.current = project;

  const playheadRef = useRef(playhead);
  playheadRef.current = playhead;

  const [leftTab, setLeftTab] = useState<LeftPanelTab>('media');
  const [selectedTransitionClipId, setSelectedTransitionClipId] = useState<string | null>(null);
  const [isLoadingMedia, setIsLoadingMedia] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isPreviewMuted, setIsPreviewMuted] = useState(false);

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [storedApiKey, setStoredApiKey] = useState<string | null>(() =>
    getStoredGeminiApiKey()
  );

  const [captionLanguage, setCaptionLanguage] = useState<CaptionLanguageCode>('auto');
  const [isGeneratingCaptions, setIsGeneratingCaptions] = useState(false);
  const [captionStatus, setCaptionStatus] = useState<string | null>(null);
  const [captionError, setCaptionError] = useState<string | null>(null);
  const captionAbortRef = useRef<AbortController | null>(null);

  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [renderProgress, setRenderProgress] = useState<RenderProgress | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportResult, setExportResult] = useState<RenderResult | null>(null);
  const [exportResultUrl, setExportResultUrl] = useState<string | null>(null);
  const [exportedFingerprint, setExportedFingerprint] = useState<string | null>(null);
  const [isExportResultStale, setIsExportResultStale] = useState(false);
  const exportResultUrlRef = useRef<string | null>(null);
  exportResultUrlRef.current = exportResultUrl;
  const exportAbortRef = useRef<AbortController | null>(null);

  const isBusy = isExporting || isGeneratingCaptions;

  // Revoke all created object URLs on unmount
  useEffect(() => {
    return () => {
      for (const asset of assetsRef.current.values()) {
        URL.revokeObjectURL(asset.objectUrl);
      }
      if (exportResultUrlRef.current) {
        URL.revokeObjectURL(exportResultUrlRef.current);
        exportResultUrlRef.current = null;
      }
    };
  }, []);

  const assetList = useMemo(() => Array.from(assetsMap.values()), [assetsMap]);

  const totalVideoBytes = useMemo(() => {
    let sum = 0;
    for (const asset of assetsMap.values()) {
      if (asset.kind === 'video') sum += asset.size;
    }
    return sum;
  }, [assetsMap]);

  const videoTrack = useMemo(
    () => project.tracks.find((t) => t.kind === 'video') ?? null,
    [project.tracks]
  );

  const videoClips = useMemo<VideoClip[]>(
    () => (videoTrack ? videoTrack.clips.filter((c): c is VideoClip => c.type === 'video') : []),
    [videoTrack]
  );

  const firstVideoAsset = useMemo(() => {
    const firstClip = videoClips[0];
    if (firstClip) {
      const fromClip = assetsMap.get(firstClip.assetId);
      if (fromClip && fromClip.kind === 'video') return fromClip;
    }
    for (const asset of assetsMap.values()) {
      if (asset.kind === 'video') return asset;
    }
    return null;
  }, [assetsMap, videoClips]);

  const selectedEntry = useMemo(
    () => findClipInProject(project, selectedClipId),
    [project, selectedClipId]
  );
  const selectedClip = selectedEntry?.clip ?? null;

  const selectedTransition = useMemo(() => {
    if (!selectedTransitionClipId) return null;
    const idx = videoClips.findIndex((c) => c.id === selectedTransitionClipId);
    if (idx < 0 || idx >= videoClips.length - 1) return null;
    const clip = videoClips[idx];
    const nextClip = videoClips[idx + 1];
    return {
      clip,
      nextClip,
      effectiveDuration: getEffectiveTransitionDuration(clip, nextClip),
    };
  }, [selectedTransitionClipId, videoClips]);

  const projectDuration = useMemo(() => getProjectDuration(project), [project]);
  const projectValidation = useMemo(
    () => validateProjectForExport(project, assetsMap),
    [project, assetsMap]
  );
  const requiresReencode = useMemo(
    () => !isSingleSimpleVideoClipProject(project),
    [project]
  );
  const captionSegments = useMemo(() => projectToCaptions(project), [project]);

  const maxSourceDuration = useMemo(() => {
    let maxDur = 0;
    for (const asset of assetsMap.values()) {
      if (asset.kind === 'video' && asset.duration > maxDur) {
        maxDur = asset.duration;
      }
    }
    return maxDur;
  }, [assetsMap]);

  const clearExportResult = useCallback((markStale = false) => {
    if (exportResultUrlRef.current) {
      URL.revokeObjectURL(exportResultUrlRef.current);
      exportResultUrlRef.current = null;
    }
    setExportResult(null);
    setExportResultUrl(null);
    setExportedFingerprint(null);
    setIsExportResultStale(markStale);
  }, []);

  // Immediately invalidate stale export results whenever anything affecting output changes
  useEffect(() => {
    if (
      shouldInvalidateExportResult({
        hasResult: Boolean(exportResult || exportResultUrl),
        isExporting,
        exportedFingerprint,
        currentProject: project,
      })
    ) {
      clearExportResult(true);
    }
  }, [clearExportResult, exportResult, exportResultUrl, exportedFingerprint, isExporting, project]);

  const handleOpenExport = useCallback(() => {
    if (
      shouldInvalidateExportResult({
        hasResult: Boolean(exportResult || exportResultUrl),
        isExporting,
        exportedFingerprint,
        currentProject: projectRef.current,
      })
    ) {
      clearExportResult(true);
    }
    setIsExportOpen(true);
  }, [clearExportResult, exportResult, exportResultUrl, exportedFingerprint, isExporting]);

  const handleImportVideos = useCallback(
    async (files: File[]) => {
      if (isBusy || isLoadingMedia || files.length === 0) return;
      setIsLoadingMedia(true);
      setMediaError(null);
      setExportError(null);
      setCaptionError(null);
      clearExportResult();

      let runningVideoBytes = 0;
      for (const a of assetsRef.current.values()) {
        if (a.kind === 'video') runningVideoBytes += a.size;
      }

      const existingVideoTrackClips =
        projectRef.current.tracks.find((t) => t.kind === 'video')?.clips.length ?? 0;
      const shouldAutoAddToEmptyTimeline = existingVideoTrackClips === 0;
      let addedToTimelineCount = 0;
      const errors: string[] = [];

      for (const file of files) {
        const sizeBudgetCheck = validateTotalVideoSize(runningVideoBytes, file.size);
        if (!sizeBudgetCheck.ok) {
          errors.push(sizeBudgetCheck.error);
          continue;
        }

        const validation = await validateVideoFile(file);
        if (!validation.ok) {
          errors.push(`${file.name}: ${validation.error}`);
          continue;
        }

        const meta = validation.value;
        const postBudget = validateTotalVideoSize(runningVideoBytes, meta.size);
        if (!postBudget.ok) {
          errors.push(postBudget.error);
          continue;
        }

        const thumbnailUrl = await captureVideoThumbnail(file);
        const assetId = nextProjectId('asset_vid');
        const objectUrl = URL.createObjectURL(file);
        const nextAsset: MediaAsset = {
          id: assetId,
          kind: 'video',
          name: meta.name,
          size: meta.size,
          extension: meta.extension,
          file,
          objectUrl,
          thumbnailUrl,
          duration: meta.duration,
          width: meta.width,
          height: meta.height,
        };

        runningVideoBytes += meta.size;
        setAssetsMap((prev) => {
          const next = new Map(prev);
          next.set(assetId, nextAsset);
          return next;
        });

        // If the Video track started empty, place initial videos onto the timeline automatically
        if (shouldAutoAddToEmptyTimeline) {
          const limitCheck = validateVideoClipLimit(
            existingVideoTrackClips + addedToTimelineCount,
            1
          );
          if (!limitCheck.ok) {
            errors.push(`${file.name} added to library (${limitCheck.error})`);
          } else {
            const clip = createVideoClipFromMeta(meta, assetId, 0);
            dispatch({ type: 'ADD_CLIP', clip });
            addedToTimelineCount += 1;
          }
        }
      }

      if (errors.length > 0) {
        setMediaError(errors[0]);
      }
      setIsLoadingMedia(false);
    },
    [clearExportResult, isBusy, isLoadingMedia]
  );

  const handleImportAudios = useCallback(
    async (files: File[]) => {
      if (isBusy || isLoadingMedia || files.length === 0) return;
      setIsLoadingMedia(true);
      setMediaError(null);
      const errors: string[] = [];

      for (const file of files) {
        const validation = await validateAudioFile(file);
        if (!validation.ok) {
          errors.push(`${file.name}: ${validation.error}`);
          continue;
        }

        try {
          const { duration, waveform } = await probeAudioAssetMeta(file);
          const assetId = nextProjectId('asset_aud');
          const objectUrl = URL.createObjectURL(file);
          const asset: MediaAsset = {
            id: assetId,
            kind: 'audio',
            name: file.name,
            size: file.size,
            file,
            objectUrl,
            format: validation.value,
            duration,
            waveform,
          };
          setAssetsMap((prev) => {
            const next = new Map(prev);
            next.set(assetId, asset);
            return next;
          });

          const clip: AudioClip = {
            id: nextProjectId('aud'),
            type: 'audio',
            assetId,
            name: file.name,
            format: validation.value,
            start: playheadRef.current,
            duration: Math.max(0.5, duration),
            sourceOffset: 0,
            sourceDuration: duration,
            volumePercent: 100,
            muted: false,
            loop: false,
            fadeInSeconds: 0,
            fadeOutSeconds: 0,
          };
          dispatch({ type: 'ADD_CLIP', clip });
        } catch (err) {
          errors.push(
            err instanceof Error ? err.message : `Could not decode audio file "${file.name}".`
          );
        }
      }

      if (errors.length > 0) {
        setMediaError(errors[0]);
      }
      setIsLoadingMedia(false);
    },
    [isBusy, isLoadingMedia]
  );

  const handleImportImages = useCallback(
    async (files: File[]) => {
      if (isBusy || isLoadingMedia || files.length === 0) return;
      setIsLoadingMedia(true);
      setMediaError(null);
      const errors: string[] = [];

      for (const file of files) {
        const validation = await validateImageFile(file);
        if (!validation.ok) {
          errors.push(`${file.name}: ${validation.error}`);
          continue;
        }

        try {
          const { width, height } = await probeImageDimensions(file);
          const assetId = nextProjectId('asset_img');
          const objectUrl = URL.createObjectURL(file);
          const asset: MediaAsset = {
            id: assetId,
            kind: 'image',
            name: file.name,
            size: file.size,
            file,
            objectUrl,
            format: validation.value,
            width,
            height,
          };
          setAssetsMap((prev) => {
            const next = new Map(prev);
            next.set(assetId, asset);
            return next;
          });

          const clip: ImageClip = {
            id: nextProjectId('img'),
            type: 'image',
            assetId,
            name: file.name,
            format: validation.value,
            start: playheadRef.current,
            duration: DEFAULT_IMAGE_CLIP_DURATION,
            sourceOffset: 0,
            xPercent: 85,
            yPercent: 15,
            sizePercent: 18,
            opacityPercent: 100,
          };
          dispatch({ type: 'ADD_CLIP', clip });
        } catch (err) {
          errors.push(
            err instanceof Error ? err.message : `Could not decode image file "${file.name}".`
          );
        }
      }

      if (errors.length > 0) {
        setMediaError(errors[0]);
      }
      setIsLoadingMedia(false);
    },
    [isBusy, isLoadingMedia]
  );

  const handleImportFiles = useCallback(
    async (files: File[]) => {
      if (isBusy || isLoadingMedia || files.length === 0) return;
      const videos: File[] = [];
      const audios: File[] = [];
      const images: File[] = [];
      for (const f of files) {
        const kind = classifyDroppedFile(f);
        if (kind === 'audio') audios.push(f);
        else if (kind === 'image') images.push(f);
        else videos.push(f);
      }
      if (videos.length > 0) await handleImportVideos(videos);
      if (audios.length > 0) await handleImportAudios(audios);
      if (images.length > 0) await handleImportImages(images);
    },
    [handleImportAudios, handleImportImages, handleImportVideos, isBusy, isLoadingMedia]
  );

  const handleRemoveAsset = useCallback(
    (assetId: string) => {
      if (isBusy) return;
      const target = assetsRef.current.get(assetId);
      if (!target) return;

      URL.revokeObjectURL(target.objectUrl);
      setAssetsMap((prev) => {
        const next = new Map(prev);
        next.delete(assetId);
        return next;
      });
      dispatch({ type: 'REMOVE_ASSET_CLIPS', assetId });
    },
    [isBusy]
  );

  const createClipForAsset = useCallback((asset: MediaAsset, start: number) => {
    if (asset.kind === 'video') {
      return createVideoClipFromMeta(
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
        start
      );
    }

    if (asset.kind === 'audio') {
      const clip: AudioClip = {
        id: nextProjectId('aud'),
        type: 'audio',
        assetId: asset.id,
        name: asset.name,
        format: asset.format,
        start,
        duration: Math.max(0.5, asset.duration),
        sourceOffset: 0,
        sourceDuration: asset.duration,
        volumePercent: 100,
        muted: false,
        loop: false,
        fadeInSeconds: 0,
        fadeOutSeconds: 0,
      };
      return clip;
    }

    const clip: ImageClip = {
      id: nextProjectId('img'),
      type: 'image',
      assetId: asset.id,
      name: asset.name,
      format: asset.format,
      start,
      duration: DEFAULT_IMAGE_CLIP_DURATION,
      sourceOffset: 0,
      xPercent: 85,
      yPercent: 15,
      sizePercent: 18,
      opacityPercent: 100,
    };
    return clip;
  }, []);

  const handleAddAssetToTimeline = useCallback(
    (asset: MediaAsset) => {
      if (isBusy) return;

      if (asset.kind === 'video') {
        const limitCheck = validateVideoClipLimit(videoClips.length, 1);
        if (!limitCheck.ok) {
          setMediaError(limitCheck.error);
          return;
        }
        setMediaError(null);
        const clip = createClipForAsset(asset, 0);
        dispatch({ type: 'ADD_CLIP', clip });
        return;
      }

      const clip = createClipForAsset(asset, playheadRef.current);
      dispatch({ type: 'ADD_CLIP', clip });
    },
    [createClipForAsset, isBusy, videoClips.length]
  );

  const handleDropAssetOnTimeline = useCallback(
    (assetId: string, dropTime: number, targetTrackId?: string) => {
      if (isBusy) return;
      const asset = assetsRef.current.get(assetId);
      if (!asset) return;

      if (asset.kind === 'video') {
        const limitCheck = validateVideoClipLimit(videoClips.length, 1);
        if (!limitCheck.ok) {
          setMediaError(limitCheck.error);
          return;
        }
        setMediaError(null);
        const insertIndex = getVideoTrackInsertIndexAtTime(videoClips, dropTime);
        const clip = createClipForAsset(asset, dropTime);
        dispatch({ type: 'ADD_CLIP', clip, insertIndex });
        return;
      }

      const clip = createClipForAsset(asset, dropTime);
      dispatch({ type: 'ADD_CLIP', clip, trackId: targetTrackId });
    },
    [createClipForAsset, isBusy, videoClips]
  );

  const handleAddTextClip = useCallback(
    (preset?: TextPresetOption) => {
      if (isBusy) return;
      setSelectedTransitionClipId(null);
      const text = preset?.text ?? 'Sample text';
      const clip: TextClip = {
        id: nextProjectId('txt'),
        type: 'text',
        name: text.slice(0, 24),
        start: playheadRef.current,
        duration: DEFAULT_TEXT_CLIP_DURATION,
        sourceOffset: 0,
        text,
        size: preset?.size ?? 'medium',
        color: preset?.color ?? 'white',
        backgroundBox: preset?.backgroundBox ?? false,
        align: preset?.align ?? 'center',
        xPercent: preset?.xPercent ?? 50,
        yPercent: preset?.yPercent ?? 50,
      };
      dispatch({ type: 'ADD_CLIP', clip });
    },
    [isBusy]
  );

  const handleAddEffectClip = useCallback(
    (effectType: VideoEffectType) => {
      if (isBusy) return;
      setSelectedTransitionClipId(null);
      const clip = createEffectClip({
        id: nextProjectId('efx'),
        effectType,
        start: playheadRef.current,
      });
      dispatch({ type: 'ADD_CLIP', clip });
    },
    [isBusy]
  );

  const handleTogglePlay = useCallback(() => {
    setIsPlaying((prev) => {
      if (!prev && projectDuration > 0 && playheadRef.current >= projectDuration - 0.02) {
        dispatch({ type: 'SET_PLAYHEAD', time: 0 });
      }
      return !prev;
    });
  }, [projectDuration]);

  const handlePlayheadChange = useCallback((time: number) => {
    dispatch({ type: 'SET_PLAYHEAD', time });
  }, []);

  const handleStepFrame = useCallback((deltaSeconds: number) => {
    setIsPlaying(false);
    dispatch({ type: 'STEP_PLAYHEAD', deltaSeconds });
  }, []);

  const handleSelectClip = useCallback((clipId: string | null) => {
    if (clipId !== null) setSelectedTransitionClipId(null);
    dispatch({ type: 'SELECT_CLIP', clipId });
  }, []);

  const handleSelectTransition = useCallback((clipId: string | null) => {
    if (clipId !== null) {
      dispatch({ type: 'SELECT_CLIP', clipId: null });
    }
    setSelectedTransitionClipId(clipId);
  }, []);

  const handleSetVideoTransition = useCallback(
    (clipId: string, transition: VideoTransition | undefined) => {
      dispatch({ type: 'SET_VIDEO_TRANSITION', clipId, transition });
    },
    []
  );

  const handleApplyAnimationToAllCaptions = useCallback(
    (config: {
      animInType: TextAnimationType;
      animInDuration: number;
      animOutType: TextAnimationType;
      animOutDuration: number;
      fadeWithSlide: boolean;
    }) => {
      dispatch({ type: 'APPLY_ANIMATION_TO_ALL_CAPTIONS', ...config });
    },
    []
  );

  const handleBeginDragTransaction = useCallback(() => {
    dispatch({ type: 'BEGIN_EDIT_TRANSACTION' });
  }, []);

  const handleCommitDragTransaction = useCallback(() => {
    dispatch({ type: 'COMMIT_EDIT_TRANSACTION' });
  }, []);

  const handleMoveClip = useCallback(
    (clipId: string, start: number, targetTrackId?: string) => {
      dispatch({ type: 'MOVE_CLIP', clipId, start, targetTrackId });
    },
    []
  );

  const handleResizeClip = useCallback(
    (clipId: string, edge: 'left' | 'right', time: number) => {
      dispatch({ type: 'RESIZE_CLIP', clipId, edge, time });
    },
    []
  );

  const handleUpdateClipProps = useCallback((clipId: string, patch: ClipPropsPatch) => {
    dispatch({ type: 'UPDATE_CLIP_PROPS', clipId, patch });
  }, []);

  const handleDeleteClip = useCallback((clipId: string) => {
    dispatch({ type: 'DELETE_CLIP', clipId });
  }, []);

  const handleSplitAtPlayhead = useCallback(() => {
    dispatch({ type: 'SPLIT_CLIP_AT_PLAYHEAD' });
  }, []);

  const handleDuplicateSelected = useCallback(() => {
    dispatch({ type: 'DUPLICATE_CLIP' });
  }, []);

  const handleDeleteSelected = useCallback(() => {
    if (!selectedClipId) return;
    dispatch({ type: 'DELETE_CLIP', clipId: selectedClipId });
  }, [selectedClipId]);

  const handleSaveApiKey = useCallback((key: string) => {
    setStoredGeminiApiKey(key);
    setStoredApiKey(getStoredGeminiApiKey());
    setCaptionError(null);
  }, []);

  const handleRemoveApiKey = useCallback(() => {
    removeStoredGeminiApiKey();
    setStoredApiKey(null);
  }, []);

  const handleGenerateCaptions = useCallback(async () => {
    const captionClip = videoClips[0];
    const targetAsset = captionClip
      ? assetsMap.get(captionClip.assetId) ?? firstVideoAsset
      : firstVideoAsset;
    if (!targetAsset || targetAsset.kind !== 'video' || isBusy) return;

    const apiKey = getStoredGeminiApiKey();
    if (!apiKey) {
      setIsSettingsOpen(true);
      return;
    }

    const extractStart = captionClip ? captionClip.sourceOffset : 0;
    const extractEnd = captionClip
      ? Math.min(captionClip.sourceDuration, captionClip.sourceOffset + captionClip.duration * captionClip.speed)
      : targetAsset.duration;
    const timelineOffset = captionClip ? captionClip.start : 0;

    const controller = new AbortController();
    captionAbortRef.current = controller;
    setIsGeneratingCaptions(true);
    setCaptionError(null);
    setCaptionStatus('Loading ffmpeg core...');

    try {
      const extracted = await extractAudioFromTrimmedRange({
        file: targetAsset.file,
        start: extractStart,
        end: Math.max(extractStart + 0.5, extractEnd),
        duration: targetAsset.duration,
        signal: controller.signal,
        onProgress: (p) => {
          if (captionAbortRef.current !== controller || controller.signal.aborted) return;
          if (p.phase === 'loading') {
            setCaptionStatus(p.statusText ?? 'Loading ffmpeg core...');
          } else if (p.phase === 'preparing') {
            setCaptionStatus('Reading video audio track...');
          } else if (p.phase === 'processing') {
            setCaptionStatus(`Extracting audio (${Math.round(p.progress * 100)}%)...`);
          }
        },
      });

      setCaptionStatus('Generating captions with Gemini...');
      const generated = await generateCaptionsWithGemini({
        apiKey,
        audioBytes: extracted.bytes,
        mimeType: extracted.mimeType,
        clipDuration: extracted.duration,
        language: captionLanguage,
        signal: controller.signal,
      });

      if (captionAbortRef.current !== controller || controller.signal.aborted) return;

      dispatch({
        type: 'SET_CAPTION_CLIPS',
        captions: generated,
        timelineOffset,
      });

      if (generated.length === 0) {
        setCaptionError('No spoken words were detected in this audio range.');
      }
    } catch (err) {
      if (
        captionAbortRef.current === controller &&
        !(err instanceof DOMException && err.name === 'AbortError')
      ) {
        const rawMsg = err instanceof Error ? err.message : 'Failed to generate captions.';
        setCaptionError(redactApiKey(rawMsg, apiKey));
      }
    } finally {
      if (captionAbortRef.current === controller) {
        captionAbortRef.current = null;
        setIsGeneratingCaptions(false);
        setCaptionStatus(null);
      }
    }
  }, [assetsMap, captionLanguage, firstVideoAsset, isBusy, videoClips]);

  const handleCancelCaptions = useCallback(() => {
    const controller = captionAbortRef.current;
    captionAbortRef.current = null;
    controller?.abort();
    setIsGeneratingCaptions(false);
    setCaptionStatus(null);
  }, []);

  const handleDownloadSrt = useCallback(() => {
    if (captionSegments.length === 0) return;
    const srt = captionsToSrt(captionSegments);
    const blob = new Blob([srt], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeName = (project.name || 'captions').replace(/[^a-zA-Z0-9._-]+/g, '_');
    a.download = `${safeName}.srt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [captionSegments, project.name]);

  const handleExport = useCallback(async () => {
    const latestProject = projectRef.current;
    const latestAssets = assetsRef.current;
    const latestValidation = validateProjectForExport(latestProject, latestAssets);
    if (!latestValidation.ok || isBusy) return;

    const latestVideoClips =
      latestProject.tracks
        .find((t) => t.kind === 'video')
        ?.clips.filter((c): c is VideoClip => c.type === 'video') ?? [];
    let latestFirstVideo: MediaAsset | null = null;
    if (latestVideoClips[0]) {
      const fromClip = latestAssets.get(latestVideoClips[0].assetId);
      if (fromClip && fromClip.kind === 'video') {
        latestFirstVideo = fromClip;
      }
    }
    if (!latestFirstVideo) {
      for (const asset of latestAssets.values()) {
        if (asset.kind === 'video') {
          latestFirstVideo = asset;
          break;
        }
      }
    }

    const runFingerprint = createExportOutputFingerprint(latestProject);
    const controller = new AbortController();
    exportAbortRef.current = controller;
    setIsExporting(true);
    setIsPlaying(false);
    setExportError(null);
    clearExportResult(false);
    setRenderProgress({ phase: 'loading', progress: 0, statusText: 'Loading ffmpeg core...' });

    try {
      const result = await renderProjectExport({
        videoFile: latestFirstVideo?.file ?? null,
        project: latestProject,
        assets: latestAssets,
        videoWidth: latestFirstVideo?.width,
        videoHeight: latestFirstVideo?.height,
        signal: controller.signal,
        onProgress: (p) => {
          if (exportAbortRef.current !== controller || controller.signal.aborted) return;
          setRenderProgress(p);
        },
      });
      if (exportAbortRef.current !== controller || controller.signal.aborted) return;
      const resultUrl = URL.createObjectURL(result.blob);
      exportResultUrlRef.current = resultUrl;
      setExportedFingerprint(runFingerprint);
      setExportResult(result);
      setExportResultUrl(resultUrl);
      setIsExportResultStale(false);
    } catch (err) {
      if (
        exportAbortRef.current === controller &&
        !(err instanceof DOMException && err.name === 'AbortError')
      ) {
        setExportError(err instanceof Error ? err.message : 'Export failed.');
      }
    } finally {
      if (exportAbortRef.current === controller) {
        exportAbortRef.current = null;
        setIsExporting(false);
        setRenderProgress(null);
      }
    }
  }, [clearExportResult, isBusy]);

  const handleCancelExport = useCallback(() => {
    const controller = exportAbortRef.current;
    exportAbortRef.current = null;
    controller?.abort();
    setIsExporting(false);
    setRenderProgress(null);
  }, []);

  // Global NLE keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isSettingsOpen || isExportOpen || isBusy) return;

      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const isTextInput =
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        Boolean(target?.isContentEditable) ||
        (tag === 'INPUT' &&
          !['range', 'checkbox', 'radio', 'button'].includes(
            (target as HTMLInputElement).type
          ));

      if (isTextInput) return;

      const mod = e.metaKey || e.ctrlKey;
      const keyLower = e.key.toLowerCase();

      if (mod && keyLower === 'z') {
        e.preventDefault();
        if (e.shiftKey) dispatch({ type: 'REDO' });
        else dispatch({ type: 'UNDO' });
        return;
      }

      if (mod && keyLower === 'y') {
        e.preventDefault();
        dispatch({ type: 'REDO' });
        return;
      }

      if (mod && keyLower === 'd') {
        e.preventDefault();
        if (selectedClipId) dispatch({ type: 'DUPLICATE_CLIP', clipId: selectedClipId });
        return;
      }

      if (e.code === 'Space') {
        if (projectDuration > 0 || firstVideoAsset) {
          e.preventDefault();
          handleTogglePlay();
        }
        return;
      }

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setIsPlaying(false);
        dispatch({ type: 'STEP_PLAYHEAD', deltaSeconds: e.shiftKey ? -1 : -1 / 30 });
        return;
      }

      if (e.key === 'ArrowRight') {
        e.preventDefault();
        setIsPlaying(false);
        dispatch({ type: 'STEP_PLAYHEAD', deltaSeconds: e.shiftKey ? 1 : 1 / 30 });
        return;
      }

      if (!mod && keyLower === 's') {
        if (projectDuration > 0) {
          e.preventDefault();
          dispatch({ type: 'SPLIT_CLIP_AT_PLAYHEAD' });
        }
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedClipId) {
          e.preventDefault();
          dispatch({ type: 'DELETE_CLIP', clipId: selectedClipId });
        }
        return;
      }

      if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        dispatch({ type: 'SET_ZOOM', zoomPxPerSec: zoomPxPerSec + 15 });
        return;
      }

      if (e.key === '-') {
        e.preventDefault();
        dispatch({ type: 'SET_ZOOM', zoomPxPerSec: zoomPxPerSec - 15 });
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    firstVideoAsset,
    handleTogglePlay,
    isBusy,
    isExportOpen,
    isSettingsOpen,
    projectDuration,
    selectedClipId,
    zoomPxPerSec,
  ]);

  const firstClipSizeLabel =
    firstVideoAsset && firstVideoAsset.width > 0 && firstVideoAsset.height > 0
      ? `${firstVideoAsset.width}×${firstVideoAsset.height}`
      : null;

  return (
    <div className="min-h-screen bg-[#0B0D11] text-slate-100">
      {/* Desktop-first viewport notice (< 1024px) */}
      <div className="flex min-h-screen flex-col items-center justify-center p-6 text-center lg:hidden">
        <div className="max-w-sm rounded-lg border border-[#232A38] bg-[#131720] p-6">
          <Monitor className="mx-auto mb-3 h-7 w-7 text-blue-400" aria-hidden="true" />
          <h1 className="text-base font-semibold text-slate-100">
            Desktop screen required
          </h1>
          <p className="mt-2 text-xs leading-relaxed text-slate-400">
            Maya Video Studio&apos;s timeline editor is designed for desktop viewports at least 1024px wide. Please widen your browser window or open on a desktop device.
          </p>
        </div>
      </div>

      {/* Full desktop timeline editor (>= 1024px) */}
      <div className="hidden h-screen flex-col overflow-hidden lg:flex">
        <TopBar
          projectName={project.name}
          onProjectNameChange={(name) => dispatch({ type: 'SET_PROJECT_NAME', name })}
          canUndo={canUndo(editorState.history)}
          canRedo={canRedo(editorState.history)}
          onUndo={() => dispatch({ type: 'UNDO' })}
          onRedo={() => dispatch({ type: 'REDO' })}
          hasApiKey={Boolean(storedApiKey)}
          onOpenSettings={() => setIsSettingsOpen(true)}
          onOpenExport={handleOpenExport}
          canExport={projectValidation.ok}
          isBusy={isBusy}
        />

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <LeftMediaPanel
            activeTab={leftTab}
            onTabChange={setLeftTab}
            assets={assetList}
            totalVideoBytes={totalVideoBytes}
            videoClipCount={videoClips.length}
            isLoadingMedia={isLoadingMedia}
            mediaError={mediaError}
            onDismissMediaError={() => setMediaError(null)}
            onImportVideos={(files) => void handleImportVideos(files)}
            onImportAudios={(files) => void handleImportAudios(files)}
            onImportImages={(files) => void handleImportImages(files)}
            onImportFiles={(files) => void handleImportFiles(files)}
            onAddAssetToTimeline={handleAddAssetToTimeline}
            onRemoveAsset={handleRemoveAsset}
            onAddTextClip={handleAddTextClip}
            onAddEffectClip={handleAddEffectClip}
            hasVideo={Boolean(firstVideoAsset)}
            hasApiKey={Boolean(storedApiKey)}
            captionLanguage={captionLanguage}
            onCaptionLanguageChange={setCaptionLanguage}
            isGeneratingCaptions={isGeneratingCaptions}
            captionStatus={captionStatus}
            captionError={captionError}
            hasCaptions={captionSegments.length > 0}
            onGenerateCaptions={() => void handleGenerateCaptions()}
            onCancelCaptions={handleCancelCaptions}
            onDownloadSrt={handleDownloadSrt}
            onOpenSettings={() => setIsSettingsOpen(true)}
            isBusy={isBusy}
          />

          <PreviewCanvas
            project={project}
            assets={assetsMap}
            playhead={playhead}
            selectedClipId={selectedClipId}
            isPlaying={isPlaying}
            isPreviewMuted={isPreviewMuted}
            isBusy={isBusy}
            onTogglePlay={handleTogglePlay}
            onPlayheadChange={handlePlayheadChange}
            onStepFrame={handleStepFrame}
            onTogglePreviewMuted={() => setIsPreviewMuted((p) => !p)}
            onSelectClip={handleSelectClip}
            onBeginDragTransaction={handleBeginDragTransaction}
            onUpdateClipProps={handleUpdateClipProps}
            onCommitDragTransaction={handleCommitDragTransaction}
            onSplitAtPlayhead={handleSplitAtPlayhead}
            onImportVideos={(files) => void handleImportVideos(files)}
          />

          <InspectorPanel
            selectedClip={selectedClip}
            selectedTransition={selectedTransition}
            hasCaptions={captionSegments.length > 0}
            onUpdateClip={handleUpdateClipProps}
            onDeleteClip={handleDeleteClip}
            onSetVideoTransition={handleSetVideoTransition}
            onApplyAnimationToAllCaptions={handleApplyAnimationToAllCaptions}
            disabled={isBusy}
          />
        </div>

        <Timeline
          project={project}
          assets={assetsMap}
          playhead={playhead}
          selectedClipId={selectedClipId}
          selectedTransitionClipId={selectedTransitionClipId}
          zoomPxPerSec={zoomPxPerSec}
          snapEnabled={snapEnabled}
          disabled={isBusy}
          onSelectClip={handleSelectClip}
          onSelectTransition={handleSelectTransition}
          onPlayheadChange={handlePlayheadChange}
          onZoomChange={(zoom) => dispatch({ type: 'SET_ZOOM', zoomPxPerSec: zoom })}
          onToggleSnap={() => dispatch({ type: 'TOGGLE_SNAP' })}
          onBeginDragTransaction={handleBeginDragTransaction}
          onMoveClip={handleMoveClip}
          onResizeClip={handleResizeClip}
          onCommitDragTransaction={handleCommitDragTransaction}
          onSplitAtPlayhead={handleSplitAtPlayhead}
          onDuplicateSelected={handleDuplicateSelected}
          onDeleteSelected={handleDeleteSelected}
          onAddTrackRow={(kind) => dispatch({ type: 'ADD_TRACK_ROW', kind })}
          onToggleTrackMute={(trackId) => dispatch({ type: 'TOGGLE_TRACK_MUTE', trackId })}
          onToggleTrackHide={(trackId) => dispatch({ type: 'TOGGLE_TRACK_HIDE', trackId })}
          onDropAssetOnTimeline={handleDropAssetOnTimeline}
        />
      </div>

      <SettingsDialog
        isOpen={isSettingsOpen}
        hasStoredKey={Boolean(storedApiKey)}
        storedKeyPreview={storedApiKey}
        onClose={() => setIsSettingsOpen(false)}
        onSaveKey={handleSaveApiKey}
        onRemoveKey={handleRemoveApiKey}
      />

      <ExportDialog
        isOpen={isExportOpen}
        project={project}
        requiresReencode={requiresReencode}
        projectDuration={projectDuration}
        sourceDuration={maxSourceDuration}
        firstClipSizeLabel={firstClipSizeLabel}
        validationError={projectValidation.ok ? null : projectValidation.error}
        isExporting={isExporting}
        progress={renderProgress}
        exportError={exportError}
        exportResult={exportResult}
        exportResultUrl={exportResultUrl}
        exportedFingerprint={exportedFingerprint}
        isResultStale={isExportResultStale}
        onClose={() => setIsExportOpen(false)}
        onModeChange={(mode: ExportMode) => dispatch({ type: 'SET_EXPORT_MODE', mode })}
        onSettingsChange={(settings: ExportSettings) =>
          dispatch({ type: 'SET_EXPORT_SETTINGS', settings })
        }
        onExport={() => void handleExport()}
        onCancelExport={handleCancelExport}
        onClearResult={clearExportResult}
      />
    </div>
  );
}
