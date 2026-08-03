// src/lib/graph/serialization.ts
//
// Persistence boundary across the document's two slices (`./types.ts`):
// `graph` (graph-theoretic data, what the compute backend sees) and `view`
// (visual data, what the backend never sees). Entry points: `projectDocument`
// (runtime → v1 doc) and `hydrateDocument` (v1 doc → runtime).
import {
  CURRENT_SCHEMA_VERSION,
  EDGE_TYPES,
  HANDLE_IDS,
  PERSISTED_IDS,
  type EdgeView,
  type GraphDocument,
  type GraphEdge,
  type GraphEdgeRecord,
  type GraphNodeRecord,
  type NodeView,
  type VertexNode,
  type VertexType,
} from "./types";
import { snapPosition } from "./operations";
import { VERTEX_TYPE_MAP } from "./vertex-types";

const LOCAL_STORAGE_KEY = "graph-board-document";

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

export function projectDocument(input: ProjectInput): GraphDocument {
  const graphNodes: GraphNodeRecord[] = [];
  const viewNodes: NodeView[] = [];
  for (const node of input.nodes) {
    graphNodes.push({ id: node.id, data: node.data });
    // Normalize so disk stays canonical (mirrors the panel's commit behavior).
    viewNodes.push({
      id: node.id,
      position: node.position,
      rotation: normalizeRotation(node.rotation ?? 0),
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

  return {
    id: graphNode.id,
    type: "vertex",
    // Snap on load so old/non-aligned docs migrate to the grid (mirrors
    // `normalizeRotation` for rotation).
    position: snapPosition(view?.position ?? { x: 0, y: 0 }),
    // Absent `rotation` (pre-rotation docs) hydrates as 0.
    rotation: normalizeRotation(view?.rotation ?? 0),
    data: graphNode.data,
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

  return {
    id: doc.id,
    title: doc.title,
    nodes: doc.graph.nodes.map((n) => hydrateNode(n, nodeViewById)),
    edges: doc.graph.edges.map((e) => hydrateEdge(e, vertexTypeById)),
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

// ---- Public API ------------------------------------------------------------

export function createEmptyGraphDocument(): GraphDocument {
  const now = new Date().toISOString();

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: PERSISTED_IDS.localDocument,
    title: "Untitled Graph",
    graph: { nodes: [], edges: [] },
    view: { nodes: [], edges: [] },
    createdAt: now,
    updatedAt: now,
  };
}

export function saveGraphDocument(params: {
  id: string;
  title: string;
  nodes: VertexNode[];
  edges: GraphEdge[];
  createdAt?: string;
}): void {
  if (typeof window === "undefined") return;

  // Always project to the current schema so older documents upgrade implicitly on save.
  const document = projectDocument({
    id: params.id,
    title: params.title,
    nodes: params.nodes,
    edges: params.edges,
    createdAt: params.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(document));
}

export function loadGraphDocument(): GraphDocument {
  if (typeof window === "undefined") {
    return createEmptyGraphDocument();
  }

  const raw = localStorage.getItem(LOCAL_STORAGE_KEY);

  if (!raw) {
    return createEmptyGraphDocument();
  }

  // Load fails soft: corrupt/future-schema docs warn and fall back to empty
  // rather than throwing into `hydrateDocument` (which would crash the editor).
  const result = parseDocument(raw);
  if (!result.ok) {
    console.warn(`graph-board: ${result.error}; loading empty document.`);
    return createEmptyGraphDocument();
  }

  return result.document;
}

export function exportGraphJson(params: {
  title: string;
  nodes: VertexNode[];
  edges: GraphEdge[];
  // Preserved from the store so exports keep the original creation time;
  // defaults to "now" for callers without a store (e.g. tests).
  createdAt?: string;
}): string {
  const now = new Date().toISOString();

  const document = projectDocument({
    id: PERSISTED_IDS.exportedDocument,
    title: params.title,
    nodes: params.nodes,
    edges: params.edges,
    createdAt: params.createdAt ?? now,
    updatedAt: now,
  });

  return JSON.stringify(document, null, 2);
}

// ---- Document parsing (shared by load + import) ----------------------------
//
// Parse + validate a JSON string against the v1 `{ graph, view }` shape
// (`./types.ts`). Shared by `loadGraphDocument` and `importGraphJson` so the two
// paths can't drift in robustness. Returns a discriminated result rather than
// throwing so callers pick their failure policy (load = soft, import = loud).

export type ParseResult =
  | { ok: true; document: GraphDocument }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isGraphSlice(
  value: unknown,
): value is { nodes: unknown[]; edges: unknown[] } {
  if (!isRecord(value)) return false;
  if (!Array.isArray(value.nodes)) return false;
  if (!Array.isArray(value.edges)) return false;
  return true;
}

// Parse + validate a JSON string against the v1 shape. Stamps
// `schemaVersion` to `CURRENT_SCHEMA_VERSION` on success so downstream
// consumers don't handle the missing-field case.
export function parseDocument(contents: string): ParseResult {
  let parsed: unknown;

  try {
    parsed = JSON.parse(contents);
  } catch {
    return { ok: false, error: "Document is not valid JSON." };
  }

  if (!isRecord(parsed)) {
    return { ok: false, error: "Document must be a JSON object." };
  }

  if (!isGraphSlice(parsed.graph)) {
    return {
      ok: false,
      error: "Document is missing a valid 'graph' slice (v1 shape required).",
    };
  }

  if (!isGraphSlice(parsed.view)) {
    return {
      ok: false,
      error: "Document is missing a valid 'view' slice (v1 shape required).",
    };
  }

  // Forward-compat: reject files from a future build so the user knows to upgrade.
  if (
    typeof parsed.schemaVersion === "number" &&
    parsed.schemaVersion > CURRENT_SCHEMA_VERSION
  ) {
    return {
      ok: false,
      error: `Document schemaVersion ${parsed.schemaVersion} is newer than supported (${CURRENT_SCHEMA_VERSION}).`,
    };
  }

  // Stamp v1 if absent; the validated shape above is what determines validity.
  const document: GraphDocument = {
    ...(parsed as unknown as GraphDocument),
    schemaVersion: CURRENT_SCHEMA_VERSION,
  };

  return { ok: true, document };
}

// ---- Import ----------------------------------------------------------------
//
// Thin wrapper over `parseDocument` for the file-picker path; only difference
// from the shared validator is friendlier "File is not valid JSON" wording.

export type ImportResult = ParseResult;

export function importGraphJson(contents: string): ImportResult {
  const result = parseDocument(contents);
  if (!result.ok && /not valid JSON/i.test(result.error)) {
    return { ok: false, error: "File is not valid JSON." };
  }
  return result;
}
