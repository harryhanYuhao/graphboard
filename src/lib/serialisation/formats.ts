// src/lib/serialisation/formats.ts
//
// Export-format registry. Each format knows how to serialize the graph into
// a string plus the metadata the picker needs (extension, mime type). The
// serializers themselves live one file per format (`./export-*.ts`) so a
// format's logic stays contained; this module only wires them together.
// Pure module — no store, no window — so it's unit-testable.
//
// ZXLive and QASM formats are NOT defined yet (spec TBD); their serializers
// emit a clearly-marked placeholder. TikZ is implemented (`./export-tikz.ts`).

import type { GraphEdge, VertexNode } from "@/lib/graph/types";
import { exportGraphJson } from "./export-json";
import { exportTikz } from "./export-tikz";
import { exportZxlive } from "./export-zxlive";
import { exportQasm } from "./export-qasm";

/** Inputs shared by every serializer (same shape as `exportGraphJson`). */
export interface ExportParams {
  title: string;
  nodes: VertexNode[];
  edges: GraphEdge[];
  /** Preserved from the store so exports keep the original creation time. */
  createdAt?: string;
}

export type ExportFormatId = "json" | "tikz" | "zxlive" | "qasm";

export interface ExportFormat {
  id: ExportFormatId;
  label: string;
  description: string;
  doc_url: string;
  extension: string;
  mimeType: string;
  serialize: (params: ExportParams) => string;
}

export const EXPORT_FORMATS: ExportFormat[] = [
  {
    id: "json",
    label: "JSON",
    description: "Graph Board's native document format (graph + view slices).",
    doc_url: "https://zxwgraphboard-doc.netlify.app/user-guides/saving-and-loading/",
    extension: ".json",
    mimeType: "application/json",
    serialize: (params) => exportGraphJson(params),
  },
  {
    id: "tikz",
    label: "TikZ",
    description: "LaTeX TikZ picture.",
    doc_url: "https://zxwgraphboard-doc.netlify.app/user-guides/saving-and-loading/#using-a-tikz-export-in-latex",
    extension: ".tikz",
    mimeType: "text/plain",
    serialize: (params) => exportTikz(params),
  },
  {
    id: "zxlive",
    label: "ZXLive",
    description: "ZXLive-compatible graph (Placeholder only).",
    doc_url: "https://zxwgraphboard-doc.netlify.app/user-guides/saving-and-loading/",
    extension: ".zxlive",
    mimeType: "text/plain",
    serialize: (params) => exportZxlive(params),
  },
  {
    id: "qasm",
    label: "QASM",
    description: "Quantum Assembly (Placeholder only)",
    doc_url: "https://zxwgraphboard-doc.netlify.app/user-guides/saving-and-loading/",
    extension: ".qasm",
    mimeType: "text/plain",
    serialize: (params) => exportQasm(params),
  },
];

export function getExportFormat(id: ExportFormatId): ExportFormat {
  const format = EXPORT_FORMATS.find((f) => f.id === id);
  if (!format) {
    throw new Error(`unknown export format '${id}'`);
  }
  return format;
}
