// src/lib/graph/types.ts

import type { Edge, Node } from "@xyflow/react";

// ZXW generators. Each type renders with a distinct shape and color.
export type VertexType = "z" | "empty" | "x" | "w" | "h" | "zbox" | "xbox" | "and";

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

// Persisted edge — id plus endpoints. We deliberately do not persist React
// Flow's `type` discriminator ("straight-center") here; that's a renderer
// detail and may change without affecting the graph.
export type GraphEdgeRecord = {
  id: string;
  source: string;
  target: string;
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
