// src/lib/graph/types.ts

import type { Edge, Node } from "@xyflow/react";

// ZXW generators. Each type renders with a distinct shape and color.
export type VertexType = "z" | "empty" | "x" | "w" | "h";

export type VertexData = {
  label: string;
  vertexType: VertexType;
};

export type EdgeData = {
  label?: string;
  weight?: number;
  directed?: boolean;
};

export type VertexNode = Node<VertexData, "vertex">;

export type GraphEdge = Edge<EdgeData>;

export type GraphDocument = {
  id: string;
  title: string;
  nodes: VertexNode[];
  edges: GraphEdge[];
  viewport?: {
    x: number;
    y: number;
    zoom: number;
  };
  createdAt: string;
  updatedAt: string;
};

export type EditorMode = "select" | "add-vertex" | "add-edge" | "delete";
