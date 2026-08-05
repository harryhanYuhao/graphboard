// src/lib/serialisation/storage.ts
//
// localStorage persistence for the local document. Writes go through
// `projectDocument` (always to the current schema) and reads through
// `parseDocument` (fail-soft). SSR-guarded — never touches `window` on
// the server.
import {
  CURRENT_SCHEMA_VERSION,
  PERSISTED_IDS,
  type GraphDocument,
  type GraphEdge,
  type VertexNode,
} from "../graph/types";
import { projectToDocument } from "./document";
import { parseDocument } from "./parse";

const LOCAL_STORAGE_KEY = "graph-board-document";

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
  const document = projectToDocument({
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
