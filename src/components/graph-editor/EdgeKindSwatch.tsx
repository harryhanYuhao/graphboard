// src/components/graph-editor/EdgeKindSwatch.tsx
//
// Small line preview for an edge kind, used by `EdgeKindMenu` and
// `EdgePropertyPanel`. Mirrors `VertexSwatch.tsx` (a component over the
// kind registry in `edge-kinds.ts`).

"use client";

import { EDGE_KIND_MAP } from "@/lib/graph/edge-kinds";
import type { EdgeKind } from "@/lib/graph/types";

export function EdgeKindSwatch({ kind }: { kind: EdgeKind }) {
  const meta = EDGE_KIND_MAP[kind];
  return (
    <svg width="32" height="8" viewBox="0 0 32 8" aria-hidden="true">
      <line
        x1="0"
        y1="4"
        x2="32"
        y2="4"
        stroke={meta.stroke}
        strokeWidth={meta.strokeWidth}
        // Same dash pattern the edges themselves draw (edgeKindPathStyle).
        strokeDasharray={meta.strokeDashArray}
      />
    </svg>
  );
}
