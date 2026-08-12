// src/lib/graph/type/edge-types.ts
//
// Edge types: the React Flow renderer discriminator (EDGE_TYPES), the
// semantic edge kinds (EDGE_KINDS / EdgeKind), and the runtime `GraphEdge`
// plus its persisted records (`GraphEdgeRecord`, `EdgeView`).
//
// The kind display metadata (labels, swatch colours, dash/width) lives in
// `src/lib/graph/edge-registry.ts` — the registry, not the types.

import type { Edge } from "@xyflow/react";

// ---- Edge string-literal vocabularies --------------------------------------
//
// Centralized string constants — the shared contract between edge creation
// (operations.ts), serialisation (src/lib/serialisation/document.ts), and the
// renderer. Don't sprinkle the literals elsewhere.

// React Flow edge type discriminator. Only `straight-center` today; the
// constant keeps future variants from scattering string literals.
export const EDGE_TYPES = {
  straightCenter: "straight-center",
} as const satisfies Record<string, string>;

export type EdgeType = (typeof EDGE_TYPES)[keyof typeof EDGE_TYPES];

// Edge kinds — the edge equivalent of `vertexType`. The kind lives in the
// graph slice (`GraphEdge.data.kind`, persisted as `GraphEdgeRecord.data`)
// because different kinds will carry different compute definitions; today
// all kinds compute identically. On-disk spellings are snake_case, matching
// the vertex-type convention (`black_dot`), while the UI shows prettier
// names (see the edge-kind swatches in EdgePropertyPanel).
export const EDGE_KINDS = ["default", "dashed_blue", "dashed_light"] as const;

export type EdgeKind = (typeof EDGE_KINDS)[number];

// Unset edge kinds hydrate to this (legacy docs / hand-edited imports).
export const DEFAULT_EDGE_KIND: EdgeKind = "default";

// ---- Runtime layer ----------------------------------------------------------

// Runtime edge. `data.kind` is the edge kind (graph slice — persisted and
// sent to the compute layer, where future kinds will compute differently).
export type GraphEdge = Edge<{ kind: EdgeKind }>;

// ---- Persisted edge records -------------------------------------------------

// Persisted edge — endpoints plus connection-point indices. React Flow's
// `type` discriminator is intentionally not persisted (renderer detail).
//
// `sourceHandle` / `targetHandle` are indices into the vertex's handle slots
// (0 = top, 1 = bottom) — indexed not id-based so future vertex types with
// more than two handles can extend the scheme without schema churn. Absent on
// legacy documents; `src/lib/serialisation/document.ts` applies defaults at
// hydration.
//
// `data.kind` is additive-optional (the `order` precedent): legacy docs and
// hand-edited imports without it hydrate to DEFAULT_EDGE_KIND. The project
// side always writes it.
export type GraphEdgeRecord = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: number;
  targetHandle?: number;
  data?: { kind?: EdgeKind };
};

// View entry for an edge — placeholder for future curvature/label/style. Empty for now.
export type EdgeView = {
  id: string;
};
