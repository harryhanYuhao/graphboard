// src/lib/serialisation/export-zxlive.ts
//
// ZXLive-compatible graph export. NOT defined yet (spec TBD) — emits a
// clearly marked placeholder so the picker flow works end-to-end.
import type { ExportParams } from "./formats";
import { placeholder } from "./placeholder";

export function exportZxlive(params: ExportParams): string {
  return placeholder("ZXLive", params, "#");
}
