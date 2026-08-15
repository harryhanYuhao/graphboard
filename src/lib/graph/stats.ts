// src/lib/graph/stats.ts
//
// Pure graph statistics for the properties dialog. No store, no window —
// unit-testable in isolation.
import type { GraphEdge, VertexNode, VertexType } from "./types";
import { VERTEX_TYPES } from "./vertex-registry";

export type GraphStats = {
  vertexCount: number;
  edgeCount: number;
  // 0 when the graph has no vertices.
  minDegree: number;
  // 0 when the graph has no vertices.
  maxDegree: number;
  countsByType: Record<VertexType, number>;
};

export function computeGraphStats(
  nodes: VertexNode[],
  edges: GraphEdge[],
): GraphStats {
  // Undirected degree: every edge contributes 1 to each endpoint (2 for a
  // self-loop, matching the standard convention). Vertices without edges
  // keep degree 0.
  const degreeById = new Map<string, number>();
  for (const edge of edges) {
    degreeById.set(edge.source, (degreeById.get(edge.source) ?? 0) + 1);
    degreeById.set(edge.target, (degreeById.get(edge.target) ?? 0) + 1);
  }

  // Single pass — `Math.min(...degrees)` overflows the arg list (~65k
  // vertices throws RangeError) and allocates a throwaway array.
  let minDegree = 0;
  let maxDegree = 0;
  nodes.forEach((node, i) => {
    const degree = degreeById.get(node.id) ?? 0;
    if (i === 0 || degree < minDegree) minDegree = degree;
    if (i === 0 || degree > maxDegree) maxDegree = degree;
  });

  // Every vertex type starts at 0 so the breakdown always lists the full
  // type set, even the types currently absent from the graph. Null-prototype
  // so an untrusted `vertexType` from imported data can't read inherited
  // Object.prototype members.
  const countsByType = Object.create(null) as Record<VertexType, number>;
  for (const meta of VERTEX_TYPES) {
    countsByType[meta.type] = 0;
  }
  for (const node of nodes) {
    countsByType[node.data.vertexType] =
      (countsByType[node.data.vertexType] ?? 0) + 1;
  }

  return {
    vertexCount: nodes.length,
    edgeCount: edges.length,
    minDegree,
    maxDegree,
    countsByType,
  };
}
