// src/lib/serialisation/export-json.ts
//
// JSON export serializer: the native Graph Board document format
// (`{ graph, view }` v2 shape). Positions are mean-centered before
// projection so the exported file doesn't carry absolute canvas offsets.
// Pure — no store, no window; never mutates the input nodes.
import { PERSISTED_IDS, type GraphEdge, type VertexNode } from "../graph/types";
import { projectToDocument } from "./document";
import { normalizeNodePositions } from "./normalize";

export function exportGraphJson(params: {
  title: string;
  nodes: VertexNode[];
  edges: GraphEdge[];
  // Preserved from the store so exports keep the original creation time;
  // defaults to "now" for callers without a store (e.g. tests).
  createdAt?: string;
}): string {
  const now = new Date().toISOString();

  const document = projectToDocument({
    id: PERSISTED_IDS.exportedDocument,
    title: params.title,
    nodes: normalizeNodePositions(params.nodes),
    edges: params.edges,
    createdAt: params.createdAt ?? now,
    updatedAt: now,
  });

  return JSON.stringify(document, null, 2);
}
