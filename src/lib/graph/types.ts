// src/lib/graph/types.ts

import type { Edge, Node } from "@xyflow/react";

// Vertex type. `input` / `output` are boundary markers (not tensors): they
// declare open legs (dimension 2 each), so n inputs + m outputs → 2^m × 2^n
// matrix after contraction; no boundaries → scalar. See `isBoundaryVertex`.
export type VertexType =
  | "z"
  | "empty"
  | "x"
  | "w"
  | "h"
  | "zbox"
  | "xbox"
  | "and"
  | "input"
  | "output";

// ---- React Flow handle & edge identifiers ---------------------------------
//
// Centralized string constants — the shared contract between edge creation
// (operations.ts), serialization (serialization.ts), and the renderer. Don't
// sprinkle the literals elsewhere.
//
// React Flow handle ids on VertexNode: `center-source` / `center-target` are
// the transparent overlays at the body center; `top` is the visible dot that
// anchors the directional W / And-gate target.
export const HANDLE_IDS = {
  centerSource: "center-source",
  centerTarget: "center-target",
  top: "top",
} as const satisfies Record<string, string>;

export type HandleId = (typeof HANDLE_IDS)[keyof typeof HANDLE_IDS];

// React Flow edge type discriminator. Only `straight-center` today; the
// constant keeps future variants from scattering string literals.
export const EDGE_TYPES = {
  straightCenter: "straight-center",
} as const satisfies Record<string, string>;

export type EdgeType = (typeof EDGE_TYPES)[keyof typeof EDGE_TYPES];

// ---- Persisted document identifiers ----------------------------------------
//
// Stable ids for `createEmptyGraphDocument` and export, keeping literals
// out of serialization.ts.
export const PERSISTED_IDS = {
  localDocument: "local-document",
  exportedDocument: "exported-document",
} as const;

export type VertexData = {
  label: string;
  vertexType: VertexType;
  // 0-indexed ordering of `input` / `output` boundary vertices, sets the final
  // axis order of the contracted tensor (Rust compute layer §5.4). Inputs and
  // outputs order independently; ignored for other types. Optional — missing
  // falls back to array position so older saved graphs still work.
  order?: number;
};

// ---- Runtime layer (in-memory, what the store + React Flow hold) -----------
//
// React Flow's own object types: renderer data (position, plumbing, ephemeral
// `selected`); React Flow injects `measured`, `internals.positionAbsolute`, etc.
// at render time. Never persisted — see the persistence layer below.

// `rotation` lives outside `data` deliberately — it's a visual concern that
// belongs in the view slice (`NodeView`), not in the graph-slice `VertexData`.
export type VertexNode = Node<VertexData, "vertex"> & {
  rotation: number;
};

export type GraphEdge = Edge;

// ---- Persistence layer (on-disk, what crosses the serialization boundary) ---
//
// The document is split into two parallel slices:
//   - `graph` — graph-theoretic data only; what compute layers (Rust/WASM)
//     consume. No visual or React-Flow-shaped fields.
//   - `view` — visual data (position today, future curvature/labels). The
//     renderer rebuilds runtime objects by joining `graph` + `view` on id.
//
// The split keeps the WASM `serde` boundary trivial, stops React Flow runtime
// fields from dirtying the schema, and ensures ephemeral state like `selected`
// is never persisted.

// Persisted vertex — only what computation needs.
export type GraphNodeRecord = {
  id: string;
  data: VertexData;
};

// Persisted edge — endpoints plus connection-point indices. React Flow's
// `type` discriminator is intentionally not persisted (renderer detail).
//
// `sourceHandle` / `targetHandle` are indices into the vertex's handle slots
// (0 = top, 1 = bottom) — indexed not id-based so future vertex types with
// more than two handles can extend the scheme without schema churn. Absent on
// legacy documents; `serialization.ts` applies defaults at hydration.
export type GraphEdgeRecord = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: number;
  targetHandle?: number;
};

export type GraphSlice = {
  nodes: GraphNodeRecord[];
  edges: GraphEdgeRecord[];
};

// View entry for a node — position and rotation today; more visual fields later.
//
// `rotation` is degrees, applied via CSS transform. Visual only — the compute
// layer reads `graph` and never sees this. Optional for backward compat with
// pre-rotation saves; missing values hydrate to 0.
export type NodeView = {
  id: string;
  position: { x: number; y: number };
  rotation?: number;
};

// View entry for an edge — placeholder for future curvature/label/style. Empty for now.
export type EdgeView = {
  id: string;
};

export type ViewSlice = {
  nodes: NodeView[];
  edges: EdgeView[];
};

export const CURRENT_SCHEMA_VERSION = 1;

export type GraphDocument = {
  schemaVersion: number;
  id: string;
  title: string;
  graph: GraphSlice;
  view: ViewSlice;
  createdAt: string;
  updatedAt: string;
};

// Editor interaction modes. Mirrors the HANDLE_IDS / EDGE_TYPES pattern
// (string-literal source of truth) so a typo like "add-egde" fails to compile.
export const EDITOR_MODES = {
  select: "select",
  addVertex: "add-vertex",
  addEdge: "add-edge",
} as const satisfies Record<string, string>;

export type EditorMode = (typeof EDITOR_MODES)[keyof typeof EDITOR_MODES];
