// src/lib/graph/types.ts

import type { Edge, Node } from "@xyflow/react";

// ZXW generators. Each type renders with a distinct shape and color.
export type VertexType = "z" | "empty" | "x" | "w" | "h" | "zbox" | "xbox" | "and";

type VertexData = {
  label: string;
  vertexType: VertexType;
};

export type VertexNode = Node<VertexData, "vertex">;

export type GraphEdge = Edge;

// Schema versions are integers; bump when the GraphDocument shape changes
// in a way the consumer (Rust/WASM compute layer, other researchers' tooling)
// needs to know about. Persisted documents carry the version they were saved
// with so the loader can reject or migrate unsupported files cleanly.
export const CURRENT_SCHEMA_VERSION = 1;

export type GraphDocument = {
  schemaVersion: number;
  id: string;
  title: string;
  nodes: VertexNode[];
  edges: GraphEdge[];
  createdAt: string;
  updatedAt: string;
};

export type EditorMode = "select" | "add-vertex" | "add-edge";
