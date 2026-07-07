// src/lib/graph/serialization.ts

import {
  CURRENT_SCHEMA_VERSION,
  type GraphDocument,
  type GraphEdge,
  type VertexNode,
} from "./types";

const LOCAL_STORAGE_KEY = "graph-board-document";

export function createEmptyGraphDocument(): GraphDocument {
  const now = new Date().toISOString();

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: "local-document",
    title: "Untitled Graph",
    nodes: [],
    edges: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function saveGraphDocument(
  document: Omit<GraphDocument, "schemaVersion">,
): void {
  if (typeof window === "undefined") return;

  // Always write the current schema version on save so older documents
  // get upgraded implicitly the next time the user touches them.
  localStorage.setItem(
    LOCAL_STORAGE_KEY,
    JSON.stringify({
      ...document,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
    }),
  );
}

export function loadGraphDocument(): GraphDocument {
  if (typeof window === "undefined") {
    return createEmptyGraphDocument();
  }

  const raw = localStorage.getItem(LOCAL_STORAGE_KEY);

  if (!raw) {
    return createEmptyGraphDocument();
  }

  let parsed: Partial<GraphDocument>;

  try {
    parsed = JSON.parse(raw) as Partial<GraphDocument>;
  } catch {
    return createEmptyGraphDocument();
  }

  // Backward compat: documents saved before schema versioning existed
  // have no schemaVersion field. Treat them as v1 — the previous shape
  // is identical to v1.
  if (typeof parsed.schemaVersion !== "number") {
    return {
      ...createEmptyGraphDocument(),
      ...parsed,
      schemaVersion: CURRENT_SCHEMA_VERSION,
    } as GraphDocument;
  }

  if (parsed.schemaVersion > CURRENT_SCHEMA_VERSION) {
    // A future build saved a document this build doesn't understand.
    // Don't silently drop data; fall back to an empty document so the
    // user notices something is off rather than overwriting it on next save.
    console.warn(
      `graph-board: document schemaVersion ${parsed.schemaVersion} is newer than supported ${CURRENT_SCHEMA_VERSION}; loading empty document.`,
    );
    return createEmptyGraphDocument();
  }

  return parsed as GraphDocument;
}

export function exportGraphJson(params: {
  title: string;
  nodes: VertexNode[];
  edges: GraphEdge[];
}): string {
  const now = new Date().toISOString();

  const document: GraphDocument = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: "exported-document",
    title: params.title,
    nodes: params.nodes,
    edges: params.edges,
    createdAt: now,
    updatedAt: now,
  };

  return JSON.stringify(document, null, 2);
}

