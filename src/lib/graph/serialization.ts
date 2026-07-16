// src/lib/graph/serialization.ts
//
// Persistence boundary. The persisted `GraphDocument` is the v1 shape
// `{ graph, view }` (see `./types.ts`); runtime React Flow objects never
// touch disk. This module owns:
//
//   - `projectDocument` — runtime `VertexNode[]` / `GraphEdge[]` → v1 doc.
//   - `hydrateDocument` — v1 doc → runtime objects the store / React Flow
//     can consume directly.
//
// Anything above this boundary should not need to know about React Flow's
// runtime fields; anything below it doesn't need to know about the
// graph/view split.

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
import { VERTEX_TYPE_MAP } from "./vertex-types";

const LOCAL_STORAGE_KEY = "graph-board-document";

// Collapse any angle (possibly negative or > 360) to the canonical
// [0, 360) range. 360 and 0 are equivalent visually, but 0 is the
// shorter representation. Used at both commit and projection so disk
// and live state stay in the same canonical form.
//
// The result is rounded to 6 decimal places: `%` float math can leave
// drift like 270.00000000006 or 89.99999999999, which would otherwise
// accumulate across save/load cycles and make equality checks
// (e.g. the property panel's `rotation !== 0` reset check) flaky.
export function normalizeRotation(rotation: number): number {
  if (!Number.isFinite(rotation)) return 0;
  const wrapped = ((rotation % 360) + 360) % 360;
  // Round away % drift, then collapse the exact-360 case to 0.
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
    // `rotation` is normalized to the [0, 360) range so persisted
    // documents don't accumulate drift from the user's typed values
    // (e.g. typing 720 collapses to 0). Mirrors the panel's commit
    // behavior, so the disk format is always canonical.
    viewNodes.push({
      id: node.id,
      position: node.position,
      rotation: normalizeRotation(node.rotation ?? 0),
    });
  }

  const graphEdges: GraphEdgeRecord[] = [];
  const viewEdges: EdgeView[] = [];
  for (const edge of input.edges) {
    // Persisted edges carry the handle slots as numeric indices
    // (0 = top, 1 = bottom). The runtime side stores React-Flow
    // handle ids ("center-source" / "top" / "center-target") — we
    // translate here so the on-disk format is stable across vertex
    // types and forward-compatible with nodes that have more than
    // two handles.
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

// Reconstruct a runtime `VertexNode` from the persisted graph entry plus the
// matching view entry. Positions default to origin if a view entry is
// missing (defensive — shouldn't happen for documents we wrote ourselves).
function hydrateNode(
  graphNode: GraphNodeRecord,
  viewById: Map<string, NodeView>,
): VertexNode {
  const view = viewById.get(graphNode.id);

  return {
    id: graphNode.id,
    type: "vertex",
    position: view?.position ?? { x: 0, y: 0 },
    // Pre-rotation documents have no `rotation` view entry — treat
    // absence as 0 so existing saved graphs hydrate unchanged.
    rotation: normalizeRotation(view?.rotation ?? 0),
    data: graphNode.data,
    // `origin` pins React Flow's handle anchor at the node center so
    // connections snap there. Renderer-level detail, not persisted.
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
    // Translate the persisted numeric indices back to runtime handle
    // ids. Absent fields fall back to sensible defaults — see
    // `indexToHandleId`.
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
    // Renderer-level discriminator; today there is only one edge type
    // (`EDGE_TYPES.straightCenter`), but the constant lives here so
    // future variants slot in without grepping for string literals.
    type: EDGE_TYPES.straightCenter,
  };
}

export function hydrateDocument(doc: GraphDocument): HydratedDocument {
  const nodeViewById = new Map<string, NodeView>(
    doc.view.nodes.map((v) => [v.id, v]),
  );
  // Pre-index vertex types so hydrateEdge can look up the source /
  // target endpoint in O(1) without re-scanning the node list per
  // edge.
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
// Edges on disk carry numeric handle indices (0 = top, 1 = bottom).
// At runtime they carry React-Flow handle ids ("center-source" /
// "top" / "center-target"). The two helpers below are the only place
// this mapping lives — keep them in sync if either side adds new
// values.

// Convert a runtime handle id to the persisted numeric index. The
// bottom handle (always a source-type slot, HANDLE_IDS.centerSource)
// is index 1; everything else (target-type slots, including the
// directional HANDLE_IDS.top dot) is index 0. Unknown / absent
// handles return undefined so the field gets omitted from the JSON
// output entirely — the deserializer then falls back to its
// per-role default.
function handleIdToIndex(handleId: string | null | undefined): number | undefined {
  if (handleId == null) return undefined;
  if (handleId === HANDLE_IDS.centerSource) return 1;
  return 0;
}

// Convert a persisted numeric index back to a runtime handle id,
// picking the right id based on the endpoint's role (source vs
// target) and the vertex's directional flag.
//
// Defaults (when the field is absent on disk):
//   - source side → bottom slot (1) → HANDLE_IDS.centerSource. This
//     matches the user-facing rule for W / And gate ("default shall
//     be the bottom handle"); for non-directional vertices both
//     handles are at the body center anyway, so the choice is
//     cosmetic.
//   - target side → top slot (0) → HANDLE_IDS.top for directional
//     vertices (the visible input dot), HANDLE_IDS.centerTarget
//     otherwise.
function indexToHandleId(
  index: number | undefined,
  vertexType: VertexType | undefined,
  role: "source" | "target",
): string {
  const meta = vertexType ? VERTEX_TYPE_MAP[vertexType] : undefined;
  const isDirectional = meta?.directional === true;

  if (role === "source") {
    // Source side is always the bottom slot, regardless of vertex
    // type — the data leaves from there.
    return HANDLE_IDS.centerSource;
  }

  // Target side: top slot, with the directional case picking the
  // visible HANDLE_IDS.top handle id. Unknown indices fall through
  // to the default.
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

  // Always project to the current schema on save so older documents
  // get upgraded implicitly the next time the user touches them.
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

  // The load path fails soft: a corrupt or future-schema document
  // logs a warning and falls back to an empty doc rather than
  // throwing into `hydrateDocument` (where a `nodes.map is not a
  // function` would crash the editor on next reload).
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
  // Preserved from the store so exports retain the document's
  // original creation time. Defaults to "now" for callers without a
  // store (e.g. tests) so an export never carries a misleading
  // creation timestamp.
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
// Parse + validate a JSON string into a `GraphDocument`. The contract is
// the v1 `{ graph, view }` shape (see `./types.ts`). Pre-v1 "draft"
// documents — where nodes/edges were React Flow runtime objects dumped
// straight to disk — are not supported; they're treated as malformed so
// callers surface a clear error rather than silently dropping data.
//
// Both `loadGraphDocument` (localStorage) and `importGraphJson` (file
// picker) route through here so the two entry paths can't drift in
// robustness — a hand-edited localStorage entry gets the same structural
// scrutiny as a file picked from disk.
//
// Returns a discriminated result rather than throwing so callers pick
// their own failure policy (load = soft, import = loud).

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

// Parse a JSON string and validate it matches the v1 document shape.
// `schemaVersion` is stamped to `CURRENT_SCHEMA_VERSION` on success so
// downstream consumers don't have to handle the missing-field case.
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

  // Forward compat: a file from a future build this one doesn't understand.
  // Don't silently accept — surface the mismatch so the user knows to
  // upgrade.
  if (
    typeof parsed.schemaVersion === "number" &&
    parsed.schemaVersion > CURRENT_SCHEMA_VERSION
  ) {
    return {
      ok: false,
      error: `Document schemaVersion ${parsed.schemaVersion} is newer than supported (${CURRENT_SCHEMA_VERSION}).`,
    };
  }

  // Stamp v1 if absent so downstream consumers don't have to handle
  // the missing-field case. The validated `graph`/`view` shape above
  // is what determines validity; schemaVersion is just a hint.
  const document: GraphDocument = {
    ...(parsed as unknown as GraphDocument),
    schemaVersion: CURRENT_SCHEMA_VERSION,
  };

  return { ok: true, document };
}

// ---- Import ----------------------------------------------------------------
//
// Thin wrapper over `parseDocument` for the file-picker path. The
// underlying validator is shared with `loadGraphDocument`; the only
// difference is the error wording ("File is not valid JSON" vs the
// generic "Document is not valid JSON") so import failures read
// naturally to the user.

export type ImportResult = ParseResult;

export function importGraphJson(contents: string): ImportResult {
  const result = parseDocument(contents);
  if (!result.ok && /not valid JSON/i.test(result.error)) {
    return { ok: false, error: "File is not valid JSON." };
  }
  return result;
}
