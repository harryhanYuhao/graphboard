// src/lib/serialisation/placeholder.ts
//
// Shared serializer for formats whose spec is still TBD. Each placeholder
// export produces a clearly-marked, non-empty file so the picker flow works
// end-to-end before the real serializer lands.
import type { ExportParams } from "./formats";

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
