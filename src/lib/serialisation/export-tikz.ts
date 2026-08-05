// src/lib/serialisation/export-tikz.ts
//
// LaTeX TikZ picture export. NOT defined yet (spec TBD) — emits a clearly
// marked placeholder so the picker flow works end-to-end.
import type { ExportParams } from "./formats";
import { placeholder } from "./placeholder";

export function exportTikz(params: ExportParams): string {
  return placeholder("TikZ", params, "%");
}
