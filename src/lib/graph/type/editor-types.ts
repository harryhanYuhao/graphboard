// src/lib/graph/type/editor-types.ts
//
// Editor + document-level types: interaction modes, stable persisted ids,
// and the on-disk document shape (the `graph` / `view` slice split). The
// vertex- and edge-specific types live in `./vertex-types.ts` and
// `./edge-types.ts`; this file is the glue that references both.

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

import type { GraphNodeRecord, NodeView } from "./vertex-types";
import type { GraphEdgeRecord, EdgeView } from "./edge-types";

export type GraphSlice = {
  nodes: GraphNodeRecord[];
  edges: GraphEdgeRecord[];
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
