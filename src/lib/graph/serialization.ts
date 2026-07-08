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
  type EdgeView,
  type GraphDocument,
  type GraphEdge,
  type GraphEdgeRecord,
  type GraphNodeRecord,
  type NodeView,
  type VertexNode,
} from "./types";

const LOCAL_STORAGE_KEY = "graph-board-document";

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
    viewNodes.push({ id: node.id, position: node.position });
  }

  const graphEdges: GraphEdgeRecord[] = [];
  const viewEdges: EdgeView[] = [];
  for (const edge of input.edges) {
    graphEdges.push({ id: edge.id, source: edge.source, target: edge.target });
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
    data: graphNode.data,
    // `origin` pins React Flow's handle anchor at the node center so
    // connections snap there. Renderer-level detail, not persisted.
    origin: [0.5, 0.5],
  };
}

function hydrateEdge(graphEdge: GraphEdgeRecord): GraphEdge {
  return {
    id: graphEdge.id,
    source: graphEdge.source,
    target: graphEdge.target,
    // Renderer-level discriminator; "straight-center" is the only edge
    // type today, but it stays in the runtime layer.
    type: "straight-center",
  };
}

export function hydrateDocument(doc: GraphDocument): HydratedDocument {
  const nodeViewById = new Map<string, NodeView>(
    doc.view.nodes.map((v) => [v.id, v]),
  );

  return {
    id: doc.id,
    title: doc.title,
    nodes: doc.graph.nodes.map((n) => hydrateNode(n, nodeViewById)),
    edges: doc.graph.edges.map((e) => hydrateEdge(e)),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

// ---- Public API ------------------------------------------------------------

export function createEmptyGraphDocument(): GraphDocument {
  const now = new Date().toISOString();

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: "local-document",
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

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return createEmptyGraphDocument();
  }

  if (!parsed || typeof parsed !== "object") {
    return createEmptyGraphDocument();
  }

  const obj = parsed as Record<string, unknown>;

  if (
    typeof obj.schemaVersion === "number" &&
    obj.schemaVersion > CURRENT_SCHEMA_VERSION
  ) {
    console.warn(
      `graph-board: document schemaVersion ${obj.schemaVersion} is newer than supported ${CURRENT_SCHEMA_VERSION}; loading empty document.`,
    );
    return createEmptyGraphDocument();
  }

  return obj as unknown as GraphDocument;
}

export function exportGraphJson(params: {
  title: string;
  nodes: VertexNode[];
  edges: GraphEdge[];
}): string {
  const now = new Date().toISOString();

  const document = projectDocument({
    id: "exported-document",
    title: params.title,
    nodes: params.nodes,
    edges: params.edges,
    createdAt: now,
    updatedAt: now,
  });

  return JSON.stringify(document, null, 2);
}

// ---- Import ----------------------------------------------------------------
//
// Parse + validate a JSON string picked from disk. The contract is the v1
// `{ graph, view }` shape (see `./types.ts`). Pre-v1 "draft" documents —
// where nodes/edges were React Flow runtime objects dumped straight to
// disk — are not supported; they're treated as malformed here so the
// importer surfaces a clear error rather than silently dropping data.
//
// Returns a discriminated result rather than throwing so callers (the
// store action, mostly) can render a user-visible error message without
// needing to wrap in try/catch.

export type ImportResult =
  | { ok: true; document: GraphDocument }
  | { ok: false; error: string };

export function importGraphJson(contents: string): ImportResult {
  let parsed: unknown;

  try {
    parsed = JSON.parse(contents);
  } catch {
    return { ok: false, error: "File is not valid JSON." };
  }

  if (!parsed || typeof parsed !== "object") {
    return { ok: false, error: "Document must be a JSON object." };
  }

  const obj = parsed as Record<string, unknown>;

  if (!obj.graph || typeof obj.graph !== "object") {
    return {
      ok: false,
      error: "Document is missing the 'graph' slice (v1 shape required).",
    };
  }

  if (!obj.view || typeof obj.view !== "object") {
    return {
      ok: false,
      error: "Document is missing the 'view' slice (v1 shape required).",
    };
  }

  // Forward compat: a file from a future build this one doesn't understand.
  // Don't silently accept — surface the mismatch so the user knows to
  // upgrade.
  if (
    typeof obj.schemaVersion === "number" &&
    obj.schemaVersion > CURRENT_SCHEMA_VERSION
  ) {
    return {
      ok: false,
      error: `Document schemaVersion ${obj.schemaVersion} is newer than supported (${CURRENT_SCHEMA_VERSION}).`,
    };
  }

  // Stamp v1 if absent so downstream consumers don't have to handle the
  // missing-field case. We trust the validated `graph`/`view` shape above
  // to determine validity — schemaVersion is just a hint.
  const document: GraphDocument = {
    ...(obj as unknown as GraphDocument),
    schemaVersion: CURRENT_SCHEMA_VERSION,
  };

  return { ok: true, document };
}
