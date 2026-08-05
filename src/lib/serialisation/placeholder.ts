// src/lib/serialisation/placeholder.ts
//
// Serializer helpers shared across export formats.
import type { ExportParams } from "./formats";

// Metadata header for implemented serializers (e.g. TikZ): a comment block
// with export info, without the "(placeholder)" marker.
export function spoilerHeader(
  formatName: string,
  params: ExportParams,
  commentPrefix: string,
): string {
  const now = new Date().toISOString();
  const lines = [
    `${commentPrefix} Graph Board ${formatName} export`,
    `${commentPrefix} Exported: ${now}`,
    `${commentPrefix} Title: ${params.title}`,
    `${commentPrefix} Nodes: ${params.nodes.length}, Edges: ${params.edges.length}`,
  ];
  return lines.join("\n") + "\n";
}

// Serializer for formats whose spec is still TBD. Each placeholder export
// produces a clearly-marked, non-empty file so the picker flow works
// end-to-end before the real serializer lands.
export function placeholder(
  formatName: string,
  params: ExportParams,
  commentPrefix: string,
): string {
  const now = new Date().toISOString();
  const lines = [
    `${commentPrefix} Graph Board ${formatName} export (placeholder)`,
    `${commentPrefix} The ${formatName} format is not defined yet.`,
    `${commentPrefix} Exported: ${now}`,
    `${commentPrefix} Title: ${params.title}`,
    `${commentPrefix} Nodes: ${params.nodes.length}, Edges: ${params.edges.length}`,
  ];
  return lines.join("\n") + "\n";
}
