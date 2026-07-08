// src/lib/graph/serialization.ts
//
// Persistence boundary. The persisted `GraphDocument` is the v2 shape
// `{ graph, view }` (see `./types.ts`); runtime React Flow objects never
// touch disk. This module owns:
//
//   - `projectDocument` — runtime `VertexNode[]` / `GraphEdge[]` → v2 doc.
//   - `hydrateDocument` — v2 doc → runtime objects the store / React Flow
//     can consume directly.
//   - `migrateV1ToV2`   — translate older documents (where the persisted
//     shape was React Flow's Node/Edge directly) into v2.
//
// Anything above this boundary should not need to know about React Flow's
// runtime fields; anything below it doesn't need to know about the v2 split.

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
