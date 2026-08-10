import { nanoid } from "nanoid";
import {
  DEFAULT_EDGE_KIND,
  DEFAULT_LABEL_LOCATION,
  EDGE_TYPES,
  HANDLE_IDS,
  type EdgeKind,
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
    label: "",
    labelLocation: DEFAULT_LABEL_LOCATION,
    data: {
      phase: VERTEX_TYPE_MAP[vertexType]?.defaultPhase ?? "",
      vertexType,
    },
  };
}

// ---- Boundary ordering (input / output) -----------------------------------
//
// `order` on boundary vertices (input/output) sets the final axis order of the
// contracted tensor; inputs and outputs are ordered independently. See
// `VertexData.order` in types.ts and `crates/zxw/src/contraction.rs` §5.4.

// Sort key for boundary nodes: current `order` if set, else array position
// (matching the compute-layer fallback). Stable ordering is the caller's job.
function boundaryOrderKey(
  node: VertexNode,
  nodes: VertexNode[],
): number {
  if (typeof node.data.order === "number" && Number.isFinite(node.data.order)) {
    return node.data.order;
  }
  return nodes.indexOf(node);
}

// Next `order` for a boundary vertex of `vertexType`: max of existing orders of
// that type, +1 (0 if none). Used at creation, type change, and paste so a new
// boundary lands at the end of its group without colliding.
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

// "Cut the queue" reorder within the boundary node's own type group: remove the
// node and re-insert at `targetOrder`, then re-stamp sequential `0..n-1` orders
// so the group has no gaps or duplicates. Non-boundary nodes and the opposite
// boundary type are untouched (inputs/outputs order independently). Returns
// the input `nodes` ref on a no-op so Zustand's equality check short-circuits;
// out-of-range / non-finite `targetOrder` clamps to `[0, count-1]`.
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

  // Indices of same-type boundary nodes, ascending by effective key. Stable on
  // ties so pre-existing array order is the final tiebreaker.
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

