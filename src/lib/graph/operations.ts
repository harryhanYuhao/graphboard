import { nanoid } from "nanoid";
import {
  EDGE_TYPES,
  HANDLE_IDS,
  type GraphEdge,
  type VertexNode,
  type VertexType,
} from "./types";
import {
  DEFAULT_VERTEX_TYPE,
  VERTEX_TYPE_MAP,
  isBoundaryVertex,
} from "./vertex-types";

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

// ---- Boundary ordering (input / output) -----------------------------------
//
// Boundary vertices (`input` / `output`) carry an `order` field that
// determines the final axis order of the contracted tensor. Inputs and
// outputs are ordered independently within their own group (0-indexed).
// The compute layer falls back to array position when `order` is unset,
// so these helpers only matter for boundary nodes — for every other
// type the field is ignored. See `VertexData.order` in types.ts and the
// §5.4 axis-ordering contract in `crates/zxw/src/contraction.rs`.

// Comparator key for sorting boundary nodes of the same type: current
// `order` if set, otherwise the node's position in `nodes` (matching the
// compute-layer fallback). Nodes with the same key keep their relative
// array order (stable behavior is the caller's responsibility).
function boundaryOrderKey(
  node: VertexNode,
  nodes: VertexNode[],
): number {
  if (typeof node.data.order === "number" && Number.isFinite(node.data.order)) {
    return node.data.order;
  }
  return nodes.indexOf(node);
}

// Next available `order` for a boundary vertex of `vertexType` among
// `nodes`. Returns `max(existing orders of that type) + 1`, or `0` if
// there are none (or none with a set order). Used at creation, type
// change, and paste so a new boundary always lands at the end of its
// group without colliding with an existing one.
export function nextBoundaryOrder(
  nodes: VertexNode[],
  vertexType: VertexType,
): number {
  let max = -1;
  for (const node of nodes) {
    if (node.data.vertexType !== vertexType) continue;
    if (
      typeof node.data.order === "number" &&
      Number.isFinite(node.data.order) &&
      node.data.order > max
    ) {
      max = node.data.order;
    }
  }
  return max + 1;
}

export type ReorderBoundaryResult = {
  nodes: VertexNode[];
};

// Reorder a boundary vertex to `targetOrder` using "cut the queue"
// insert semantics: within the boundary node's own type group, remove
// the node from its current position and re-insert at `targetOrder`,
// then re-stamp sequential orders `0..n-1` so the group never carries
// gaps or duplicates. Example: orders [0,1,2,3,4], move order-4 to
// target 1 → the moved node becomes 1 and the others shift to
// [0,2,3,4]→[0,2,3,4] re-stamped as [0,1,2,3,4] (moved node = 1).
//
// Non-boundary nodes and boundary nodes of the *other* type are
// returned untouched (inputs and outputs are ordered independently).
// Returns the original `nodes` reference if nothing changed (so the
// Zustand equality check short-circuits a no-op). Out-of-range or
// non-finite `targetOrder` is clamped to `[0, count-1]`; a no-op
// (target equals current effective position) returns the input ref.
export function reorderBoundaryVertex(params: {
  nodes: VertexNode[];
  vertexId: string;
  targetOrder: number;
}): ReorderBoundaryResult {
  const { nodes, vertexId } = params;
  const target = nodes.find((n) => n.id === vertexId);
  if (!target || !isBoundaryVertex(target.data.vertexType)) {
    return { nodes };
  }

  const type = target.data.vertexType;

  // Indices into `nodes` of every boundary node of the same type, in
  // ascending order of their current effective key. Stable on ties so
  // the pre-existing array order is the final tiebreaker.
  const sameTypeIdx = nodes
    .map((n, i) => ({ n, i }))
    .filter(({ n }) => n.data.vertexType === type)
    .sort(
      (a, b) =>
        boundaryOrderKey(a.n, nodes) - boundaryOrderKey(b.n, nodes) ||
        a.i - b.i,
    );

  const fromPos = sameTypeIdx.findIndex(({ n }) => n.id === vertexId);
  if (fromPos === -1) return { nodes };

  const count = sameTypeIdx.length;
  let targetPos = Math.floor(params.targetOrder);
  if (!Number.isFinite(targetPos)) return { nodes };
  targetPos = Math.max(0, Math.min(count - 1, targetPos));
  if (targetPos === fromPos) return { nodes };

  // Re-stamp sequential orders on the reordered sequence.
  const reordered = sameTypeIdx
    .map(({ n }) => ({ id: n.id }))
    .filter(({ id }) => id !== vertexId);
  reordered.splice(targetPos, 0, { id: vertexId });

  const newOrderByNodeId = new Map<string, number>();
  reordered.forEach(({ id }, order) => newOrderByNodeId.set(id, order));

  const nextNodes = nodes.map((n) => {
    const order = newOrderByNodeId.get(n.id);
    if (order === undefined || order === n.data.order) return n;
    return { ...n, data: { ...n.data, order } };
  });

  return { nodes: nextNodes };
}

