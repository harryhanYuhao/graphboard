// src/components/graph-editor/GraphPropertiesDialog.tsx
//
// Graph-properties dialog (opened by the toolbar smile button): lists the
// vertex count, edge count, and min/max graph degree. The vertex count row
// expands into a per-vertex-type breakdown.

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useGraphStore } from "@/store/graph-store";
import { computeGraphStats } from "@/lib/graph/stats";
import { VERTEX_TYPES } from "@/lib/graph/vertex-registry";

interface GraphPropertiesDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

function StatRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2">
      <span className="text-sm text-slate-600">{label}</span>
      <span className="font-medium text-slate-900 tabular-nums">{value}</span>
    </div>
  );
}

export function GraphPropertiesDialog({
  isOpen,
  onClose,
}: GraphPropertiesDialogProps) {
  const nodes = useGraphStore((state) => state.nodes);
  const edges = useGraphStore((state) => state.edges);
  const [typeListOpen, setTypeListOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  const stats = useMemo(() => computeGraphStats(nodes, edges), [nodes, edges]);

  // Collapse the breakdown each time the dialog (re)opens. Adjusting state
  // during render (React's documented pattern) keeps the reset out of an
  // effect, where it would fight the first paint.
  const [prevOpen, setPrevOpen] = useState(isOpen);
  if (prevOpen !== isOpen) {
    setPrevOpen(isOpen);
    if (isOpen) setTypeListOpen(false);
  }

  // Move focus into the dialog each time it opens.
  useEffect(() => {
    if (isOpen) {
      closeRef.current?.focus();
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

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 transition-opacity"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="properties-dialog-title"
    >
      <div
        className="relative w-full max-w-sm rounded-lg bg-white p-6 shadow-xl transition-transform transform"
        onKeyDown={handleKeyDown}
      >
        {/* Close button */}
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 p-1 text-slate-400 hover:text-slate-600 transition-colors"
          aria-label="Close dialog"
        >
          <X size={20} />
        </button>

        {/* Dialog content */}
        <div className="space-y-4">
          <h2
            id="properties-dialog-title"
            className="text-xl font-semibold text-slate-900"
          >
            Graph properties
          </h2>

          <div className="space-y-2">
            <div className="space-y-1">
              <button
                type="button"
                onClick={() => setTypeListOpen((open) => !open)}
                aria-expanded={typeListOpen}
                aria-controls="vertex-type-breakdown"
                className="flex w-full items-center justify-between rounded-md border border-slate-200 px-3 py-2 text-left transition-colors hover:bg-slate-50"
              >
                <span className="text-sm text-slate-600">Vertices</span>
                <span className="flex items-center gap-1 font-medium text-slate-900 tabular-nums">
                  {stats.vertexCount}
                  {typeListOpen ? (
                    <ChevronUp size={16} />
                  ) : (
                    <ChevronDown size={16} />
                  )}
                </span>
              </button>

              {typeListOpen && (
                <ul
                  id="vertex-type-breakdown"
                  className="max-h-64 overflow-y-auto rounded-md border border-slate-200 bg-slate-50"
                >
                  {VERTEX_TYPES.map((meta) => (
                    <li
                      key={meta.type}
                      className="flex items-center justify-between px-3 py-1.5 text-sm"
                    >
                      <span className="text-slate-600">{meta.label}</span>
                      <span className="font-medium text-slate-900 tabular-nums">
                        {stats.countsByType[meta.type]}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <StatRow label="Edges" value={stats.edgeCount} />
            <StatRow label="Min degree" value={stats.minDegree} />
            <StatRow label="Max degree" value={stats.maxDegree} />
          </div>
        </div>
      </div>
    </div>
  );
}
