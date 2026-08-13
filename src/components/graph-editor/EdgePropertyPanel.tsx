// src/components/graph-editor/EdgePropertyPanel.tsx
//
// Popover shown when exactly one edge is selected — edit the edge kind
// (default / dashed-blue / dashed-light). Mirrors VertexPropertyPanel's
// top-right docking;
// auto-dismisses when the selection count leaves 1. The kind lives in the
// graph slice (data.kind) because future kinds will compute differently.

"use client";

import { useMemo } from "react";
import { useGraphStore } from "@/store/graph-store";
import { DEFAULT_EDGE_KIND, EDGE_KINDS, type EdgeKind } from "@/lib/graph/types";
import { EDGE_KIND_MAP } from "@/lib/graph/edge-registry";
import { EdgeKindSwatch } from "./EdgeKindSwatch";

export function EdgePropertyPanel() {
  const edges = useGraphStore((state) => state.edges);
  const nodes = useGraphStore((state) => state.nodes);
  const updateEdgeKind = useGraphStore((state) => state.updateEdgeKind);

  // Exactly one edge selected. Otherwise hide (same contract as the vertex
  // panel).
  const selectedEdge = useMemo(() => {
    const selected = edges.filter((edge) => edge.selected);
    return selected.length === 1 ? selected[0] : null;
  }, [edges]);

  // Both property panels dock top-right. When a vertex is also selected the
  // vertex panel occupies the top slot, so the edge panel drops below it
  // instead of overlapping. (Single-click selection replaces the other type,
  // so both-selected only happens via shift-clicks / select-all / box-select.)
  const vertexAlsoSelected = useMemo(
    () => nodes.some((node) => node.selected),
    [nodes],
  );

  if (!selectedEdge) return null;

  const kind = selectedEdge.data?.kind ?? DEFAULT_EDGE_KIND;

  const handleKindChange = (next: EdgeKind) => {
    if (next !== kind) {
      updateEdgeKind(selectedEdge.id, next);
    }
  };

  return (
    <div
      // Docked top-right below the toolbar (defensive stopPropagation keeps
      // React Flow from treating panel interaction as pane input).
      className={`pointer-events-auto absolute right-4 z-20 ${
        vertexAlsoSelected ? "top-[36rem]" : "top-20"
      }`}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div className="w-60 rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Edge
        </div>

        <div>
          <label className="mb-1 block text-xs text-slate-600">Kind</label>
          <div className="grid grid-cols-2 gap-1">
            {EDGE_KINDS.map((edgeKind) => {
              const meta = EDGE_KIND_MAP[edgeKind];
              const active = edgeKind === kind;
              return (
                <button
                  key={edgeKind}
                  type="button"
                  title={meta.label}
                  aria-pressed={active}
                  onClick={() => handleKindChange(edgeKind)}
                  className={[
                    "flex flex-col items-center gap-1 rounded-md border p-2",
                    active
                      ? "border-slate-900 bg-slate-100"
                      : "border-transparent hover:bg-slate-50",
                  ].join(" ")}
                >
                  <EdgeKindSwatch kind={edgeKind} />
                  <span className="text-xs text-slate-700">{meta.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Which vertices this edge connects (read-only context). */}
        <div className="mt-3 border-t border-slate-100 pt-2 text-xs text-slate-500">
          {selectedEdge.source} → {selectedEdge.target}
        </div>
      </div>
    </div>
  );
}
