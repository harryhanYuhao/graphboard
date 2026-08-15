// src/lib/serialisation/parse.ts
//
// Parse + validate a JSON string against the current `{ graph, view }` shape
// (`../graph/types.ts`). Shared by `loadGraphDocument` (in `./storage.ts`) and
// `importGraphJson` so the two paths can't drift in robustness. Returns a
// discriminated result rather than throwing so callers pick their failure
// policy (load = soft, import = loud).
import {
  CURRENT_SCHEMA_VERSION,
  type GraphDocument,
  type VertexType,
} from "../graph/types";

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

// First string id appearing twice, or undefined. Malformed entries (null /
// non-object / non-string id) are skipped here — hydration fails on them.
function firstDuplicateId(entries: unknown[]): string | undefined {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    if (typeof entry.id !== "string") continue;
    if (seen.has(entry.id)) return entry.id;
    seen.add(entry.id);
  }
  return undefined;
}

// Parse + validate a JSON string against the v2 shape. Stamps
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
      error: "Document is missing a valid 'graph' slice (v2 shape required).",
    };
  }

  if (!isGraphSlice(parsed.view)) {
    return {
      ok: false,
      error: "Document is missing a valid 'view' slice (v2 shape required).",
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

  // Duplicate ids would collide as React Flow keys downstream.
  const duplicateNode = firstDuplicateId(parsed.graph.nodes);
  if (duplicateNode !== undefined) {
    return {
      ok: false,
      error: `Duplicate node id '${duplicateNode}' in 'graph' slice.`,
    };
  }

  const duplicateEdge = firstDuplicateId(parsed.graph.edges);
  if (duplicateEdge !== undefined) {
    return {
      ok: false,
      error: `Duplicate edge id '${duplicateEdge}' in 'graph' slice.`,
    };
  }

  // Migrate older schema versions, then stamp the current version. The
  // validated shape above determines validity; migration only rewrites known
  // old shapes (v1 → v2 today).
  const document: GraphDocument = migrateDocument(
    parsed as unknown as GraphDocument,
  );

  return { ok: true, document: { ...document, schemaVersion: CURRENT_SCHEMA_VERSION } };
}

// ---- Schema migrations ------------------------------------------------------
//
// Each version's migration rewrites a parsed doc into the next shape. Runs
// inside `parseDocument` so both the load and import paths get migrated docs
// before hydration. Idempotent: a doc already at the target version passes
// through unchanged.

function migrateDocument(doc: GraphDocument): GraphDocument {
  // v1 → v2: the vertex phase moved from `data.label` to `data.phase`; the
  // view slice gains optional `label` / `labelLocation` (absent hydrates to
  // defaults, so no view rewrite is needed).
  if (doc.schemaVersion !== undefined && doc.schemaVersion > 1) {
    return doc;
  }

  return {
    ...doc,
    graph: {
      ...doc.graph,
      nodes: doc.graph.nodes.map((node) => {
        // Defensive: element-shape validation happens at hydration, not here.
        // Pass malformed entries (null / non-object) through untouched so
        // hydration still fails softly exactly as before the migration ran.
        if (node == null || typeof node !== "object") {
          return node as never;
        }
        const data = (node as { data?: unknown }).data as
          | {
            phase?: string;
            label?: string;
            vertexType: VertexType;
            order?: number;
          }
          | null
          | undefined;
        if (data == null || typeof data !== "object") {
          return node as never;
        }
        // Preserve everything else on `data` (e.g. boundary `order`, which
        // sets the contracted tensor's axis order) — only the phase key is
        // renamed. Spreading the old data first keeps `order` and any
        // future optional fields.
        const { phase, label, ...rest } = data;
        return {
          ...node,
          data: {
            ...rest,
            vertexType: data.vertexType,
            phase: phase ?? label ?? "",
          },
        };
      }),
    },
  };
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
