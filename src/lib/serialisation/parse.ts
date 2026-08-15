// src/lib/serialisation/parse.ts
//
// Parse + validate a JSON string against the current `{ graph, view }` shape
// (`../graph/types.ts`). Shared by `loadGraphDocument` (in `./storage.ts`) and
// `importGraphJson` so the two paths can't drift in robustness. Returns a
// discriminated result rather than throwing so callers pick their failure
// policy (load = soft, import = loud).
import {
  CURRENT_SCHEMA_VERSION,
  PERSISTED_IDS,
  STORAGE_LAYOUT_TABS,
  type GraphDocument,
  type GraphWorkspace,
  type VertexType,
  type WorkspaceTab,
} from "../graph/types";

export type ParseResult =
  | { ok: true; document: GraphDocument }
  | { ok: false; error: string };

export type WorkspaceParseResult =
  | { ok: true; workspace: GraphWorkspace }
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

  return parseDocumentObject(parsed);
}

// Object-level validation of one v2 document (shared by `parseDocument`,
// `parseWorkspace`, and the import path so they can't drift).
function parseDocumentObject(parsed: unknown): ParseResult {
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

// ---- Workspace parsing (localStorage tabs layout) ---------------------------
//
// Load-path counterpart to `parseDocument`: accepts either a `layout: "tabs"`
// wrapper of v2 documents (one per tab) or a legacy single v1/v2 document
// (which becomes a one-tab workspace). Import deliberately stays on
// `parseDocument` — a wrapper is not a graph and must not merge silently.

export function parseWorkspace(contents: string): WorkspaceParseResult {
  let parsed: unknown;

  try {
    parsed = JSON.parse(contents);
  } catch {
    return { ok: false, error: "Document is not valid JSON." };
  }

  if (!isRecord(parsed)) {
    return { ok: false, error: "Document must be a JSON object." };
  }

  if (parsed.layout === STORAGE_LAYOUT_TABS) {
    return parseTabsLayout(parsed);
  }

  // Legacy payload: one tab carrying the document's own id.
  const result = parseDocumentObject(parsed);
  if (!result.ok) return result;

  const tabId =
    typeof result.document.id === "string" && result.document.id.length > 0
      ? result.document.id
      : PERSISTED_IDS.localDocument;

  return {
    ok: true,
    workspace: {
      activeTabId: tabId,
      tabs: [{ id: tabId, document: result.document }],
    },
  };
}

function parseTabsLayout(parsed: Record<string, unknown>): WorkspaceParseResult {
  const tabsRaw = parsed.tabs;
  if (!Array.isArray(tabsRaw) || tabsRaw.length === 0) {
    return {
      ok: false,
      error: "Tabs workspace must contain at least one tab.",
    };
  }

  const tabs: WorkspaceTab[] = [];
  const seenIds = new Set<string>();
  for (const entry of tabsRaw) {
    if (!isRecord(entry) || typeof entry.id !== "string") {
      return { ok: false, error: "Each workspace tab needs a string 'id'." };
    }
    if (seenIds.has(entry.id)) {
      return { ok: false, error: `Duplicate tab id '${entry.id}'.` };
    }
    seenIds.add(entry.id);

    const docResult = parseDocumentObject(entry.document);
    if (!docResult.ok) {
      return { ok: false, error: `Tab '${entry.id}': ${docResult.error}` };
    }
    tabs.push({ id: entry.id, document: docResult.document });
  }

  const activeTabId =
    typeof parsed.activeTabId === "string" && seenIds.has(parsed.activeTabId)
      ? parsed.activeTabId
      : tabs[0].id;

  return { ok: true, workspace: { activeTabId, tabs } };
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
