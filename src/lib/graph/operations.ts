import { nanoid } from "nanoid";
import type { GraphEdge, VertexNode } from "./types";

export function createVertexNode(position: { x: number; y: number }): VertexNode {
  const id = nanoid();

  return {
    id,
    type: "vertex",
    position,
    data: {
      label: id.slice(0, 4),
    },
  };
}

export function createGraphEdge(source: string, target: string): GraphEdge {
  return {
    id: nanoid(),
    source,
    target,
    type: "default",
    data: {
      directed: false,
    },
  };
}

export function deleteSelectedElements(params: {
  nodes: VertexNode[];
  edges: GraphEdge[];
}): {
  nodes: VertexNode[];
  edges: GraphEdge[];
} {
  const selectedNodeIds = new Set(
    params.nodes.filter((node) => node.selected).map((node) => node.id),
  );

  const selectedEdgeIds = new Set(
    params.edges.filter((edge) => edge.selected).map((edge) => edge.id),
  );

  return {
    nodes: params.nodes.filter((node) => !selectedNodeIds.has(node.id)),
    edges: params.edges.filter((edge) => {
      if (selectedEdgeIds.has(edge.id)) return false;
      if (selectedNodeIds.has(edge.source)) return false;
      if (selectedNodeIds.has(edge.target)) return false;
      return true;
    }),
  };
}