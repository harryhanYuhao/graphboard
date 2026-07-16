// src/store/selectors.ts
//
// Pure selector functions over `GraphStore` state. Centralising the
// "find the selected ids" / "is anything selected" boilerplate keeps
// the call sites in the store and the keyboard hook short and lets
// the selectors be unit-tested in isolation.

import type { GraphEdge, VertexNode } from "@/lib/graph/types";

// Return the ids of every node that has `selected === true`. Used by
// the add-edge click handler and `addSelectedToPendingSources`.
export function selectSelectedNodeIds(nodes: VertexNode[]): string[] {
  return nodes.filter((node) => node.selected).map((node) => node.id);
}

// True when at least one node or edge is currently selected. Used by
// the Escape ladder in the keyboard hook to decide whether the next
// Escape should clear the selection.
export function hasSelection(
  nodes: VertexNode[],
  edges: GraphEdge[],
): boolean {
  return (
    nodes.some((node) => node.selected) ||
    edges.some((edge) => edge.selected)
  );
}

// Build an id → node map from a node list. The map is rebuilt only
// when the input array's identity changes; a `WeakMap` keyed on the
// array reference caches the result so per-node store subscribers
// (`VertexNode`'s rotation hook, the edge component's endpoint
// lookup) get O(1) access without paying the O(n) build cost on
// every store update.
//
// Without this, `VertexNode` did `state.nodes.find(n => n.id === id)`
// inside a Zustand selector — the selector body runs on every store
// update for every mounted vertex, making a drag O(n²).
const nodeMapCache = new WeakMap<VertexNode[], Map<string, VertexNode>>();

export function nodesById(nodes: VertexNode[]): Map<string, VertexNode> {
  const cached = nodeMapCache.get(nodes);
  if (cached) return cached;
  const map = new Map<string, VertexNode>();
  for (const node of nodes) map.set(node.id, node);
  nodeMapCache.set(nodes, map);
  return map;
}