// When a vertex changes type *to* a boundary (via the property panel),
// assign it the next available order in its new group so it lands at
// the end rather than inheriting a stale or undefined `order`. When
// changing *away* from a boundary, leave any existing `order` in
// place — it's ignored for non-boundary types and stripping it would
// be surprising if the user flips back.
export function assignBoundaryOrderOnTypeChange(params: {
  nodes: VertexNode[];
  vertexId: string;
  newType: VertexType;
}): VertexNode[] {
  const { nodes, vertexId, newType } = params;
  if (!isBoundaryVertex(newType)) return nodes;

  // Compute the next order against the list *excluding* the node being
  // changed — it's about to become the new type, so its old order
  // (if any) shouldn't count toward the max.
  const others = nodes.filter((n) => n.id !== vertexId);
  const order = nextBoundaryOrder(others, newType);

  return nodes.map((n) =>
    n.id === vertexId
      ? { ...n, data: { ...n.data, vertexType: newType, order } }
      : n,
  );
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
  // tests) keep working; without it we default to `centerTarget`
  // (matching `sourceHandle`'s unconditional default) rather than
  // leaving `targetHandle` undefined. The undefined footgun used to
  // silently change a directional target's handle to `top` on
  // save/load, because `indexToHandleId(undefined, directional,
  // "target")` falls back to `HANDLE_IDS.top`.
  const targetNode = nodes?.find((n) => n.id === target);
  const meta = targetNode
    ? VERTEX_TYPE_MAP[targetNode.data.vertexType]
    : undefined;
  const targetHandle =
    meta?.directional ? HANDLE_IDS.top : HANDLE_IDS.centerTarget;

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
// the Zustand store picks up the change as a reference diff — UNLESS
// every element is already in the target state, in which case the
// original arrays are returned (reference-equal). This is the hook the
// zundo `equality` function (in graph-store.ts) keys off to skip the
// pastState push for a no-op call. The no-op path is also where the
// helper avoids a wasteful copy.
export function selectAllElements(params: {
  nodes: VertexNode[];
  edges: GraphEdge[];
}): {
  nodes: VertexNode[];
  edges: GraphEdge[];
} {
  let changed = false;
  const nodes = params.nodes.map((node) => {
    if (node.selected) return node;
    changed = true;
    return { ...node, selected: true };
  });
  const edges = params.edges.map((edge) => {
    if (edge.selected) return edge;
    changed = true;
    return { ...edge, selected: true };
  });
  if (!changed) {
    // No element actually changed — preserve the original references
    // so the zundo equality function can short-circuit the pastState
    // push. Returning a fresh `[]` here would still produce
    // reference-equal `nodes`/`edges` (both empty), so the shortcut
    // works for the empty-graph case too.
    return { nodes: params.nodes, edges: params.edges };
  }
  return { nodes, edges };
}

// Mark every node and edge as not selected. Returned arrays are new arrays
// so the Zustand store picks up the change as a reference diff — UNLESS
// every element is already unselected, in which case the original
// arrays are returned. See `selectAllElements` for the rationale.
export function clearAllSelections(params: {
  nodes: VertexNode[];
  edges: GraphEdge[];
}): {
  nodes: VertexNode[];
  edges: GraphEdge[];
} {
  let changed = false;
  const nodes = params.nodes.map((node) => {
    if (!node.selected) return node;
    changed = true;
    return { ...node, selected: false };
  });
  const edges = params.edges.map((edge) => {
    if (!edge.selected) return edge;
    changed = true;
    return { ...edge, selected: false };
  });
  if (!changed) {
    return { nodes: params.nodes, edges: params.edges };
  }
  return { nodes, edges };
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
    // Strip `selected` so the clipboard payload is selection-agnostic —
    // a node copied while selected used to carry `selected: true` onto
    // the clipboard, where it's stale state (paste re-selects the new
    // nodes explicitly via `pasteSubgraph`). Keeping the clipboard
    // clean avoids surprising any future caller that reads it.
    nodes: subgraph.nodes.map((node) => ({
      ...node,
      data: { ...node.data },
      selected: false,
    })),
    edges: subgraph.edges.map((edge) => ({ ...edge, selected: false })),
  };
}

// Re-mint every node and edge ID, remap edge endpoints to the new node IDs,
// translate positions by `pasteCount * PASTE_OFFSET_STEP`, and mark all
// produced elements selected so the user can immediately move the result.
//
// `existingNodes` (the live graph the paste is landing into) lets pasted
// boundary (`input` / `output`) nodes get fresh, non-colliding `order`
// values via `nextBoundaryOrder`. Without it a pasted input would clone
// the original's order and the two would tie. Optional so legacy callers
// and tests keep working — omitting it leaves boundary orders untouched.
export function pasteSubgraph(params: {
  subgraph: {
    nodes: VertexNode[];
    edges: GraphEdge[];
  };
  pasteCount: number;
  existingNodes?: VertexNode[];
}): {
  nodes: VertexNode[];
  edges: GraphEdge[];
} {
  const offset = params.pasteCount * PASTE_OFFSET_STEP;

  const idMap = new Map<string, string>();
  for (const node of params.subgraph.nodes) {
    idMap.set(node.id, nanoid());
  }

  // Seed the order-assignment pool with the live graph so the first
  // pasted boundary of each type lands after the last existing one of
  // the same type. Each pasted boundary then bumps the running max so
  // multiple pasted inputs/outputs stay sequential among themselves.
  const pool: VertexNode[] = params.existingNodes
    ? params.existingNodes.map((n) => ({ ...n, data: { ...n.data } }))
    : [];

  const newNodes: VertexNode[] = params.subgraph.nodes.map((node) => {
    const newNode: VertexNode = {
      ...node,
      id: idMap.get(node.id) as string,
      position: {
        x: node.position.x + offset,
        y: node.position.y + offset,
      },
      data: { ...node.data },
      selected: true,
    };

    if (isBoundaryVertex(node.data.vertexType)) {
      const order = nextBoundaryOrder(pool, node.data.vertexType);
      newNode.data.order = order;
      pool.push(newNode);
    }

    return newNode;
  });

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

