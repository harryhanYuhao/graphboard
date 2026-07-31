// Pure selectors over `GraphStore` state, kept separate so they're unit-testable.

import type { GraphEdge, VertexNode } from "@/lib/graph/types";

/** Ids of every node with `selected === true`. */
export function selectSelectedNodeIds(nodes: VertexNode[]): string[] {
  return nodes.filter((node) => node.selected).map((node) => node.id);
}

/** True when at least one node or edge is selected (drives the Escape-clear ladder). */
export function hasSelection(
  nodes: VertexNode[],
  edges: GraphEdge[],
): boolean {
  return (
    nodes.some((node) => node.selected) ||
    edges.some((edge) => edge.selected)
  );
}

// id → node map, cached by the input array's identity. Per-node store
// subscribers (rotation hook, edge endpoint lookup) need O(1) lookup;
// without this they did `nodes.find(...)` on every store update, making
// a drag O(n²).
const nodeMapCache = new WeakMap<VertexNode[], Map<string, VertexNode>>();

export function nodesById(nodes: VertexNode[]): Map<string, VertexNode> {
  const cached = nodeMapCache.get(nodes);
  if (cached) return cached;
  const map = new Map<string, VertexNode>();
  for (const node of nodes) map.set(node.id, node);
  nodeMapCache.set(nodes, map);
  return map;
}

