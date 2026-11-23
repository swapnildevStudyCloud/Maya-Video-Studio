import { Download, FileJson, Film, Redo2, Settings, Undo2 } from 'lucide-react';

interface TopBarProps {
  projectName: string;
  onProjectNameChange: (name: string) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  hasApiKey: boolean;
  onOpenImportPlan: () => void;
  onOpenSettings: () => void;
  onOpenExport: () => void;
  canExport: boolean;
  isBusy: boolean;
}

export function TopBar({
  projectName,
  onProjectNameChange,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  hasApiKey,
  onOpenImportPlan,
  onOpenSettings,
  onOpenExport,
  canExport,
  isBusy,
}: TopBarProps) {
  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-6 border-b border-[#232A38] bg-[#11141B] px-4">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex items-center gap-2 whitespace-nowrap shrink-0">
          <Film className="h-4 w-4 text-blue-500" aria-hidden="true" />
          <span className="text-sm font-semibold tracking-tight text-slate-100">
            Maya Video Studio
          </span>
        </div>
        <span className="text-slate-600" aria-hidden="true">
          /
        </span>
        <input
          type="text"
          aria-label="Project name"
          maxLength={60}
          disabled={isBusy}
          value={projectName}
          onChange={(e) => onProjectNameChange(e.target.value)}
          placeholder="Untitled Project"
          className="h-8 w-52 truncate rounded-lg border border-transparent bg-transparent px-2 text-xs font-medium text-slate-200 transition-colors hover:border-[#232A38] focus:border-blue-500 focus:bg-[#0B0D11] focus:outline-none disabled:opacity-50"
        />
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          disabled={isBusy || !canUndo}
          onClick={onUndo}
          title="Undo (Ctrl/Cmd+Z)"
          aria-label="Undo"
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#232A38] bg-[#131720] text-slate-200 transition-colors hover:border-[#3A455C] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
        </button>

        <button
          type="button"
          disabled={isBusy || !canRedo}
          onClick={onRedo}
          title="Redo (Ctrl/Cmd+Shift+Z)"
          aria-label="Redo"
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#232A38] bg-[#131720] text-slate-200 transition-colors hover:border-[#3A455C] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Redo2 className="h-3.5 w-3.5" aria-hidden="true" />
        </button>

        <div className="mx-1 h-4 w-px bg-[#232A38]" aria-hidden="true" />

        <button
          type="button"
          disabled={isBusy}
          onClick={onOpenImportPlan}
          title="Import a Maya v1 JSON edit plan"
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#232A38] bg-[#131720] px-3 text-xs font-medium text-slate-200 transition-colors hover:border-[#3A455C] disabled:cursor-not-allowed disabled:opacity-40 whitespace-nowrap shrink-0"
        >
          <FileJson className="h-3.5 w-3.5 text-blue-400" aria-hidden="true" />
          <span>Import edit plan</span>
        </button>

        <button
          type="button"
          onClick={onOpenSettings}
          title="Gemini API key settings"
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#232A38] bg-[#131720] px-3 text-xs font-medium text-slate-200 transition-colors hover:border-[#3A455C] whitespace-nowrap shrink-0"
        >
          <Settings className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
          <span>{hasApiKey ? 'Settings (Key)' : 'Settings'}</span>
        </button>

        <button
          type="button"
          disabled={!canExport || isBusy}
          onClick={onOpenExport}
          title="Export MP4 or MP3"
          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 text-xs font-semibold text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500 whitespace-nowrap shrink-0"
        >
          <Download className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Export</span>
        </button>
      </div>
    </header>
  );
}
