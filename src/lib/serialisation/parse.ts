// src/lib/serialisation/parse.ts
//
// Parse + validate a JSON string against the v1 `{ graph, view }` shape
// (`../graph/types.ts`). Shared by `loadGraphDocument` (in `./storage.ts`) and
// `importGraphJson` so the two paths can't drift in robustness. Returns a
// discriminated result rather than throwing so callers pick their failure
// policy (load = soft, import = loud).
import { CURRENT_SCHEMA_VERSION, type GraphDocument } from "../graph/types";

export type ParseResult =
  | { ok: true; document: GraphDocument }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isGraphSlice(
  value: unknown,
): value is { nodes: unknown[]; edges: unknown[] } {
  if (!isRecord(value)) return false;
  if (!Array.isArray(value.nodes)) return false;
  if (!Array.isArray(value.edges)) return false;
  return true;
}

// Parse + validate a JSON string against the v1 shape. Stamps
// `schemaVersion` to `CURRENT_SCHEMA_VERSION` on success so downstream
// consumers don't handle the missing-field case.
export function parseDocument(contents: string): ParseResult {
  let parsed: unknown;

  try {
    parsed = JSON.parse(contents);
  } catch {
    return { ok: false, error: "Document is not valid JSON." };
  }

  if (!isRecord(parsed)) {
    return { ok: false, error: "Document must be a JSON object." };
  }

  if (!isGraphSlice(parsed.graph)) {
    return {
      ok: false,
      error: "Document is missing a valid 'graph' slice (v1 shape required).",
    };
  }

  if (!isGraphSlice(parsed.view)) {
    return {
      ok: false,
      error: "Document is missing a valid 'view' slice (v1 shape required).",
    };
  }

  // Forward-compat: reject files from a future build so the user knows to upgrade.
  if (
    typeof parsed.schemaVersion === "number" &&
    parsed.schemaVersion > CURRENT_SCHEMA_VERSION
  ) {
    return {
      ok: false,
      error: `Document schemaVersion ${parsed.schemaVersion} is newer than supported (${CURRENT_SCHEMA_VERSION}).`,
    };
  }

  // Stamp v1 if absent; the validated shape above is what determines validity.
  const document: GraphDocument = {
    ...(parsed as unknown as GraphDocument),
    schemaVersion: CURRENT_SCHEMA_VERSION,
  };

  return { ok: true, document };
}

// ---- Import ----------------------------------------------------------------
//
// Thin wrapper over `parseDocument` for the file-picker path; only difference
// from the shared validator is friendlier "File is not valid JSON" wording.

export type ImportResult = ParseResult;

export function importGraphJson(contents: string): ImportResult {
  const result = parseDocument(contents);
  if (!result.ok && /not valid JSON/i.test(result.error)) {
    return { ok: false, error: "File is not valid JSON." };
  }
  return result;
}
