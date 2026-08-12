// src/components/graph-editor/EdgeKindMenu.tsx
//
// Dropdown shown while in add-edge mode (mirrors `VertexTypeMenu` for
// vertices): pick the edge kind that newly created edges get. The toolbar's
// edge-add button switches the mode; this menu appears automatically and
// stages the kind on `selectedEdgeKind`.

"use client";

import { useGraphStore } from "@/store/graph-store";
import { EDITOR_MODES, EDGE_KINDS } from "@/lib/graph/types";
import { EDGE_KIND_MAP } from "@/lib/graph/edge-registry";
import { EdgeKindSwatch } from "./EdgeKindSwatch";

export function EdgeKindMenu() {
  const mode = useGraphStore((state) => state.mode);
  const selectedEdgeKind = useGraphStore((state) => state.selectedEdgeKind);
  const setEdgeKind = useGraphStore((state) => state.setEdgeKind);

  // Only relevant while connecting edges.
  if (mode !== EDITOR_MODES.addEdge) return null;

  return (
    <div className="absolute left-4 top-20 z-10 flex w-44 flex-col gap-1 rounded-lg border border-slate-200 bg-white p-2 shadow-sm">
      <div className="px-1 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Edge kind
      </div>

      {EDGE_KINDS.map((kind) => {
        const meta = EDGE_KIND_MAP[kind];
        const active = kind === selectedEdgeKind;
        return (
          <button
            key={kind}
            type="button"
            title={meta.label}
            aria-pressed={active}
            onClick={() => setEdgeKind(kind)}
            className={[
              "flex items-center gap-2 rounded-md border px-2 py-1.5 text-left text-sm",
              active
                ? "border-slate-900 bg-slate-100 font-medium text-slate-900"
                : "border-transparent text-slate-700 hover:bg-slate-50",
            ].join(" ")}
          >
            <EdgeKindSwatch kind={kind} />
            <span className="flex-1">{meta.label}</span>
          </button>
        );
      })}
    </div>
  );
}
