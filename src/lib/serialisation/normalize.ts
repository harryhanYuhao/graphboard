// src/lib/serialisation/normalize.ts
//
// Position normalisation for exports: shift the graph so its mean position
// is the origin, so exported files don't carry absolute canvas offsets.
// Pure — never mutates the input nodes.
import type { VertexNode } from "../graph/types";

// Mean of all node positions. `[0, 0]` for an empty graph.
export function meanPosition(nodes: VertexNode[]): [number, number] {
  if (nodes.length === 0) return [0, 0];

  let sumX = 0;
  let sumY = 0;
  for (const node of nodes) {
    sumX += node.position.x;
    sumY += node.position.y;
  }

  return [sumX / nodes.length, sumY / nodes.length];
}

// Shallow-copies the nodes with positions shifted so the mean lands on the
// origin. The input array and its nodes are left untouched — callers pass the
// live store nodes, which must not move.
export function normalizeNodePositions(nodes: VertexNode[]): VertexNode[] {
  if (nodes.length === 0) return [];

  const [meanX, meanY] = meanPosition(nodes);
  return nodes.map((node) => ({
    ...node,
    position: {
      x: node.position.x - meanX,
      y: node.position.y - meanY,
    },
  }));
}
