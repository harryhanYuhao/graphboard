// src/lib/serialisation/document.ts
//
// Persistence boundary across the document's two slices (`../graph/types.ts`):
// `graph` (graph-theoretic data, what the compute backend sees) and `view`
// (visual data, what the backend never sees). Entry points: `projectToDocument`
// (runtime → v2 doc) and `hydrateDocument` (v2 doc → runtime).
import {
  CURRENT_SCHEMA_VERSION,
  DEFAULT_EDGE_KIND,
  DEFAULT_LABEL_LOCATION,
  EDGE_TYPES,
  HANDLE_IDS,
  type EdgeView,
  type GraphDocument,
  type GraphEdge,
  type GraphEdgeRecord,
  type GraphNodeRecord,
  type NodeView,
  type VertexNode,
  type VertexType,
} from "../graph/types";
import { snapPosition } from "../graph/operations";
import { coerceEdgeKind } from "../graph/edge-registry";
import { VERTEX_TYPE_MAP } from "../graph/vertex-registry";

// Wrap an angle into canonical [0, 360) and round to 6 dp. The rounding
// prevents `%` float drift from accumulating across save/load and making
// equality checks (e.g. the panel's `rotation !== 0` reset) flaky — keep it.
export function normalizeRotation(rotation: number): number {
  if (!Number.isFinite(rotation)) return 0;
  const wrapped = ((rotation % 360) + 360) % 360;
  // Collapse the exact-360 case to 0.
  const rounded = Math.round(wrapped * 1e6) / 1e6;
  return rounded === 360 ? 0 : rounded;
}

// ---- Projection (runtime → persisted) -------------------------------------

export type ProjectInput = {
  id: string;
  title: string;
  nodes: VertexNode[];
  edges: GraphEdge[];
  createdAt: string;
  updatedAt: string;
};

export function projectToDocument(input: ProjectInput): GraphDocument {
  const graphNodes: GraphNodeRecord[] = [];
  const viewNodes: NodeView[] = [];
  for (const node of input.nodes) {
    graphNodes.push({ id: node.id, data: node.data });
    // Normalize so disk stays canonical (mirrors the panel's commit behavior).
    viewNodes.push({
      id: node.id,
      position: node.position,
      rotation: normalizeRotation(node.rotation ?? 0),
      label: node.label ?? "",
      labelLocation: node.labelLocation ?? DEFAULT_LABEL_LOCATION,
    });
  }

  const graphEdges: GraphEdgeRecord[] = [];
  const viewEdges: EdgeView[] = [];
  for (const edge of input.edges) {
    // Translate runtime handle ids to persisted numeric indices
    // (0 = top, 1 = bottom) so the on-disk format is forward-compatible.
    graphEdges.push({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: handleIdToIndex(edge.sourceHandle),
      targetHandle: handleIdToIndex(edge.targetHandle),
      // Edge kind is part of the graph slice (future compute differences);
      // always persisted. Hydration coerces untrusted kinds, so runtime
      // edges always carry a valid member and disk stays canonical.
      data: { kind: edge.data?.kind ?? DEFAULT_EDGE_KIND },
    });
    viewEdges.push({ id: edge.id });
  }

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: input.id,
    title: input.title,
    graph: { nodes: graphNodes, edges: graphEdges },
    view: { nodes: viewNodes, edges: viewEdges },
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };
}

// ---- Hydration (persisted → runtime) --------------------------------------

export type HydratedDocument = {
  id: string;
  title: string;
  nodes: VertexNode[];
  edges: GraphEdge[];
  createdAt: string;
  updatedAt: string;
};

// Reconstruct a runtime `VertexNode` from a persisted graph + view entry.
// Positions default to origin if the view entry is missing.
function hydrateNode(
  graphNode: GraphNodeRecord,
  viewById: Map<string, NodeView>,
): VertexNode {
  const view = viewById.get(graphNode.id);

  // Untrusted-import hardening: `view.nodes[].label` and `data.phase` are
  // user-controlled and can be non-strings (parse only checks array-ness).
  // Coerce at the boundary so renderLabel's `.trim()` / the phase parser
  // never receive a non-string — a crafted doc otherwise crashes the whole
  // editor tree (no error boundary). Non-strings degrade to the empty value.
  const phase =
    typeof graphNode.data?.phase === "string" ? graphNode.data.phase : "";
  const label = typeof view?.label === "string" ? view.label : "";

  return {
    id: graphNode.id,
    type: "vertex",
    // Snap on load so old/non-aligned docs migrate to the grid (mirrors
    // `normalizeRotation` for rotation).
    position: snapPosition(view?.position ?? { x: 0, y: 0 }),
    // Absent `rotation` (pre-rotation docs) hydrates as 0.
    rotation: normalizeRotation(view?.rotation ?? 0),
    // Absent visual-label fields (pre-v2 docs) hydrate to no label.
    label,
    labelLocation:
      typeof view?.labelLocation === "string"
        ? view.labelLocation
        : DEFAULT_LABEL_LOCATION,
    data: { ...graphNode.data, phase },
    // Pins React Flow's handle anchor at the node center. Renderer detail, not persisted.
    origin: [0.5, 0.5],
  };
}

