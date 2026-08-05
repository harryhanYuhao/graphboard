// src/lib/serialisation/export-qasm.ts
//
// Quantum Assembly (QASM) export. NOT defined yet (spec TBD) — emits a
// clearly marked placeholder so the picker flow works end-to-end.
import type { ExportParams } from "./formats";
import { placeholder } from "./placeholder";

export function exportQasm(params: ExportParams): string {
  return placeholder("QASM", params, "//");
}
