// src/lib/graph/edge-registry.ts
//
// Edge-kind registry, mirroring `vertex-registry.ts`: `EDGE_KIND_MAP` is the
// single source of truth for each kind's user-facing name and swatch color,
// consumed by `EdgeKindSwatch`, `EdgeKindMenu`, and `EdgePropertyPanel`.
//
// The kind strings themselves live in `types.ts` (`EDGE_KINDS` /
// `EdgeKind` / `DEFAULT_EDGE_KIND`) because they are part of the persisted
// graph-slice contract; the display metadata lives here so the registry
// stays visual-only, exactly like `VERTEX_TYPES` (types) vs
// `VERTEX_TYPE_MAP` (metadata).

import { DEFAULT_EDGE_KIND, EDGE_KINDS, type EdgeKind } from "./types";

export type EdgeKindMeta = {
  label: string;
  stroke: string;
  // Dash pattern for the edge line. `undefined` (not "") means "no dash":
  // an empty `stroke-dasharray` string is invalid SVG and React would still
  // emit the attribute.
  strokeDashArray?: string;
  strokeWidth: number;
};

// Keys must cover `EDGE_KINDS` exactly (pinned by `edge-registry.test.ts`).
export const EDGE_KIND_MAP: Record<EdgeKind, EdgeKindMeta> = {
  default: {
    label: "Default",
    stroke: "#334155",
    strokeWidth: 1.5,
  },
  dashed_blue: {
    label: "Dashed blue",
    stroke: "#2563eb",
    strokeDashArray: "4 1.5",
    strokeWidth: 2,
  },
  dashed_light: {
    label: "Dashed light",
    stroke: "#808080",
    strokeDashArray: "2 1.5",
    strokeWidth: 1,
  },
};

// Coerce an untrusted `data.kind` (imported docs are user-controlled) to a
// valid member. Absent / non-string / unknown values degrade to the default
// kind. Used at the hydration boundary so the renderer, disk, and compute
// layer only ever meet valid members; the renderer additionally falls back
// in `edgeKindPathStyle` (defense in depth for smuggled runtime values).
export function coerceEdgeKind(kind: unknown): EdgeKind {
  return typeof kind === "string" &&
    (EDGE_KINDS as readonly string[]).includes(kind)
    ? (kind as EdgeKind)
    : DEFAULT_EDGE_KIND;
}