// On type change *to* a boundary, assign the next order so it lands at the end
// of its group rather than inheriting a stale `order`. Changing *away* from a
// boundary leaves `order` in place (ignored for non-boundary types; restored
// untouched if the user flips back).
export function assignBoundaryOrderOnTypeChange(params: {
  nodes: VertexNode[];
  vertexId: string;
  newType: VertexType;
}): VertexNode[] {
  const { nodes, vertexId, newType } = params;
  if (!isBoundaryVertex(newType)) return nodes;

  // Exclude the node being changed — its old order (if any) shouldn't count.
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
  kind: EdgeKind = DEFAULT_EDGE_KIND,
): GraphEdge {
  // Pick the target handle: directional vertices (W, And) use the top dot
  // (HANDLE_IDS.top); everything else uses the centered target. Source is
  // always the bottom slot. `nodes` is optional — omitted, we default to
  // `centerTarget` to match `sourceHandle`'s default rather than leaving
  // `targetHandle` undefined (which would make a directional target fall back
  // to `top` on save/load via `indexToHandleId`).
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
    // Kind of the new edge; add-edge mode stages it via the EdgeKindMenu
    // (`selectedEdgeKind`), everything else uses the default.
    data: { kind },
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

// Per-paste translation step (flow-space units) so repeated pastes don't stack.
export const PASTE_OFFSET_STEP = 24;

// Grid spacing shared by the dot background, snapping, and paste offset.
// Must match <Background gap={GRID_SIZE}> in GraphEditor.tsx.
export const GRID_SIZE = 24;

// Snap a flow-space position to the nearest grid dot. React Flow positions
// nodes by their top-left corner (default origin [0,0]) while the vertex
// body is ~GRID_SIZE across, so the GRID_SIZE/2 offset centers the node on
// a Background dot (dots render at multiples of `gap` with default offset
// 0). Snap targets are GRID_SIZE/2 + k·GRID_SIZE.
export function snapPosition(position: { x: number; y: number }): {
  x: number;
  y: number;
} {
  // Guard non-finite values: imported JSON can carry `1e999` (Infinity) or
  // string coords, and NaN would poison every downstream position (and later
  // persist as `null`).
  const x = Number.isFinite(position.x) ? position.x : 0;
  const y = Number.isFinite(position.y) ? position.y : 0;

  return {
    x: GRID_SIZE * Math.round(x / GRID_SIZE - 0.5) + GRID_SIZE / 2,
    y: GRID_SIZE * Math.round(y / GRID_SIZE - 0.5) + GRID_SIZE / 2,
  };
}

// ---- Click dispatch (add-edge mode) --------------------------------------
//
// Pure function for the six mutually-exclusive vertex-click cases (modifier,
// shift/plain × empty/non-empty pending, toggle-off, fan-out). Lives here
// rather than in the store so it's unit-testable without standing up a store.

export type VertexClickModifiers = {
  // Cmd (mac) / Ctrl (win,linux) — appends to pending sources instead of committing.
  modifier: boolean;
  // Shift — commits without clearing the pending source list.
  shift: boolean;
};

export type VertexClickContext = {
  vertexId: string;
  modifiers: VertexClickModifiers;
  pendingEdgeSources: string[];
  nodes: VertexNode[];
  edges: GraphEdge[];
  // Kind for newly created edges (add-edge mode). Optional so callers that
  // only exercise the click dispatcher keep the default kind.
  edgeKind?: EdgeKind;
};

// State patch for a vertex click — each case sets only the slices it touches;
// the store applies the whole patch in one `set` call.
export type VertexClickPatch = {
  pendingEdgeSources?: string[];
  edges?: GraphEdge[];
  nodes?: VertexNode[];
};

// State patch for a vertex click in add-edge mode, or `null` for a no-op.
// Cases in evaluation order: (1) modifier → append; (2)/(3) empty pending →
// start list; (4) plain click on pending vertex → toggle off; (5) shift +
// non-empty → fan out, keep pending; (6) plain + non-empty + fresh target →
// fan out, then clear pending and selection.
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

  // Build the fan-out, skipping existing (source, target) pairs. When
  // `clearAfter` is set the patch also clears pending sources and selection —
  // the commit-and-reset gesture for the plain click case.
  const fanOut = (clearAfter: boolean): VertexClickPatch => {
    const existingPairs = new Set(
      ctx.edges.map((edge) => `${edge.source}->${edge.target}`),
    );
    const newEdges = ctx.pendingEdgeSources
      .filter(
        (sourceId) => !existingPairs.has(`${sourceId}->${ctx.vertexId}`),
      )
      // Pass `nodes` so new edges pick the right target handle
      // (top for directional, centerTarget otherwise), and `edgeKind` so
      // the staged kind (EdgeKindMenu) rides on the new edges.
      .map((sourceId) =>
        createGraphEdge(
          sourceId,
          ctx.vertexId,
          ctx.nodes,
          ctx.edgeKind ?? DEFAULT_EDGE_KIND,
        ),
      );

    // Nothing to add and nothing to clear — empty patch makes the store `set` a no-op.
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

  // (4) Plain click on a pending vertex — toggle off. Shift click falls
  // through so shift+clicking a pending vertex still fans out.
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

// Selected nodes plus edges with both endpoints selected. Partial edges are
// dropped so paste can't create dangling references.
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

// Mark everything selected. Returns the original refs when nothing actually
// changes so the zundo `equality` function (graph-store.ts) can short-circuit
// the pastState push for a no-op.
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
    // Preserve original refs so zundo's equality check short-circuits the no-op.
    return { nodes: params.nodes, edges: params.edges };
  }
  return { nodes, edges };
}

// Inverse of `selectAllElements` — see it for the no-op ref-return rationale.
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

// Shallow-clone for clipboard. IDs are preserved so internal edge→node refs
// stay intact; re-minted only at paste. `selected` is stripped so the payload
// is selection-agnostic (paste re-selects explicitly).
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
      selected: false,
    })),
    edges: subgraph.edges.map((edge) => ({ ...edge, selected: false })),
  };
}

