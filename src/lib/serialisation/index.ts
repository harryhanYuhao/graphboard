// src/lib/serialisation/index.ts
//
// Public API of the serialisation module — the single import point for the
// rest of the app. Persistence (project/hydrate, parse, localStorage) and
// export (per-format serializers + registry) all live under this folder so
// future schema work stays contained.
export {
  normalizeRotation,
  projectToDocument as projectDocument,
  hydrateDocument,
  type ProjectInput,
  type HydratedDocument,
} from "./document";
export {
  parseDocument,
  importGraphJson,
  type ParseResult,
  type ImportResult,
} from "./parse";
export {
  createEmptyGraphDocument,
  saveGraphDocument,
  loadGraphDocument,
} from "./storage";
export { exportGraphJson } from "./export-json";
export { exportTikz } from "./export-tikz";
export { exportZxLive } from "./export-zxlive";
export { exportQasm } from "./export-qasm";
export {
  EXPORT_FORMATS,
  getExportFormat,
  type ExportParams,
  type ExportFormatId,
  type ExportFormat,
} from "./formats";
