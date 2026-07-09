import { nanoid } from "nanoid";
import type { GraphEdge, VertexNode, VertexType } from "./types";
import { DEFAULT_VERTEX_TYPE, VERTEX_TYPE_MAP } from "./vertex-types";

export function createVertexNode(
  position: {
    x: number;
    y: number;
  },
  vertexType: VertexType = DEFAULT_VERTEX_TYPE,
): VertexNode {
  const id = nanoid();

  return {
    id,
    type: "vertex",
    position,
    origin: [0.5, 0.5],
    rotation: 0,
    data: {
      label: VERTEX_TYPE_MAP[vertexType]?.defaultText ?? "",
      vertexType,
    },
  };
}

export function createGraphEdge(source: string, target: string): GraphEdge {
  return {
    id: nanoid(),
    source,
    target,
    type: "straight-center",
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

// Per-paste translation step (in flow-space units). Each consecutive paste
// from the same clipboard shifts further so duplicates don't overlap exactly.
export const PASTE_OFFSET_STEP = 24;

// Pull out the currently-selected nodes plus the edges that form a self-contained
// subgraph (both endpoints selected). Edges with only one selected endpoint are
// dropped — pasting them would create dangling references.
export function getSelectedSubgraph(params: {
  nodes: VertexNode[];
  edges: GraphEdge[];
}): {
  nodes: VertexNode[];
  edges: GraphEdge[];
} {
  const selectedNodes = params.nodes.filter((node) => node.selected);
  const selectedNodeIds = new Set(selectedNodes.map((node) => node.id));

  const selectedEdges = params.edges.filter(
    (edge) =>
      selectedNodeIds.has(edge.source) && selectedNodeIds.has(edge.target),
  );

  return { nodes: selectedNodes, edges: selectedEdges };
}

// Mark every node and edge as selected. Returned arrays are new arrays so
// the Zustand store picks up the change as a reference diff.
export function selectAllElements(params: {
  nodes: VertexNode[];
  edges: GraphEdge[];
}): {
  nodes: VertexNode[];
  edges: GraphEdge[];
} {
  return {
    nodes: params.nodes.map((node) =>
      node.selected ? node : { ...node, selected: true },
    ),
    edges: params.edges.map((edge) =>
      edge.selected ? edge : { ...edge, selected: true },
    ),
  };
}

// Mark every node and edge as not selected. Returned arrays are new arrays
// so the Zustand store picks up the change as a reference diff.
export function clearAllSelections(params: {
  nodes: VertexNode[];
  edges: GraphEdge[];
}): {
  nodes: VertexNode[];
  edges: GraphEdge[];
} {
  return {
    nodes: params.nodes.map((node) =>
      node.selected ? { ...node, selected: false } : node,
    ),
    edges: params.edges.map((edge) =>
      edge.selected ? { ...edge, selected: false } : edge,
    ),
  };
}

// Shallow-clone the subgraph for clipboard storage. IDs are preserved so the
// clipboard payload keeps its internal edge→node references intact; IDs are
// re-minted only when the subgraph is actually pasted.
export function cloneSubgraphForClipboard(subgraph: {
  nodes: VertexNode[];
  edges: GraphEdge[];
}): {
  nodes: VertexNode[];
  edges: GraphEdge[];
} {
  return {
    nodes: subgraph.nodes.map((node) => ({
      ...node,
      data: { ...node.data },
    })),
    edges: subgraph.edges.map((edge) => ({ ...edge })),
  };
}

// Re-mint every node and edge ID, remap edge endpoints to the new node IDs,
// translate positions by `pasteCount * PASTE_OFFSET_STEP`, and mark all
// produced elements selected so the user can immediately move the result.
export function pasteSubgraph(params: {
  subgraph: {
    nodes: VertexNode[];
    edges: GraphEdge[];
  };
  pasteCount: number;
}): {
  nodes: VertexNode[];
  edges: GraphEdge[];
} {
  const offset = params.pasteCount * PASTE_OFFSET_STEP;

  const idMap = new Map<string, string>();
  for (const node of params.subgraph.nodes) {
    idMap.set(node.id, nanoid());
  }

  const newNodes: VertexNode[] = params.subgraph.nodes.map((node) => ({
    ...node,
    id: idMap.get(node.id) as string,
    position: {
      x: node.position.x + offset,
      y: node.position.y + offset,
    },
    data: { ...node.data },
    selected: true,
  }));

  const newEdges: GraphEdge[] = params.subgraph.edges.map((edge) => {
    const newSource = idMap.get(edge.source);
    const newTarget = idMap.get(edge.target);

    if (!newSource || !newTarget) {
      // Should be impossible — getSelectedSubgraph guarantees every edge's
      // endpoints are in the node set.
      throw new Error("pasteSubgraph: edge endpoint missing from subgraph");
    }

    return {
      ...edge,
      id: nanoid(),
      source: newSource,
      target: newTarget,
      selected: true,
    };
  });

  return { nodes: newNodes, edges: newEdges };
}

