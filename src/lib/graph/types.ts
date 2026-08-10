// src/lib/graph/types.ts
//
// Shared graph types, top to bottom:
//
//   1. Vertex types  — the 11 vertex types and what each one is
//   2. Constants     — string-literal sources of truth (HANDLE_IDS,
//                      EDGE_TYPES, EDGE_KINDS, PERSISTED_IDS,
//                      EDITOR_MODES); the literal values are a contract, so
//                      they're never sprinkled elsewhere in the codebase
//   3. VertexData    — graph-slice vertex data (phase, vertexType, order):
//                      exactly what the compute layer (Rust/WASM) consumes
//   4. Runtime layer — VertexNode / GraphEdge: React Flow's in-memory
//                      objects. View fields (rotation, visual label) ride on
//                      VertexNode but are never persisted
//   5. Persistence   — GraphDocument split into a `graph` slice (compute
//                      contract) + `view` slice (visual only), schema-
//                      versioned via CURRENT_SCHEMA_VERSION
//
// Per-type behaviour predicates (isSpiderType, isDirectionalVertex,
// isBoundaryVertex) and the visual metadata table (VERTEX_TYPE_MAP) live in
// `./vertex-types.ts`, not here.

import type { Edge, Node } from "@xyflow/react";

// ---- Vertex types -----------------------------------------------------------
//
// The 11 vertex types, grouped by role:
//
//   Spiders (phase-bearing, `isSpiderType`): z, x, zbox, xbox
//     The phase expression lives in `VertexData.phase` (empty = phase 0).
//     z / x are round spiders; zbox / xbox are their boxed variants.
//   Directional (`isDirectionalVertex`): w, and
//     One input at the top, fan-out outputs at the bottom. The W generator
//     and the And gate.
//   Boxes (fixed arity): h
//     The Hadamard box, always arity 2.
//   Plain markers: empty, black_dot
//     `empty`: the empty node (isolated → scalar 1, wired → identity).
//     `black_dot`: a filled dot — a phaseless Z spider (compute:
//     z_spider(arity, 0)).
//   Boundary (`isBoundaryVertex`): input, output
//     Not tensors — they declare the open legs (dimension 2 each), so
//     n inputs + m outputs → 2^m × 2^n matrix after contraction; no
//     boundaries → scalar.
//
// `VERTEX_TYPE_MAP` in `./vertex-types.ts` is the single source of truth for
// shape/colour/size and the behaviour predicates above.
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
  | "output"
  | "black_dot";

// ---- Shared string-literal constants ---------------------------------------
//
// Centralized string constants — the shared contract between edge creation
// (operations.ts), serialisation (src/lib/serialisation/document.ts), and the
// renderer. Don't sprinkle the literals elsewhere. Each block follows the same
// pattern: an object literal + a derived union type, so a typo like
// "add-egde" fails to compile.

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

// Edge kinds — the edge equivalent of `vertexType`. The kind lives in the
// graph slice (`GraphEdge.data.kind`, persisted as `GraphEdgeRecord.data`)
// because different kinds will carry different compute definitions; today
// both kinds compute identically. On-disk spellings are snake_case, matching
// the vertex-type convention (`black_dot`), while the UI shows prettier
// names (see the edge-kind swatches in EdgePropertyPanel).
export const EDGE_KINDS = ["default", "dashed_blue"] as const;

export type EdgeKind = (typeof EDGE_KINDS)[number];

// Unset edge kinds hydrate to this (legacy docs / hand-edited imports).
export const DEFAULT_EDGE_KIND: EdgeKind = "default";

// Stable ids for `createEmptyGraphDocument` and export, keeping literals
// out of the serialisation module.
export const PERSISTED_IDS = {
  localDocument: "local-document",
  exportedDocument: "exported-document",
} as const;

// Editor interaction modes. Mirrors the HANDLE_IDS / EDGE_TYPES pattern
// (string-literal source of truth) so a typo like "add-egde" fails to compile.
export const EDITOR_MODES = {
  select: "select",
  addVertex: "add-vertex",
  addEdge: "add-edge",
} as const satisfies Record<string, string>;

export type EditorMode = (typeof EDITOR_MODES)[keyof typeof EDITOR_MODES];

// ---- Vertex data (graph slice) ---------------------------------------------

export type VertexData = {
  // The vertex's phase expression — the compute input for spider/box types
  // (`z`/`x`/`zbox`/`xbox`); decoration only for other types. Empty = phase 0
  // (identity). Renamed from `label` in schema v2 so the name matches its
  // semantics; the visual label now lives in the view slice (`NodeView.label`).
  phase: string;
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

// `rotation`, `label`, and `labelLocation` live outside `data` deliberately —
// they are visual concerns that belong in the view slice (`NodeView`), not in
// the graph-slice `VertexData`.
export type VertexNode = Node<VertexData, "vertex"> & {
  rotation: number;
  // Visual annotation (KaTeX-enabled) shown near the node; "" = not shown.
  label: string;
  // Where the visual label sits relative to the node body.
  labelLocation: LabelLocation;
};

// Runtime edge. `data.kind` is the edge kind (graph slice — persisted and
// sent to the compute layer, where future kinds will compute differently).
export type GraphEdge = Edge<{ kind: EdgeKind }>;

// ---- Persistence layer (on-disk, what crosses the serialization boundary) ---
//
// The document is split into two parallel slices:
//   - `graph` — graph-theoretic data only; what compute layers (Rust/WASM)
//     consume. No visual or React-Flow-shaped fields.
//   - `view` — visual data only (position, rotation, visual label today). The
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

export type GraphSlice = {
  nodes: GraphNodeRecord[];
  edges: GraphEdgeRecord[];
};

// ---- View slice (visual only, never seen by compute) -----------------------

// Where a visual label sits relative to its node; `none` hides it. Default is
// above the node (DEFAULT_LABEL_LOCATION).
export const LABEL_LOCATIONS = [
  "top",
  "bottom",
  "left",
  "right",
  "none",
] as const;

export type LabelLocation = (typeof LABEL_LOCATIONS)[number];

// Where an unset label location defaults to: above the node.
export const DEFAULT_LABEL_LOCATION: LabelLocation = "top";

// View entry for a node — position, rotation, and the visual label today;
// more visual fields later.
//
// `rotation` is degrees, applied via CSS transform. `label` is a KaTeX-enabled
// annotation shown near the node (see `src/lib/label/renderLabel.ts`);
// `labelLocation` picks which side it sits on. All visual only — the compute
// layer reads `graph` and never sees these. Optional for backward compat with
// pre-rotation/pre-label saves; missing values hydrate to defaults (rotation
// 0, label "", labelLocation "top").
export type NodeView = {
  id: string;
  position: { x: number; y: number };
  rotation?: number;
  label?: string;
  labelLocation?: LabelLocation;
};

// View entry for an edge — placeholder for future curvature/label/style. Empty for now.
export type EdgeView = {
  id: string;
};

export type ViewSlice = {
  nodes: NodeView[];
  edges: EdgeView[];
};

export const CURRENT_SCHEMA_VERSION = 2;

export type GraphDocument = {
  schemaVersion: number;
  id: string;
  title: string;
  graph: GraphSlice;
  view: ViewSlice;
  createdAt: string;
  updatedAt: string;
};
