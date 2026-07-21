// src/lib/graph/types.ts

import type { Edge, Node } from "@xyflow/react";

// Vertex type. `input` / `output` are boundary markers (not tensors):
// they declare open legs of the resulting tensor (each leg dimension 2),
// so n inputs + m outputs → 2^m × 2^n matrix after contraction; no
// boundaries → scalar. See `isBoundaryVertex` in vertex-types.ts.
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
// These string constants are the contract between the runtime edge layer
// (`createGraphEdge` in operations.ts), the serializer (handle-id ↔
// index translation in serialization.ts), and the renderer (`VertexNode`
// and `StraightCenterEdge`). Centralizing them here ensures a typo at
// one site can't silently break edge routing at another — don't sprinkle
// the literals elsewhere.
//
// React Flow handle ids used on VertexNode. `center-source` /
// `center-target` are the full-size transparent overlays at the body
// center; `top` is the small visible dot that anchors the directional
// W / And-gate target.
export const HANDLE_IDS = {
  centerSource: "center-source",
  centerTarget: "center-target",
  top: "top",
} as const satisfies Record<string, string>;

export type HandleId = (typeof HANDLE_IDS)[keyof typeof HANDLE_IDS];

// React Flow edge type discriminator. Today there's only one
// (`straight-center`); registering the constant here means future
// renderer variants slot in without grepping for string literals.
export const EDGE_TYPES = {
  straightCenter: "straight-center",
} as const satisfies Record<string, string>;

export type EdgeType = (typeof EDGE_TYPES)[keyof typeof EDGE_TYPES];

// ---- Persisted document identifiers ----------------------------------------
//
// Stable ids used by `createEmptyGraphDocument` and the export entry point
// so the on-disk / on-the-wire payload is greppable without sprinkling
// string literals across `serialization.ts`.
export const PERSISTED_IDS = {
  localDocument: "local-document",
  exportedDocument: "exported-document",
} as const;

export type VertexData = {
  label: string;
  vertexType: VertexType;
};

// ---- Runtime layer (in-memory, what the store + React Flow hold) -----------
//
// These are React Flow's own object types. They carry everything the renderer
// needs at runtime: position, React Flow plumbing (`origin`, `type`),
// ephemeral state (`selected`), and at render time React Flow injects
// `measured`, `internals.positionAbsolute`, etc. They are never persisted —
// see the persistence layer below.

// Runtime `VertexNode` carries a top-level `rotation` field. The field
// lives outside `data` deliberately: rotation is a visual concern and
// belongs in the view slice (see `NodeView` below), not in `VertexData`
// which is part of the graph slice the future compute layer consumes.
export type VertexNode = Node<VertexData, "vertex"> & {
  rotation: number;
};

export type GraphEdge = Edge;

// ---- Persistence layer (on-disk, what crosses the serialization boundary) ---
//
// The persisted document is split into two parallel slices:
//
//   - `graph` — graph-theoretic information only. This is the contract that
//     future compute layers (Rust crate compiled to WASM, other researchers'
//     tooling) consume. Contains node identity, label, vertex type, and edge
//     endpoints. Nothing visual, nothing React-Flow-shaped.
//
//   - `view` — visual information. Position today; future edge curvature,
//     group colors, edge labels go here. The renderer rebuilds runtime
//     React Flow objects by joining `graph` + `view` on node/edge id.
//
// The split exists so that:
//   1. The WASM boundary is trivial — `serde` deserializes `graph` directly.
//   2. Visual changes don't dirty the schema; React Flow's runtime fields
//      never leak into the document.
//   3. Selection (`selected`) and other ephemeral state are *not* persisted.
//      Pre-split, the document accidentally carried `selected: true` through
//      reloads — a latent bug fixed by the split.

// Persisted vertex — only what computation needs.
export type GraphNodeRecord = {
  id: string;
  data: VertexData;
};

// Persisted edge — id plus endpoints, plus the connection-point
// indices on each side. We deliberately do not persist React Flow's
// `type` discriminator ("straight-center") here; that's a renderer
// detail and may change without affecting the graph.
//
// `sourceHandle` / `targetHandle` are numeric indices into the
// respective vertex's handle slots: 0 = top, 1 = bottom. Indexed
// (not id-based) so future vertex types with more than two handles
// can extend the scheme without churning the schema. Absent on
// legacy documents — see `serialization.ts` for the default values
// applied at hydration.
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

// View entry for a node — position and rotation today; more visual fields
// later. Future additions: group/parent id, per-node style overrides.
//
// `rotation` is in degrees, applied to the vertex body via CSS transform.
// It is *visual only* — the future compute layer (Rust/WASM) reads
// `graph` and never sees this field. Optional in persisted documents
// for backward compatibility with pre-rotation saves; missing values
// hydrate to 0.
export type NodeView = {
  id: string;
  position: { x: number; y: number };
  rotation?: number;
};

// View entry for an edge — placeholder for future curvature, label position,
// stroke style, etc. Empty for now.
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

export type EditorMode = "select" | "add-vertex" | "add-edge";
