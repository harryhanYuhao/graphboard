// src/components/graph-editor/VertexTypeMenu.tsx

"use client";

import { useGraphStore } from "@/store/graph-store";
import { EDITOR_MODES } from "@/lib/graph/types";
import { VERTEX_TYPES } from "@/lib/graph/vertex-types";
import { VertexSwatch } from "./VertexSwatch";

export function VertexTypeMenu() {
  const mode = useGraphStore((state) => state.mode);
  const selectedVertexType = useGraphStore((state) => state.selectedVertexType);
  const setVertexType = useGraphStore((state) => state.setVertexType);

  // Only relevant while placing vertices.
  if (mode !== EDITOR_MODES.addVertex) return null;

  return (
    <div className="absolute left-4 top-20 z-10 flex w-44 flex-col gap-1 rounded-lg border border-slate-200 bg-white p-2 shadow-sm">
      <div className="px-1 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Vertex type
      </div>

      {VERTEX_TYPES.map((meta, index) => {
        const active = meta.type === selectedVertexType;
        // 1-based shortcut key for this entry, but only show single-digit
        // numbers (1–9). With 10 types today the 10th gets no badge; if
        // we add more, hide the badge rather than invent a multi-key
        // binding.
        const shortcutKey = index < 9 ? String(index + 1) : null;

        return (
          <button
            key={meta.type}
            type="button"
            title={shortcutKey ? `${meta.label} (${shortcutKey})` : meta.label}
            onClick={() => setVertexType(meta.type)}
            className={[
              "flex items-center gap-2 rounded-md border px-2 py-1.5 text-left text-sm",
              active
                ? "border-slate-900 bg-slate-100 font-medium text-slate-900"
                : "border-transparent text-slate-700 hover:bg-slate-50",
            ].join(" ")}
          >
            <VertexSwatch meta={meta} />
            <span className="flex-1">{meta.label}</span>
            {shortcutKey && (
              <kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">
                {shortcutKey}
              </kbd>
            )}
          </button>
        );
      })}
    </div>
  );
}