// Re-mint IDs, remap edge endpoints, translate by `pasteCount * PASTE_OFFSET_STEP`,
// and mark all output selected. `existingNodes` lets pasted boundary vertices
// get non-colliding `order`s via `nextBoundaryOrder`; omit it to leave boundary
// orders untouched (legacy callers/tests).
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

  // Seed the order pool with the live graph so pasted boundaries land after
  // existing ones; each pasted boundary bumps the running max to stay sequential.
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

// Insertion offset applied to an imported graph on top of the viewport
// centre, so the merge doesn't land exactly on the focal point.
export const IMPORT_OFFSET_STEP = 48;

// Merge an imported (hydrated) graph into the live graph. Non-colliding
// imported ids survive; ids that clash with the existing graph (or repeat
// inside the import itself) are re-minted and their edges remapped. Every
// imported position is translated by `offset`, and imported nodes/edges are
// marked selected so the user immediately sees what was added. The existing
// nodes/edges are returned untouched, and imported boundary vertices get
// fresh `order`s so the compute layer's axis ordering stays unique.
export function mergeImportedGraph(params: {
  imported: { nodes: VertexNode[]; edges: GraphEdge[] };
  existing: { nodes: VertexNode[]; edges: GraphEdge[] };
  offset: { x: number; y: number };
}): { nodes: VertexNode[]; edges: GraphEdge[] } {
  const { imported, existing, offset } = params;

  const existingNodeIds = new Set(existing.nodes.map((n) => n.id));
  const importedNodeIds = new Set(imported.nodes.map((n) => n.id));
  const existingEdgeIds = new Set(existing.edges.map((e) => e.id));

  // Mint fresh ids only where needed: collisions with the existing graph and
  // duplicates inside the import itself.
  const idMap = new Map<string, string>();
  const usedIds = new Set(existingNodeIds);
  for (const node of imported.nodes) {
    if (usedIds.has(node.id)) {
      const freshId = nanoid();
      idMap.set(node.id, freshId);
      usedIds.add(freshId);
    } else {
      usedIds.add(node.id);
    }
  }

  // Boundary `order` must stay unique per type; seed the pool with the live
  // graph so imported boundaries land after existing ones.
  const orderPool: VertexNode[] = existing.nodes.map((node) => ({
    ...node,
    data: { ...node.data },
  }));

  const newNodes: VertexNode[] = imported.nodes.map((node) => {
    const newNode: VertexNode = {
      ...node,
      id: idMap.get(node.id) ?? node.id,
      position: {
        x: node.position.x + offset.x,
        y: node.position.y + offset.y,
      },
      data: { ...node.data },
      selected: true,
    };

    if (isBoundaryVertex(node.data.vertexType)) {
      const order = nextBoundaryOrder(orderPool, node.data.vertexType);
      newNode.data.order = order;
      orderPool.push(newNode);
    }

    return newNode;
  });

  const newEdges: GraphEdge[] = [];
  // Deduplicate edge ids across the whole result (existing + import), like
  // the node side: a hand-edited file may repeat an edge id.
  const usedEdgeIds = new Set(existingEdgeIds);
  for (const edge of imported.edges) {
    // A hand-edited file may reference an endpoint that isn't in the node
    // set; drop such edges rather than leave them dangling.
    if (
      !importedNodeIds.has(edge.source) ||
      !importedNodeIds.has(edge.target)
    ) {
      continue;
    }

    const edgeId = usedEdgeIds.has(edge.id) ? nanoid() : edge.id;
    usedEdgeIds.add(edgeId);

    newEdges.push({
      ...edge,
      id: edgeId,
      source: idMap.get(edge.source) ?? edge.source,
      target: idMap.get(edge.target) ?? edge.target,
      selected: true,
    });
  }

  return {
    nodes: [...existing.nodes, ...newNodes],
    edges: [...existing.edges, ...newEdges],
  };
}

