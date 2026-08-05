// src/components/graph-editor/ExportDialog.tsx
//
// Export-format chooser. The store owns the open/close state (`isExportOpen`);
// this is a presentational modal listing the registered export formats
// (JSON / TikZ / ZXLive / QASM) as radio cards. Picking a format and hitting Export
// calls the store's `exportGraph(formatId)`. Each card has a documentation
// icon button (per-format `doc_url`, opens in a new tab).

"use client";

import { useEffect, useRef, useState } from "react";
import { BookOpen, X } from "lucide-react";
import { EXPORT_FORMATS, type ExportFormatId } from "@/lib/serialisation";
import { useGraphStore } from "@/store/graph-store";

interface ExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ExportDialog({ isOpen, onClose }: ExportDialogProps) {
  const exportGraph = useGraphStore((state) => state.exportGraph);
  const [selected, setSelected] = useState<ExportFormatId>("json");
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Reset the format to JSON each time the dialog opens. Adjusting state
  // during render (React's documented pattern) keeps the reset out of an
  // effect, where it would fight the first paint.
  const [prevOpen, setPrevOpen] = useState(isOpen);
  if (prevOpen !== isOpen) {
    setPrevOpen(isOpen);
    if (isOpen) setSelected("json");
  }

  // Focus Cancel whenever the dialog opens.
  useEffect(() => {
    if (isOpen) {
      cancelRef.current?.focus();
    }
  }, [isOpen]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
    }
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const handleExport = () => {
    const formatId = selected;
    // Close first, then run the async export (matches the confirm-dialog
    // pattern in GraphEditor).
    onClose();
    void exportGraph(formatId);
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 transition-opacity"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-dialog-title"
    >
      <div
        ref={dialogRef}
        className="relative w-full max-w-md rounded-lg bg-white p-6 shadow-xl transition-transform transform"
        onKeyDown={handleKeyDown}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute right-4 top-4 p-1 text-slate-400 hover:text-slate-600 transition-colors"
          aria-label="Close dialog"
        >
          <X size={20} />
        </button>

        {/* Dialog content */}
        <div className="space-y-4">
          <h2
            id="export-dialog-title"
            className="text-xl font-semibold text-slate-900"
          >
            Export graph
          </h2>

          <p className="text-slate-600">
            Choose a file format for the export. Click book button to check documentation.
          </p>

          <div className="space-y-2" role="radiogroup" aria-label="Export format">
            {EXPORT_FORMATS.map((format) => (
              <div
                key={format.id}
                className={`flex items-start gap-2 rounded-md border p-3 transition-colors ${selected === format.id
                  ? "border-blue-500 bg-blue-50"
                  : "border-slate-200 hover:bg-slate-50"
                  }`}
              >
                <label className="flex flex-1 cursor-pointer items-start gap-3">
                  <input
                    type="radio"
                    name="export-format"
                    value={format.id}
                    checked={selected === format.id}
                    onChange={() => setSelected(format.id)}
                    className="mt-1"
                  />
                  <span className="flex flex-col">
                    <span className="font-medium text-slate-900">
                      {format.label}
                    </span>
                    <span className="text-sm text-slate-500">
                      {format.description}
                    </span>
                  </span>
                </label>
                <a
                  href={format.doc_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Documentation: ${format.label} export (opens in a new tab)`}
                  title={`How the ${format.label} export works`}
                  className="mt-0.5 rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-700"
                >
                  <BookOpen size={16} />
                </a>
              </div>
            ))}
          </div>
        </div>

        {/* Dialog buttons */}
        <div className="mt-6 flex justify-end space-x-3">
          <button
            ref={cancelRef}
            onClick={onClose}
            className="px-4 py-2 text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors font-medium"
          >
            Cancel
          </button>

          <button
            onClick={handleExport}
            className="px-4 py-2 text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors font-medium"
          >
            Export
          </button>
        </div>
      </div>
    </div>
  );
}
