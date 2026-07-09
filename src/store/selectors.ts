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
