// src/lib/serialisation/storage.ts
//
// localStorage persistence for the tabbed workspace. The stored payload is a
// `layout: "tabs"` wrapper around one v2 document per tab (`GraphWorkspace` —
// see `../graph/types`); legacy single-doc payloads load as a one-tab
// workspace. Writes go through `projectToDocument` (always to the current
// schema) and reads through `parseWorkspace` (fail-soft). SSR-guarded — never
// touches `window` on the server.
import {
  CURRENT_SCHEMA_VERSION,
  PERSISTED_IDS,
  STORAGE_LAYOUT_TABS,
  type GraphDocument,
  type GraphEdge,
  type GraphWorkspace,
  type TabsStorageLayout,
  type VertexNode,
} from "../graph/types";
import { projectToDocument } from "./document";
import { parseWorkspace } from "./parse";

const LOCAL_STORAGE_KEY = "graph-board-document";

// Recovery copy written before a failed load replaces the document with the
// empty fallback (see `loadGraphWorkspace`) — lets a regression (rather than
// real corruption) be recovered. Shared with the store's hydrate fail-soft.
export const LOCAL_STORAGE_BACKUP_KEY = "graph-board-document-backup";

export function createEmptyGraphDocument(
  title = "Untitled Graph",
): GraphDocument {
  const now = new Date().toISOString();

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: PERSISTED_IDS.localDocument,
    title,
    graph: { nodes: [], edges: [] },
    view: { nodes: [], edges: [] },
    createdAt: now,
    updatedAt: now,
  };
}

export function saveGraphWorkspace(workspace: GraphWorkspace): void {
  if (typeof window === "undefined") return;

  const layout: TabsStorageLayout = { layout: STORAGE_LAYOUT_TABS, ...workspace };
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(layout));
}

export function loadGraphWorkspace(): GraphWorkspace {
  if (typeof window === "undefined") {
    return emptyWorkspace();
  }

  const raw = localStorage.getItem(LOCAL_STORAGE_KEY);

  if (!raw) {
    return emptyWorkspace();
  }

  // Load fails soft: corrupt/future-schema payloads warn and fall back to
  // empty rather than throwing into `hydrateDocument` (which would crash the
  // editor).
  const result = parseWorkspace(raw);
  if (!result.ok) {
    console.warn(`graph-board: ${result.error}; loading empty document.`);
    // Preserve the unreadable raw payload: the empty fallback is autosaved
    // ~2s later, which would otherwise destroy the user's only copy.
    try {
      localStorage.setItem(LOCAL_STORAGE_BACKUP_KEY, raw);
    } catch {
      // Quota / availability issues must not block loading.
    }
    return emptyWorkspace();
  }

  return result.workspace;
}

function emptyWorkspace(): GraphWorkspace {
  const document = createEmptyGraphDocument();
  return { activeTabId: document.id, tabs: [{ id: document.id, document }] };
}

// ---- Legacy single-doc helpers ----------------------------------------------
//
// Pre-tabs API (and its tests) keep working on top of the wrapper: saving
// writes a one-tab workspace, loading returns the active tab's document.

export function saveGraphDocument(params: {
  id: string;
  title: string;
  nodes: VertexNode[];
  edges: GraphEdge[];
  createdAt?: string;
}): void {
  const createdAt = params.createdAt ?? new Date().toISOString();

  saveGraphWorkspace({
    activeTabId: params.id,
    tabs: [
      {
        id: params.id,
        document: projectToDocument({
          id: params.id,
          title: params.title,
          nodes: params.nodes,
          edges: params.edges,
          createdAt,
          updatedAt: new Date().toISOString(),
        }),
      },
    ],
  });
}

export function loadGraphDocument(): GraphDocument {
  const workspace = loadGraphWorkspace();
  const active =
    workspace.tabs.find((tab) => tab.id === workspace.activeTabId) ??
    workspace.tabs[0];
  return active?.document ?? createEmptyGraphDocument();
}
