// src/lib/graph/serialization.ts

import type { GraphDocument, GraphEdge, VertexNode } from "./types";

const LOCAL_STORAGE_KEY = "graph-board-document";

export function createEmptyGraphDocument(): GraphDocument {
  const now = new Date().toISOString();

  return {
    id: "local-document",
    title: "Untitled Graph",
    nodes: [],
    edges: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function saveGraphDocument(document: GraphDocument): void {
  if (typeof window === "undefined") return;

  localStorage.setItem(
    LOCAL_STORAGE_KEY,
    JSON.stringify({
      ...document,
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

  try {
    return JSON.parse(raw) as GraphDocument;
  } catch {
    return createEmptyGraphDocument();
  }
}

export function exportGraphJson(params: {
  title: string;
  nodes: VertexNode[];
  edges: GraphEdge[];
}): string {
  const now = new Date().toISOString();

  const document: GraphDocument = {
    id: "exported-document",
    title: params.title,
    nodes: params.nodes,
    edges: params.edges,
    createdAt: now,
    updatedAt: now,
  };

  return JSON.stringify(document, null, 2);
}