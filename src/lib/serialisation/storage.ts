// src/lib/serialisation/storage.ts
//
// localStorage persistence for the local document. Writes go through
// `projectToDocument` (always to the current schema) and reads through
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

// Recovery copy written before a failed load replaces the document with the
// empty fallback (see `loadGraphDocument`) — lets a regression (rather than
// real corruption) be recovered. Shared with the store's hydrate fail-soft.
export const LOCAL_STORAGE_BACKUP_KEY = "graph-board-document-backup";

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
    // Preserve the unreadable raw document: the empty fallback is autosaved
    // ~2s later, which would otherwise destroy the user's only copy.
    try {
      localStorage.setItem(LOCAL_STORAGE_BACKUP_KEY, raw);
    } catch {
      // Quota / availability issues must not block loading.
    }
    return createEmptyGraphDocument();
  }

  return result.document;
}
