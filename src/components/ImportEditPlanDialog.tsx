import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Download,
  FileJson,
  Info,
  Upload,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
  buildExampleEditPlanJson,
  MAX_EDIT_PLAN_BYTES,
  validateAndParseEditPlan,
  type MediaAsset,
  type ValidatedEditPlan,
} from '../lib/editor';

interface ImportEditPlanDialogProps {
  isOpen: boolean;
  assets: Map<string, MediaAsset>;
  hasExistingTimelineContent: boolean;
  existingClipCount: number;
  onClose: () => void;
  onApplyPlan: (
    plan: ValidatedEditPlan,
    replaceExisting: boolean
  ) => { ok: true; captionsNotice: string | null } | { ok: false; error: string };
  onOpenExport: () => void;
}

interface ImportSuccessState {
  clipCount: number;
  textCount: number;
  captionsNotice: string | null;
}

export function ImportEditPlanDialog({
  isOpen,
  assets,
  hasExistingTimelineContent,
  existingClipCount,
  onClose,
  onApplyPlan,
  onOpenExport,
}: ImportEditPlanDialogProps) {
  const [planText, setPlanText] = useState('');
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [pendingReplacePlan, setPendingReplacePlan] = useState<ValidatedEditPlan | null>(null);
  const [importSuccess, setImportSuccess] = useState<ImportSuccessState | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      setValidationErrors([]);
      setApplyError(null);
      setPendingReplacePlan(null);
      setImportSuccess(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (pendingReplacePlan) {
          setPendingReplacePlan(null);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose, pendingReplacePlan]);

  const exampleDownloadHref = useMemo(() => {
    const json = buildExampleEditPlanJson(assets);
    return `data:application/json;charset=utf-8,${encodeURIComponent(json)}`;
  }, [assets]);

  if (!isOpen) return null;

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setValidationErrors([]);
    setApplyError(null);
    setPendingReplacePlan(null);
    setImportSuccess(null);

    if (file.size > MAX_EDIT_PLAN_BYTES) {
      setSelectedFileName(file.name);
      setValidationErrors([
        `Edit plan file "${file.name}" is too large (${Math.ceil(file.size / 1024)} KB). Maximum size is 256 KB.`,
      ]);
      return;
    }

    try {
      const content = await file.text();
      setSelectedFileName(file.name);
      setPlanText(content);
    } catch {
      setValidationErrors([`Could not read "${file.name}".`]);
    }
  };

  const executeApply = (plan: ValidatedEditPlan, replaceExisting: boolean) => {
    setApplyError(null);
    const result = onApplyPlan(plan, replaceExisting);
    if (!result.ok) {
      setPendingReplacePlan(null);
      setApplyError(result.error);
      return;
    }

    setPendingReplacePlan(null);
    setValidationErrors([]);
    setImportSuccess({
      clipCount: plan.clips.length,
      textCount: plan.texts.length,
      captionsNotice: result.captionsNotice,
    });
  };

  const handleImportClick = () => {
    setValidationErrors([]);
    setApplyError(null);
    setImportSuccess(null);

    const validation = validateAndParseEditPlan(planText, assets);
    if (!validation.ok) {
      setPendingReplacePlan(null);
      setValidationErrors(validation.errors);
      return;
    }

    if (hasExistingTimelineContent) {
      setPendingReplacePlan(validation.plan);
      return;
    }

    executeApply(validation.plan, false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-edit-plan-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl rounded-lg border border-[#232A38] bg-[#131720] p-6"
      >
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-slate-100">
            <FileJson className="h-4 w-4 text-blue-400" aria-hidden="true" />
            <h2 id="import-edit-plan-title" className="text-base font-semibold">
              Import Edit Plan
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close import edit plan dialog"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-[#1C2230] hover:text-slate-100"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <p className="mt-2 text-xs leading-relaxed text-slate-400">
          Load a Maya v1 JSON edit plan to place trimmed clips and text overlays onto the timeline.
          Upload your source videos in the Media tab first; everything stays on your device.
        </p>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              onChange={(e) => void handleFileChange(e)}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#2C3547] bg-[#191F2C] px-3 text-xs font-medium text-slate-200 transition-colors hover:border-slate-500"
            >
              <Upload className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
              <span>Choose .json file</span>
            </button>
            {selectedFileName && (
              <span className="max-w-[200px] truncate text-[11px] text-slate-400">
                {selectedFileName}
              </span>
            )}
          </div>

          <a
            href={exampleDownloadHref}
            download="example-edit-plan.json"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-400 transition-colors hover:text-blue-300"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Download example plan</span>
          </a>
        </div>

        <div className="mt-4">
          <label
            htmlFor="edit-plan-json-textarea"
            className="mb-1.5 block text-xs font-medium text-slate-300"
          >
            Edit plan JSON (version 1, max 256 KB)
          </label>
          <textarea
            id="edit-plan-json-textarea"
            rows={9}
            value={planText}
            onChange={(e) => {
              setPlanText(e.target.value);
              setValidationErrors([]);
              setApplyError(null);
              setPendingReplacePlan(null);
              setImportSuccess(null);
            }}
            placeholder={`{\n  "version": 1,\n  "clips": [{ "file": "intro.mp4", "start": 0, "end": 5 }],\n  "texts": [{ "text": "Headline", "start": 0, "end": 3 }],\n  "captions": false\n}`}
            spellCheck={false}
            className="w-full rounded-lg border border-[#232A38] bg-[#0B0D11] p-3 font-mono text-xs leading-relaxed text-slate-100 placeholder:text-slate-600 focus:border-blue-500 focus:outline-none"
          />
        </div>

        {validationErrors.length > 0 && (
          <div
            role="alert"
            className="mt-3 max-h-40 overflow-y-auto rounded-lg border border-red-500/35 bg-red-500/10 p-3 text-xs text-red-200"
          >
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-red-100">
                  {validationErrors.length === 1
                    ? 'Could not import edit plan'
                    : `Found ${validationErrors.length} problems in edit plan`}
                </p>
                <ul className="mt-1.5 list-disc space-y-1 pl-4 break-words">
                  {validationErrors.map((errMsg, idx) => (
                    <li key={idx}>{errMsg}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}

        {applyError && (
          <div
            role="alert"
            className="mt-3 rounded-lg border border-red-500/35 bg-red-500/10 p-3 text-xs text-red-200"
          >
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" aria-hidden="true" />
              <p className="break-words">{applyError}</p>
            </div>
          </div>
        )}

        {pendingReplacePlan && (
          <div className="mt-3 rounded-lg border border-amber-500/35 bg-amber-500/10 p-3 text-xs text-amber-100">
            <div className="flex items-start gap-2">
              <AlertTriangle
                className="mt-0.5 h-4 w-4 shrink-0 text-amber-400"
                aria-hidden="true"
              />
              <div className="flex-1">
                <p className="font-semibold">
                  Timeline already has {existingClipCount}{' '}
                  {existingClipCount === 1 ? 'clip' : 'clips'}. Replace timeline?
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-amber-200/80">
                  Replacing clears current timeline clips and applies{' '}
                  {pendingReplacePlan.clips.length}{' '}
                  {pendingReplacePlan.clips.length === 1 ? 'clip' : 'clips'} and{' '}
                  {pendingReplacePlan.texts.length}{' '}
                  {pendingReplacePlan.texts.length === 1 ? 'text' : 'texts'}. Your uploaded media
                  stays in the library, and Undo reverts this replace in one step.
                </p>
                <div className="mt-2.5 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setPendingReplacePlan(null)}
                    className="h-8 rounded-lg border border-[#2C3547] bg-[#191F2C] px-3 text-xs font-medium text-slate-200 transition-colors hover:border-slate-500"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => executeApply(pendingReplacePlan, true)}
                    className="h-8 rounded-lg bg-amber-600 px-3 text-xs font-semibold text-white transition-colors hover:bg-amber-500"
                  >
                    Replace
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {importSuccess && (
          <div className="mt-3 rounded-lg border border-emerald-500/35 bg-emerald-500/10 p-3 text-xs text-emerald-100">
            <div className="flex items-start gap-2">
              <CheckCircle2
                className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400"
                aria-hidden="true"
              />
              <div className="flex-1">
                <p className="font-semibold">
                  Plan loaded: {importSuccess.clipCount} clips, {importSuccess.textCount} texts
                </p>
                {importSuccess.captionsNotice && (
                  <div className="mt-2 flex items-start gap-1.5 rounded border border-blue-500/30 bg-blue-500/10 px-2.5 py-2 text-[11px] text-blue-200">
                    <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-400" aria-hidden="true" />
                    <span>{importSuccess.captionsNotice}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          {importSuccess ? (
            <>
              <button
                type="button"
                onClick={onClose}
                className="min-h-[38px] rounded-lg border border-[#2C3547] bg-[#191F2C] px-4 py-2 text-xs font-medium text-slate-200 transition-colors hover:border-slate-500"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenExport();
                }}
                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-500"
              >
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Export</span>
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                className="min-h-[38px] rounded-lg border border-[#2C3547] bg-[#191F2C] px-4 py-2 text-xs font-medium text-slate-200 transition-colors hover:border-slate-500"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={planText.trim().length === 0 || Boolean(pendingReplacePlan)}
                onClick={handleImportClick}
                className="min-h-[38px] rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500"
              >
                Import
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
