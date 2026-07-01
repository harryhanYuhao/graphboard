// src/lib/graph/types.ts

import type { Edge, Node } from "@xyflow/react";

export type VertexData = {
  label: string;
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