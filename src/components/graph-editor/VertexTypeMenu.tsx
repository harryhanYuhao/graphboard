// src/components/graph-editor/VertexTypeMenu.tsx

"use client";

import { useGraphStore } from "@/store/graph-store";
import {
  TRIANGLE_CLIP_PATH,
  VERTEX_TYPES,
  type VertexTypeMeta,
} from "@/lib/graph/vertex-types";

function VertexSwatch({ meta }: { meta: VertexTypeMeta }) {
  const isTriangle = meta.shape === "triangle";

  const shapeRadius =
    meta.shape === "circle"
      ? "rounded-full"
      : meta.shape === "square"
        ? "rounded-md"
        : "";

  return (
    <span
      className={[
        "h-5 w-5 shrink-0",
        isTriangle ? "" : `border ${meta.borderClassName}`,
        shapeRadius,
        meta.className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ clipPath: isTriangle ? TRIANGLE_CLIP_PATH : undefined }}
    />
  );
}

export function VertexTypeMenu() {
  const mode = useGraphStore((state) => state.mode);
  const selectedVertexType = useGraphStore((state) => state.selectedVertexType);
  const setVertexType = useGraphStore((state) => state.setVertexType);

  // Only relevant while placing vertices.
  if (mode !== "add-vertex") return null;

  return (
    <div className="absolute left-4 top-20 z-10 flex w-44 flex-col gap-1 rounded-lg border border-slate-200 bg-white p-2 shadow-sm">
      <div className="px-1 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Vertex type
      </div>

      {VERTEX_TYPES.map((meta) => {
        const active = meta.type === selectedVertexType;

        return (
          <button
            key={meta.type}
            type="button"
            title={meta.label}
            onClick={() => setVertexType(meta.type)}
            className={[
              "flex items-center gap-2 rounded-md border px-2 py-1.5 text-left text-sm",
              active
                ? "border-slate-900 bg-slate-100 font-medium text-slate-900"
                : "border-transparent text-slate-700 hover:bg-slate-50",
            ].join(" ")}
          >
            <VertexSwatch meta={meta} />
            <span>{meta.label}</span>
          </button>
        );
      })}
    </div>
  );
}
