// src/lib/graph/edge-kinds.ts
//
// Edge-kind registry, mirroring `vertex-types.ts`: `EDGE_KIND_MAP` is the
// single source of truth for each kind's user-facing name and swatch color,
// consumed by `EdgeKindSwatch`, `EdgeKindMenu`, and `EdgePropertyPanel`.
//
// The kind strings themselves live in `types.ts` (`EDGE_KINDS` /
// `EdgeKind` / `DEFAULT_EDGE_KIND`) because they are part of the persisted
// graph-slice contract; the display metadata lives here so the registry
// stays visual-only, exactly like `VERTEX_TYPES` (types) vs
// `VERTEX_TYPE_MAP` (metadata).

import type { EdgeKind } from "./types";

export type EdgeKindMeta = {
  label: string;
  stroke: string;
};

// Keys must cover `EDGE_KINDS` exactly (pinned by `edge-kinds.test.ts`).
export const EDGE_KIND_MAP: Record<EdgeKind, EdgeKindMeta> = {
  default: { label: "Default", stroke: "#334155" },
  dashed_blue: { label: "Dashed blue", stroke: "#2563eb" },
};
