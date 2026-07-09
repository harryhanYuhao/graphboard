import { nanoid } from "nanoid";
import {
  EDGE_TYPES,
  HANDLE_IDS,
  type GraphEdge,
  type VertexNode,
  type VertexType,
} from "./types";
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

export function createGraphEdge(
  source: string,
  target: string,
  nodes?: VertexNode[],
): GraphEdge {
  // Pick the target handle id based on the target vertex's type. For
  // directional vertices (W, And gate) the target handle is the
  // visible top dot (HANDLE_IDS.top); for everything else it's the
  // centered target (HANDLE_IDS.centerTarget). The source handle is
  // always the bottom slot (HANDLE_IDS.centerSource) — the side edges
  // leave from. Passing `nodes` is optional so legacy callers (and
  // tests) keep working; without it we fall back to the
  // non-directional default.
  let targetHandle: string | undefined;
  if (nodes) {
    const targetNode = nodes.find((n) => n.id === target);
    const meta = targetNode
      ? VERTEX_TYPE_MAP[targetNode.data.vertexType]
      : undefined;
    targetHandle = meta?.directional ? HANDLE_IDS.top : HANDLE_IDS.centerTarget;
  }

  return {
    id: nanoid(),
    source,
    target,
    sourceHandle: HANDLE_IDS.centerSource,
    targetHandle,
    type: EDGE_TYPES.straightCenter,
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

// ---- Click dispatch (add-edge mode) --------------------------------------
//
// The store's `handleVertexClick` dispatches a click into one of six
// mutually-exclusive cases (cmd, shift+empty, shift+non-empty,
// plain+empty, plain+toggle-off, plain+fan-out-and-clear). Rather
// than duplicate the case logic inside the store, the cases live
// here as a single pure function returning a state patch — keeps
// `graph-store.ts` thin and lets the cases be unit-tested without
// standing up a store.

export type VertexClickModifiers = {
  // Cmd (mac) or Ctrl (win/linux) — used to add to the pending source
  // list instead of committing.
  modifier: boolean;
  // Shift — used to commit without clearing the pending source list.
  shift: boolean;
};

export type VertexClickContext = {
  vertexId: string;
  modifiers: VertexClickModifiers;
  pendingEdgeSources: string[];
  nodes: VertexNode[];
  edges: GraphEdge[];
};

// Partial state shape that `handleVertexClick` may produce. Each
// case sets only the slices it cares about; the store applies the
// whole patch in one `set` call.
export type VertexClickPatch = {
  pendingEdgeSources?: string[];
  edges?: GraphEdge[];
  nodes?: VertexNode[];
};

// Compute the state patch for a vertex click in add-edge mode, or
// `null` if the click is a no-op. The six cases, in evaluation order:
//
//   1. modifier (Cmd/Ctrl): append vertex to pending sources; no-op
//      if it's already there.
//   2. shift + empty pending: start the pending list with this vertex.
//   3. plain + empty pending: start the pending list with this vertex.
//   4. plain + already-pending vertex: toggle it off.
//   5. shift + non-empty pending: fan out from every pending source
//      to the clicked target, keep the pending list intact.
//   6. plain + non-empty pending + fresh target: fan out, then clear
//      pending sources and the canvas selection.
export function computeVertexClick(
  ctx: VertexClickContext,
): VertexClickPatch | null {
  // (1) Modifier click — append (or no-op if already pending).
  if (ctx.modifiers.modifier) {
    if (ctx.pendingEdgeSources.includes(ctx.vertexId)) {
      return null;
    }
    return {
      pendingEdgeSources: [...ctx.pendingEdgeSources, ctx.vertexId],
    };
  }

  // (2) & (3) Empty pending → start the list regardless of shift.
  if (ctx.pendingEdgeSources.length === 0) {
    return { pendingEdgeSources: [ctx.vertexId] };
  }

  // Helper: build the fan-out, skipping any (source, target) pair
  // that already exists. When `clearAfter` is true the patch also
  // resets pending sources and clears the canvas selection — the
  // commit-and-reset gesture for the plain click case.
  const fanOut = (clearAfter: boolean): VertexClickPatch => {
    const existingPairs = new Set(
      ctx.edges.map((edge) => `${edge.source}->${edge.target}`),
    );
    const newEdges = ctx.pendingEdgeSources
      .filter(
        (sourceId) => !existingPairs.has(`${sourceId}->${ctx.vertexId}`),
      )
      // Pass `nodes` so the new edge can pick the right target
      // handle id (HANDLE_IDS.top for directional vertices,
      // HANDLE_IDS.centerTarget otherwise). Without it,
      // createGraphEdge falls back to the centered default.
      .map((sourceId) => createGraphEdge(sourceId, ctx.vertexId, ctx.nodes));

    // Nothing added and nothing to clear — leave the patch empty so
    // the store's `set` becomes a no-op.
    if (newEdges.length === 0 && !clearAfter) return {};

    return clearAfter
      ? {
        edges:
          newEdges.length > 0 ? [...ctx.edges, ...newEdges] : ctx.edges,
        pendingEdgeSources: [],
        nodes: ctx.nodes.map((node) => ({ ...node, selected: false })),
      }
      : { edges: [...ctx.edges, ...newEdges] };
  };

  // (4) Plain click on a vertex already in the pending list —
  // toggle it off. Shift click falls through to the fan-out cases
  // below so shift+clicking a pending vertex still produces edges.
  if (
    !ctx.modifiers.shift &&
    ctx.pendingEdgeSources.includes(ctx.vertexId)
  ) {
    return {
      pendingEdgeSources: ctx.pendingEdgeSources.filter(
        (id) => id !== ctx.vertexId,
      ),
    };
  }

  // (5) Shift click with non-empty pending → fan out, keep pending.
  // (6) Plain click with non-empty pending + fresh target → fan out,
  //     clear pending and selection.
  return ctx.modifiers.shift ? fanOut(false) : fanOut(true);
}

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