function hydrateEdge(
  graphEdge: GraphEdgeRecord,
  vertexTypeById: Map<string, VertexType>,
): GraphEdge {
  return {
    id: graphEdge.id,
    source: graphEdge.source,
    target: graphEdge.target,
    // Translate persisted indices back to runtime handle ids; absent fields use defaults.
    sourceHandle: indexToHandleId(
      graphEdge.sourceHandle,
      vertexTypeById.get(graphEdge.source),
      "source",
    ),
    targetHandle: indexToHandleId(
      graphEdge.targetHandle,
      vertexTypeById.get(graphEdge.target),
      "target",
    ),
    // Renderer discriminator (only `straightCenter` today; constant keeps the literal centralized).
    type: EDGE_TYPES.straightCenter,
    // Untrusted-import hardening (like `phase`/`label` above): unknown or
    // absent kinds degrade to the default so the renderer, disk, and the
    // Rust compute serde never meet an invalid member.
    data: { kind: coerceEdgeKind(graphEdge.data?.kind) },
  };
}

export function hydrateDocument(doc: GraphDocument): HydratedDocument {
  const nodeViewById = new Map<string, NodeView>(
    doc.view.nodes.map((v) => [v.id, v]),
  );
  // Pre-index vertex types so hydrateEdge looks up endpoints in O(1) per edge.
  const vertexTypeById = new Map<string, VertexType>(
    doc.graph.nodes.map((n) => [n.id, n.data.vertexType]),
  );
  // Drop dangling edges (endpoint id has no node) — mirrors the import path;
  // React Flow would skip them anyway and autosave would re-persist the junk.
  const nodeIdSet = new Set(doc.graph.nodes.map((n) => n.id));

  return {
    id: doc.id,
    title: doc.title,
    nodes: doc.graph.nodes.map((n) => hydrateNode(n, nodeViewById)),
    edges: doc.graph.edges
      .filter((e) => nodeIdSet.has(e.source) && nodeIdSet.has(e.target))
      .map((e) => hydrateEdge(e, vertexTypeById)),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

// ---- Handle id <-> index conversion ---------------------------------------
//
// Disk stores numeric indices (0 = top, 1 = bottom); runtime stores React-Flow
// handle ids. These two helpers are the only place the mapping lives — keep
// them in sync if either side adds values.

// Runtime handle id → persisted index: bottom (source slot, centerSource) = 1,
// everything else = 0. Unknown/absent → undefined so the field is omitted and
// hydration falls back to its per-role default.
function handleIdToIndex(handleId: string | null | undefined): number | undefined {
  if (handleId == null) return undefined;
  if (handleId === HANDLE_IDS.centerSource) return 1;
  return 0;
}

// Persisted index → runtime handle id, by role and the vertex's directional flag.
// Absent-field defaults: source → centerSource (bottom slot); target → top for
// directional vertices (visible input dot), centerTarget otherwise.
function indexToHandleId(
  index: number | undefined,
  vertexType: VertexType | undefined,
  role: "source" | "target",
): string {
  const meta = vertexType ? VERTEX_TYPE_MAP[vertexType] : undefined;
  const isDirectional = meta?.directional === true;

  if (role === "source") {
    // Source is always the bottom slot, regardless of vertex type.
    return HANDLE_IDS.centerSource;
  }

  // Target: top slot, directional picks the visible HANDLE_IDS.top. Unknown indices fall through.
  if (index === undefined || index === 0) {
    return isDirectional ? HANDLE_IDS.top : HANDLE_IDS.centerTarget;
  }
  return HANDLE_IDS.centerTarget;
}
