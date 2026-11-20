import { AlertCircle, Film, Upload } from 'lucide-react';
import { useRef, useState, type ChangeEvent, type DragEvent } from 'react';

interface VideoDropzoneProps {
  isLoading: boolean;
  error: string | null;
  onSelectFile: (file: File) => void;
}

export function VideoDropzone({ isLoading, error, onSelectFile }: VideoDropzoneProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      onSelectFile(file);
    }
    // Reset value so picking the same file again after an error re-triggers onChange.
    event.target.value = '';
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!isLoading) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
    if (isLoading) return;

    const file = event.dataTransfer.files?.[0];
    if (file) {
      onSelectFile(file);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col items-center justify-center py-12 sm:py-20">
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`w-full rounded-xl border bg-[#131720] p-8 text-center transition-colors sm:p-12 ${
          isDragging
            ? 'border-blue-500 bg-blue-500/5'
            : 'border-[#232A38] hover:border-[#323C50]'
        }`}
      >
        <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-lg border border-[#232A38] bg-[#191F2C] text-slate-200">
          <Film className="h-5 w-5" aria-hidden="true" />
        </div>

        <h1 className="text-balance text-2xl font-semibold tracking-tight text-slate-100 sm:text-3xl">
          Trim MP4 and MOV videos in your browser
        </h1>

        <p className="mt-3 text-sm text-slate-400">
          Drop a video file here, or choose one from your device to set trim points and export an MP4.
        </p>

        <div className="mt-7 flex flex-col items-center gap-3">
          <input
            ref={inputRef}
            type="file"
            accept=".mp4,.mov,video/mp4,video/quicktime"
            onChange={handleFileChange}
            className="sr-only"
            aria-label="Choose MP4 or MOV video file"
          />

          <button
            type="button"
            disabled={isLoading}
            onClick={() => inputRef.current?.click()}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 disabled:cursor-not-allowed disabled:opacity-60 whitespace-nowrap shrink-0"
          >
            <Upload className="h-4 w-4" aria-hidden="true" />
            <span>{isLoading ? 'Checking video...' : 'Choose Video'}</span>
          </button>

          <p className="text-xs font-medium text-slate-300">
            Your video stays on your device.
          </p>
        </div>

        <div className="mt-7 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-t border-[#232A38] pt-5 text-xs text-slate-400">
          <span>MP4 or MOV</span>
          <span aria-hidden="true">·</span>
          <span className="tabular-nums">Max 200 MB</span>
          <span aria-hidden="true">·</span>
          <span className="tabular-nums">Max 10 minutes</span>
        </div>

        {error && (
          <div
            role="alert"
            className="mt-6 flex items-start gap-2.5 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-left text-sm text-red-200"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}
      </div>
    </div>
  );
}
