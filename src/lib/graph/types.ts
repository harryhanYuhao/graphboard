// src/lib/graph/types.ts

import type { Edge, Node } from "@xyflow/react";

// ZXW generators. Each type renders with a distinct shape and color.
export type VertexType = "z" | "empty" | "x" | "w" | "h";

type VertexData = {
  label: string;
  vertexType: VertexType;
};

export type VertexNode = Node<VertexData, "vertex">;

export type GraphEdge = Edge;

export type GraphDocument = {
  id: string;
  title: string;
  nodes: VertexNode[];
  edges: GraphEdge[];
  createdAt: string;
  updatedAt: string;
};

export type EditorMode = "select" | "add-vertex" | "add-edge";
