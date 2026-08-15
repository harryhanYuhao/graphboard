"use client";

import {
  applyEdgeChanges,
  applyNodeChanges,
  type EdgeChange,
  type NodeChange,
  type Viewport,
} from "@xyflow/react";
import { nanoid } from "nanoid";
import { create } from "zustand";
import { temporal } from "zundo";
import {
  DEFAULT_EDGE_KIND,
  EDITOR_MODES,
  type EditorMode,
  type GraphEdge,
  type EdgeKind,
  type LabelLocation,
  type VertexNode,
  type VertexType,
} from "@/lib/graph/types";
import {
  assignBoundaryOrderOnTypeChange,
  computeVertexClick,
  createVertexNode,
  deleteSelectedElements,
  cloneSubgraphForClipboard,
  clearAllSelections,
  getSelectedSubgraph,
  IMPORT_OFFSET_STEP,
  mergeImportedGraph,
  nextBoundaryOrder,
  pasteSubgraph,
  reorderBoundaryVertex,
  selectAllElements,
  snapPosition,
  type VertexClickModifiers,
} from "@/lib/graph/operations";
import {
  DEFAULT_VERTEX_TYPE,
  isBoundaryVertex,
} from "@/lib/graph/vertex-registry";
import { selectSelectedNodeIds } from "@/store/selectors";
import {
  getExportFormat,
  hydrateDocument,
  importGraphJson,
  type HydratedDocument,
  loadGraphWorkspace,
  LOCAL_STORAGE_BACKUP_KEY,
  normalizeRotation,
  projectDocument,
  saveGraphWorkspace,
  type ExportFormatId,
} from "@/lib/serialisation";

import { openTextFileWithPicker, saveTextFileWithPicker } from "@/lib/download";

import { toSafeFilename } from "@/lib/filename";
import type { ValidationError } from "@/lib/graph/validate";
import { markIntroSeen, shouldShowIntro } from "@/lib/onboarding/intro";

// Shape for the destructive-action confirmation dialog. `null` means
// no dialog open; consumers call `confirmDialogue?.onConfirm`.
export type ConfirmDialogueState = {
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
  confirmButtonClassName: string;
  onConfirm: () => void;
};

// Pre-gesture snapshot for a continuous edit. Each gesture owns its
// own controller so overlapping gestures don't trample each other.
type GraphSnapshot = { nodes: VertexNode[]; edges: GraphEdge[] };

// One editor tab. The ACTIVE tab's graph lives in the root `nodes`/`edges`
// (every action reads/writes those slices); tab records are authoritative
// only for inactive tabs. `switchTab`/`addTab`/`closeTab` are the only
// places data moves between the two, via `activateTab` below.
export type TabRecord = {
  id: string;
  // Tab name; doubles as the persisted v2 document `title`.
  name: string;
  nodes: VertexNode[];
  edges: GraphEdge[];
  createdAt: string;
  // Last committed pan/zoom. `null` until the user moves the camera; the
  // view layer fits the tab's content instead.
  viewport: Viewport | null;
  // Session-only undo tree, swapped into the zundo store on tab switch.
  history: {
    pastStates: GraphSnapshot[];
    futureStates: GraphSnapshot[];
  };
};

type GraphStore = {
  title: string;

  // Stamped once at document creation/import; preserved across saves.
  createdAt: string;
  nodes: VertexNode[];
  edges: GraphEdge[];
  mode: EditorMode;
  hasHydrated: boolean;
  // Tab records for every tab (active tab's graph also mirrored in the root
  // `nodes`/`edges`/`title`/`createdAt` slices; see `TabRecord`).
  tabs: TabRecord[];
  activeTabId: string;
  // Vertex IDs staged as edge sources in add-edge mode (empty otherwise);
  // edges fan out from every ID here to the next clicked target.
  pendingEdgeSources: string[];
  selectedVertexType: VertexType;
  // Edge kind staged for add-edge mode (like `selectedVertexType` for
  // vertices). New edges created by `handleVertexClick` carry this kind.
  selectedEdgeKind: EdgeKind;

  // Destructive-action confirmation dialog (`null` when closed).
  confirmDialogue: ConfirmDialogueState | null;

  // Help dialog. Kept in the store so the `?` keybinding and toolbar
  // button share one source of truth.
  isHelpOpen: boolean;

  // First-run intro. Auto-opened by `hydrate()` when the
  // `graph-board-seen-intro` flag is absent; the flag is stamped at open
  // time so the intro never reappears on reload.
  isIntroOpen: boolean;

  // Export-format chooser dialog. Opened by the toolbar Export button.
  isExportOpen: boolean;

  // Graph-properties dialog. Opened by the toolbar smile button.
  isPropertiesOpen: boolean;

  // Per-vertex validation errors from the last compute. Keyed by vertex
  // id so a node's renderer selects only its own slice. Ephemeral — not
  // persisted, not on the undo stack (`partialize` snapshots only
  // `{nodes, edges}`). Cleared/replaced on every compute.
  validationErrors: Record<string, ValidationError[]>;
  setValidationErrors: (errors: ValidationError[]) => void;
  clearValidationErrors: () => void;

  // Session-scoped clipboard; not persisted.
  clipboard: {
    nodes: VertexNode[];
    edges: GraphEdge[];
    // Increments per paste; each adds `PASTE_OFFSET_STEP * pasteCount`
    // so duplicates don't overlap exactly.
    pasteCount: number;
  } | null;

  hydrate: () => void;
  setMode: (mode: EditorMode) => void;
  setVertexType: (vertexType: VertexType) => void;
  setEdgeKind: (kind: EdgeKind) => void;

  addTab: () => void;
  switchTab: (tabId: string) => void;
  // Step to the neighbouring tab (wrapped at the ends); `-1` = previous.
  switchAdjacentTab: (direction: -1 | 1) => void;
  renameTab: (tabId: string, name: string) => void;
  // Closes after a confirm dialog when the tab is non-empty; never closes
  // the last tab (it is replaced with a fresh empty one).
  closeTab: (tabId: string) => void;
  // Record the active tab's camera (pan/zoom) on every move end.
  commitViewport: (viewport: Viewport) => void;

  onNodesChange: (changes: NodeChange<VertexNode>[]) => void;
  onEdgesChange: (changes: EdgeChange<GraphEdge>[]) => void;

  addVertexAt: (position: { x: number; y: number }) => void;
  handleVertexClick: (
    vertexId: string,
    modifiers: VertexClickModifiers,
  ) => void;
  clearPendingEdgeSources: () => void;
  addSelectedToPendingSources: () => void;
  updateVertexPhase: (nodeId: string, phase: string) => void;
  updateVertexVisualLabel: (nodeId: string, label: string) => void;
  updateVertexLabelLocation: (
    nodeId: string,
    labelLocation: LabelLocation,
  ) => void;
  updateVertexType: (nodeId: string, vertexType: VertexType) => void;
  updateVertexOrder: (nodeId: string, targetOrder: number) => void;
  updateVertexRotation: (nodeId: string, rotation: number) => void;
  // Edge kind switch (e.g. default → dashed-blue). Structural: goes on the
  // undo stack like a vertex type change.
  updateEdgeKind: (edgeId: string, kind: EdgeKind) => void;
  copySelected: () => void;
  paste: () => void;
  cutSelected: () => void;
  deleteSelected: () => void;
  selectAll: () => void;
  clearSelection: () => void;
  save: () => void;
  exportJson: () => Promise<void>;
  exportGraph: (formatId: ExportFormatId) => Promise<void>;
  importJson: (insertCenter?: { x: number; y: number }) => Promise<void>;
  reset: () => void;

  openConfirmDialogue: (params: {
    title: string;
    message: string;
    onConfirm: () => void;
    confirmText?: string;
    cancelText?: string;
    confirmButtonClassName?: string;
  }) => void;
  closeConfirmDialogue: () => void;

  openHelp: () => void;
  closeHelp: () => void;
  toggleHelp: () => void;

  openIntro: () => void;
  closeIntro: () => void;

  openExport: () => void;
  closeExport: () => void;

  openProperties: () => void;
  closeProperties: () => void;

  isStateEmpty: () => boolean;

  onNodeDragStart: () => void;
  onNodeDragStop: () => void;

  // Property-panel continuous edit (e.g. rotation slider). Mirrors
  // onNodeDragStart/Stop: pause the undo stack during the gesture, then
  // inject one pre-gesture snapshot so undo restores to before the edit.
  onVertexPropertyEditStart: () => void;
  onVertexPropertyEditEnd: () => void;


  // DEBUG: for debugs
  onDebugButtonPressed: () => void;
};

function partialize(state: GraphStore) {
  const { nodes, edges } = state;
  return { nodes, edges };
}

// zundo history cap; enforced both by the temporal middleware and by the
// gesture controllers' raw `pastStates` pushes (see makeGestureController).
const UNDO_LIMIT = 50;

// Reference equality on the partialized slices. Shared by the temporal
// middleware options and the gesture controllers so gesture snapshots get
// the same no-change skip as tracked sets.
const temporalEquality = (a: GraphSnapshot, b: GraphSnapshot) =>
  a.nodes === b.nodes && a.edges === b.edges;

// True iff `next` carries the same elements in the same order as `current`
// (object identity). `applyNodeChanges`/`applyEdgeChanges` return a fresh
// array even when nothing matched, so without this check a no-op batch —
// e.g. React Flow's stale `remove` changes for the PREVIOUS tab's ids right
// after a tab switch — would still `set` a new slice and land a spurious
// entry on the incoming tab's undo stack.
function isSameSlice<T>(next: T[], current: T[]): boolean {
  if (next === current) return true;
  if (next.length !== current.length) return false;
  return next.every((item, index) => item === current[index]);
}

// Split React Flow changes into structural (`remove`) and visual
// (everything else: dimension, position, select), applied with the
// right undo policy. Structural changes get normal undo tracking
// (undo should reverse a delete); visual changes are applied with
// tracking paused so drag ticks and selection toggles don't land on
// the undo stack.
//
// Shared by `onNodesChange` / `onEdgesChange`. Structural applies
// first so the visual apply sees the post-deletion slice — otherwise
// a batch with both `select` and `remove` would drop one update.
function applyReactiveFlowChanges<T, C extends { type: string }>(params: {
  changes: C[];
  getCurrent: () => T[];
  apply: (changes: C[], current: T[]) => T[];
  setSlice: (next: T[]) => void;
}) {
  const structuralChanges = params.changes.filter(
    (c) => c.type === "remove",
  );
  const visualChanges = params.changes.filter(
    (c) => c.type !== "remove",
  );

  if (structuralChanges.length > 0) {
    const next = params.apply(structuralChanges, params.getCurrent());
    if (!isSameSlice(next, params.getCurrent())) params.setSlice(next);
  }

  if (visualChanges.length > 0) {
    // Resume only if WE paused an active store; an in-flight gesture's
    // pause must survive the tick (else mid-gesture changes get recorded).
    const wasTracking = useGraphStore.temporal.getState().isTracking;
    useGraphStore.temporal.getState().pause();
    try {
      const next = params.apply(visualChanges, params.getCurrent());
      if (!isSameSlice(next, params.getCurrent())) params.setSlice(next);
    } finally {
      if (wasTracking) useGraphStore.temporal.getState().resume();
    }
  }
}

// Pause/resume bookkeeping for one continuous-edit gesture. While
// active the temporal store is paused (intermediate commits create no
// undo entry); on end the pre-gesture snapshot is pushed to
// `pastStates` so undo restores to before the gesture (skipped when the
// gesture changed nothing, per `temporalEquality`).
function makeGestureController() {
  let snapshot: GraphSnapshot | null = null;

  return {
    begin: (capture: GraphSnapshot) => {
      snapshot = capture;
      useGraphStore.temporal.getState().pause();
    },
    end: () => {
      const temporalState = useGraphStore.temporal.getState();
      temporalState.resume();
      if (snapshot && !temporalEquality(snapshot, partialize(useGraphStore.getState()))) {
        const pastStates = [...temporalState.pastStates];
        // Raw setState bypasses zundo's own limit enforcement (it only
        // shifts inside _handleSet) — mirror it here.
        if (pastStates.length >= UNDO_LIMIT) pastStates.shift();
        pastStates.push(snapshot);
        useGraphStore.temporal.setState({
          pastStates,
          futureStates: [],
        });
      }
      snapshot = null;
    },
  };
}

const dragGesture = makeGestureController();
const vertexPropertyEditGesture = makeGestureController();

// Untrusted vertex ids (from imports) are used as validation-error keys; a
// null-prototype object keeps prototype keys ("__proto__", "constructor")
// from resolving to inherited members anywhere the map is read.
function emptyValidationErrors(): Record<string, ValidationError[]> {
  return Object.create(null);
}

// Drop validation-error buckets whose vertex no longer exists (delete/cut).
function pruneValidationErrors(
  errors: Record<string, ValidationError[]>,
  remainingIds: Set<string>,
): Record<string, ValidationError[]> {
  const pruned = emptyValidationErrors();
  for (const id of Object.keys(errors)) {
    if (remainingIds.has(id)) pruned[id] = errors[id]!;
  }
  return pruned;
}

// ---- Tab machinery ----------------------------------------------------------

// Fresh empty tab. `name` defaults to the next "Tab N" slot so the first
// tab is "Tab 1" and closed slots don't collide.
export function makeEmptyTabRecord(
  name: string,
  viewport: Viewport | null,
): TabRecord {
  return {
    id: nanoid(),
    name,
    nodes: [],
    edges: [],
    createdAt: new Date().toISOString(),
    viewport,
    history: { pastStates: [], futureStates: [] },
  };
}

function nextTabName(tabs: TabRecord[]): string {
  let max = 0;
  for (const tab of tabs) {
    const match = /^Tab (\d+)$/.exec(tab.name);
    if (match) max = Math.max(max, Number.parseInt(match[1], 10));
  }
  return `Tab ${max + 1}`;
}

// Commit the active tab's live slices back into its record, then install
// `nextTabId` as the active tab: root slices, name, and — the load-bearing
// part — the zundo undo tree. The temporal store is paused for the swap so
// the switch itself never becomes an undo entry in the INCOMING tab (without
// the pause, tab A's graph would land in tab B's history and the first undo
// in B would resurrect A's nodes).
function activateTab(nextTabId: string, nextTabs: TabRecord[]): void {
  const nextTab = nextTabs.find((tab) => tab.id === nextTabId);
  if (!nextTab) return;

  const temporalState = useGraphStore.temporal.getState();
  const wasTracking = temporalState.isTracking;
  temporalState.pause();
  const state = useGraphStore.getState();

  // Stash the outgoing tab's live graph + undo tree into its record. The
  // stashed stacks are exactly the partialized `{nodes, edges}` snapshots,
  // so the narrower type is safe (see `partialize`).
  const committed = nextTabs.map((tab) =>
    tab.id === state.activeTabId
      ? {
        ...tab,
        nodes: state.nodes,
        edges: state.edges,
        history: {
          pastStates: temporalState.pastStates as GraphSnapshot[],
          futureStates: temporalState.futureStates as GraphSnapshot[],
        },
      }
      : tab,
  );

  useGraphStore.setState({
    tabs: committed,
    activeTabId: nextTabId,
    nodes: nextTab.nodes,
    edges: nextTab.edges,
    title: nextTab.name,
    createdAt: nextTab.createdAt,
    // Transient work-in-progress must not leak into another tab.
    mode: EDITOR_MODES.select,
    pendingEdgeSources: [],
    validationErrors: emptyValidationErrors(),
  });

  // Install the incoming tab's undo tree.
  useGraphStore.temporal.setState({
    pastStates: nextTab.history.pastStates,
    futureStates: nextTab.history.futureStates,
  });

  if (wasTracking) temporalState.resume();
}

// Remove `tabId` from the workspace. Closing a non-active tab is a plain
// tabs-array change (not partialized, so no undo entry); closing the active
// tab activates a neighbour first so the root slices always match an
// existing tab. Never leaves zero tabs.
function performCloseTab(tabId: string): void {
  const state = useGraphStore.getState();
  const index = state.tabs.findIndex((tab) => tab.id === tabId);
  if (index === -1) return;

  if (tabId !== state.activeTabId) {
    useGraphStore.setState({
      tabs: state.tabs.filter((tab) => tab.id !== tabId),
    });
    return;
  }

  let nextTabs = state.tabs.filter((tab) => tab.id !== tabId);
  let nextActiveId: string;

  if (nextTabs.length === 0) {
    // Closing the last tab replaces it with a fresh empty one.
    const fresh = makeEmptyTabRecord(
      "Tab 1",
      state.tabs[index]?.viewport ?? null,
    );
    nextTabs = [fresh];
    nextActiveId = fresh.id;
  } else {
    // Prefer the left neighbour, else the new first tab.
    nextActiveId = nextTabs[Math.max(0, index - 1)]?.id ?? nextTabs[0].id;
  }

  activateTab(nextActiveId, nextTabs);
}

export const useGraphStore = create<GraphStore>()(
  temporal(
    (set, get) => ({
      title: "Untitled Graph",
      // Placeholder until `hydrate` replaces it with the persisted value.
      createdAt: new Date().toISOString(),
      nodes: [],
      edges: [],
      mode: EDITOR_MODES.select,
      hasHydrated: false,

      // Empty until `hydrate` builds the persisted tabs.
      tabs: [],
      activeTabId: "",

      pendingEdgeSources: [],
      selectedVertexType: DEFAULT_VERTEX_TYPE,
      selectedEdgeKind: DEFAULT_EDGE_KIND,

      confirmDialogue: null,

      isHelpOpen: false,

      isIntroOpen: false,

      isExportOpen: false,

      isPropertiesOpen: false,

      validationErrors: emptyValidationErrors(),

      clipboard: null,

      hydrate: () => {
        // Hydrate the persisted workspace (a `layout: "tabs"` wrapper of v2
        // `{ graph, view }` docs, or a legacy single doc) into per-tab
        // runtime records; the persisted shape never reaches the store.
        const workspace = loadGraphWorkspace();
        let hydratedTabs: TabRecord[];
        try {
          hydratedTabs = workspace.tabs.map((entry) => {
            const hydrated = hydrateDocument(entry.document);
            return {
              id: entry.id,
              name: hydrated.title,
              nodes: hydrated.nodes,
              edges: hydrated.edges,
              createdAt: hydrated.createdAt,
              viewport: null,
              history: { pastStates: [], futureStates: [] },
            };
          });
        } catch {
          // A localStorage doc can pass the shape check yet hold malformed
          // elements (e.g. `data: null`); fail soft instead of crashing.
          // Back the raw workspace up first so a regression (rather than
          // real corruption) can't silently destroy the user's only copy
          // once the empty fallback is autosaved.
          console.warn(
            "graph-board: persisted document failed hydration; loading empty document.",
          );
          try {
            const raw = localStorage.getItem("graph-board-document");
            if (raw !== null) {
              localStorage.setItem(LOCAL_STORAGE_BACKUP_KEY, raw);
            }
          } catch {
            // Quota / availability issues must not block recovery.
          }
          hydratedTabs = [makeEmptyTabRecord("Untitled Graph", null)];
        }

        const activeTabId = hydratedTabs.some(
          (tab) => tab.id === workspace.activeTabId,
        )
          ? workspace.activeTabId
          : hydratedTabs[0].id;
        const activeTab = hydratedTabs.find(
          (tab) => tab.id === activeTabId,
        )!;

        set({
          tabs: hydratedTabs,
          activeTabId,
          title: activeTab.name,
          createdAt: activeTab.createdAt,
          nodes: activeTab.nodes,
          edges: activeTab.edges,
          hasHydrated: true,
          validationErrors: emptyValidationErrors(),
        });

        useGraphStore.temporal.getState().clear();

        // Auto-open the intro once: stamp the flag now (at open, not at
        // close) so it never reappears on reload. See `intro.ts`.
        if (shouldShowIntro()) {
          markIntroSeen();
          set({ isIntroOpen: true });
        }
      },

      setMode: (mode) => {
        // Selection is preserved across mode switches so a user can
        // pre-select vertices and have them auto-promote to pending
        // sources when entering add-edge mode.
        if (mode === EDITOR_MODES.addEdge) {
          // Auto-promote selected vertices into the pending source list,
          // merging with any already pending (toggling off/back on keeps
          // work-in-progress).
          const selectedIds = selectSelectedNodeIds(get().nodes);

          const merged = Array.from(
            new Set([...get().pendingEdgeSources, ...selectedIds]),
          );

          set({ mode, pendingEdgeSources: merged });
        } else {
          // Pending sources only make sense in add-edge mode.
          set({ mode, pendingEdgeSources: [] });
        }
      },

      setVertexType: (vertexType) => {
        set({ selectedVertexType: vertexType });
      },

      setEdgeKind: (kind) => {
        set({ selectedEdgeKind: kind });
      },

      addTab: () => {
        const state = get();
        const active = state.tabs.find((tab) => tab.id === state.activeTabId);
        const tab = makeEmptyTabRecord(
          nextTabName(state.tabs),
          // Start where the user is looking; `null` (never moved) stays null
          // so the view layer fits the first content instead.
          active?.viewport ?? null,
        );
        activateTab(tab.id, [...state.tabs, tab]);
      },

      switchTab: (tabId) => {
        const state = get();
        if (tabId === state.activeTabId) return;
        if (!state.tabs.some((tab) => tab.id === tabId)) return;
        activateTab(tabId, state.tabs);
      },

      switchAdjacentTab: (direction) => {
        const { tabs, activeTabId } = get();
        const index = tabs.findIndex((tab) => tab.id === activeTabId);
        const next = tabs[index + direction];
        if (next) get().switchTab(next.id);
      },

      renameTab: (tabId, name) => {
        const trimmed = name.trim();
        if (trimmed.length === 0) return;

        const { tabs, activeTabId } = get();
        set({
          tabs: tabs.map((tab) =>
            tab.id === tabId ? { ...tab, name: trimmed } : tab,
          ),
          // Root `title` mirrors the active tab's name.
          ...(tabId === activeTabId ? { title: trimmed } : {}),
        });
      },

      closeTab: (tabId) => {
        const state = get();
        const tab = state.tabs.find((entry) => entry.id === tabId);
        if (!tab) return;

        // Emptiness for the ACTIVE tab reads the live slices (its record is
        // only synced on switch/save); inactive tabs read their record.
        const isEmpty =
          tabId === state.activeTabId
            ? state.nodes.length === 0 && state.edges.length === 0
            : tab.nodes.length === 0 && tab.edges.length === 0;

        // Empty tabs close silently; a non-empty tab needs a confirm (its
        // undo tree dies with the tab, so the dialog is the safety net).
        if (isEmpty) {
          performCloseTab(tabId);
          return;
        }

        get().openConfirmDialogue({
          title: `Close tab "${tab.name}"?`,
          message:
            "This tab's graph will be deleted. This action cannot be undone.",
          confirmText: "Close tab",
          cancelText: "Cancel",
          confirmButtonClassName: "bg-red-600 hover:bg-red-700",
          onConfirm: () => {
            get().closeConfirmDialogue();
            performCloseTab(tabId);
          },
        });
      },

      commitViewport: (viewport) => {
        const { tabs, activeTabId } = get();
        if (!activeTabId) return;
        set({
          tabs: tabs.map((tab) =>
            tab.id === activeTabId
              ? {
                ...tab,
                viewport: {
                  x: viewport.x,
                  y: viewport.y,
                  zoom: viewport.zoom,
                },
              }
              : tab,
          ),
        });
      },

      onNodesChange: (changes) => {
        // Snap incoming position changes to the grid before applying. This is
        // the chokepoint for both drag ticks and programmatic moves; it stays
        // undo-safe because drag ticks are excluded from the temporal stack
        // (see applyReactiveFlowChanges) and React Flow recomputes position
        // from the cursor each tick, so there's no feedback jitter.
        const snapped = changes.map((c) =>
          c.type === "position" && c.position
            ? { ...c, position: snapPosition(c.position) }
            : c,
        );
        applyReactiveFlowChanges({
          changes: snapped,
          getCurrent: () => get().nodes,
          apply: applyNodeChanges,
          setSlice: (nodes) => set({ nodes }),
        });
      },

      onEdgesChange: (changes) => {
        applyReactiveFlowChanges({
          changes,
          getCurrent: () => get().edges,
          apply: applyEdgeChanges,
          setSlice: (edges) => set({ edges }),
        });
      },

      addVertexAt: (position) => {
        const vertexType = get().selectedVertexType;
        const node = createVertexNode(snapPosition(position), vertexType);

        // Boundary vertices get an auto-assigned `order` at the end of
        // their group (inputs/outputs ordered independently); others
        // ignore the field.
        if (isBoundaryVertex(vertexType)) {
          node.data.order = nextBoundaryOrder(get().nodes, vertexType);
        }

        set({
          nodes: [...get().nodes, node],
        });
      },

      handleVertexClick: (vertexId, modifiers) => {
        // Only meaningful in add-edge mode; outside it, React Flow owns
        // the click for selection.
        const state = get();
        if (state.mode !== EDITOR_MODES.addEdge) return;

        // Dispatch lives in `computeVertexClick` (operations.ts); returns
        // a partial patch or null for no-op clicks.
        const patch = computeVertexClick({
          vertexId,
          modifiers,
          pendingEdgeSources: state.pendingEdgeSources,
          nodes: state.nodes,
          edges: state.edges,
          // New edges in add-edge mode take the kind staged in the
          // EdgeKindMenu (default unless the user picked another).
          edgeKind: state.selectedEdgeKind,
        });

        if (patch) set(patch);
      },

      clearPendingEdgeSources: () => {
        set({ pendingEdgeSources: [] });
      },

      // Box-select end in add-edge mode: merge selected vertices into the
      // pending source list, deduped.
      addSelectedToPendingSources: () => {
        const selectedIds = selectSelectedNodeIds(get().nodes);

        if (selectedIds.length === 0) return;

        const merged = Array.from(
          new Set([...get().pendingEdgeSources, ...selectedIds]),
        );

        set({ pendingEdgeSources: merged });
      },

      deleteSelected: () => {
        const next = deleteSelectedElements({
          nodes: get().nodes,
          edges: get().edges,
        });

        // Deleted vertices must leave the pending source list: otherwise the
        // next add-edge click would create edges from nonexistent sources.
        const remainingIds = new Set(next.nodes.map((n) => n.id));
        const pendingEdgeSources = get().pendingEdgeSources.filter((id) =>
          remainingIds.has(id),
        );

        set({
          ...next,
          pendingEdgeSources,
          validationErrors: pruneValidationErrors(
            get().validationErrors,
            remainingIds,
          ),
        });
      },

      selectAll: () => {
        set(
          selectAllElements({
            nodes: get().nodes,
            edges: get().edges,
          }),
        );
      },

      clearSelection: () => {
        set(
          clearAllSelections({
            nodes: get().nodes,
            edges: get().edges,
          }),
        );
      },

      copySelected: () => {
        const subgraph = getSelectedSubgraph({
          nodes: get().nodes,
          edges: get().edges,
        });

        if (subgraph.nodes.length === 0) return;

        set({
          clipboard: {
            ...cloneSubgraphForClipboard(subgraph),
            pasteCount: 0,
          },
        });
      },

      paste: () => {
        const clipboard = get().clipboard;

        if (!clipboard || clipboard.nodes.length === 0) return;

        const pasted = pasteSubgraph({
          subgraph: clipboard,
          pasteCount: clipboard.pasteCount + 1,
          // Pass the live graph so pasted boundary nodes get fresh,
          // non-colliding `order` values.
          existingNodes: get().nodes,
        });

        set({
          nodes: [
            ...get().nodes.map((node) => ({ ...node, selected: false })),
            ...pasted.nodes,
          ],
          edges: [
            ...get().edges.map((edge) => ({ ...edge, selected: false })),
            ...pasted.edges,
          ],
          clipboard: {
            ...clipboard,
            pasteCount: clipboard.pasteCount + 1,
          },
        });
      },

      cutSelected: () => {
        const subgraph = getSelectedSubgraph({
          nodes: get().nodes,
          edges: get().edges,
        });

        if (subgraph.nodes.length === 0) return;

        // Cut = copy to clipboard + delete the original selection.
        const remaining = deleteSelectedElements({
          nodes: get().nodes,
          edges: get().edges,
        });

        // Same pending-source cleanup as `deleteSelected`.
        const remainingIds = new Set(remaining.nodes.map((n) => n.id));
        const pendingEdgeSources = get().pendingEdgeSources.filter((id) =>
          remainingIds.has(id),
        );

        set({
          ...remaining,
          pendingEdgeSources,
          validationErrors: pruneValidationErrors(
            get().validationErrors,
            remainingIds,
          ),
          clipboard: {
            ...cloneSubgraphForClipboard(subgraph),
            pasteCount: 0,
          },
        });
      },

      save: () => {
        const state = get();
        // Sync the active tab's live slices into its record, then project
        // every tab to its v2 document. `updatedAt` is stamped per doc in
        // `projectDocument`; each tab's `createdAt` is preserved.
        const tabs = state.tabs.map((tab) =>
          tab.id === state.activeTabId
            ? { ...tab, nodes: state.nodes, edges: state.edges }
            : tab,
        );
        saveGraphWorkspace({
          activeTabId: state.activeTabId,
          tabs: tabs.map((tab) => ({
            id: tab.id,
            document: projectDocument({
              id: tab.id,
              title: tab.name,
              nodes: tab.nodes,
              edges: tab.edges,
              createdAt: tab.createdAt,
              updatedAt: new Date().toISOString(),
            }),
          })),
        });
      },

      exportGraph: async (formatId) => {
        const state = get();
        const format = getExportFormat(formatId);
        const contents = format.serialize({
          title: state.title,
          nodes: state.nodes,
          edges: state.edges,
          createdAt: state.createdAt,
        });
        const filename = toSafeFilename(state.title || "graph-board");

        await saveTextFileWithPicker({
          suggestedName: `${filename}${format.extension}`,
          contents,
          mimeType: format.mimeType,
          extension: format.extension,
        });
      },

      exportJson: async () => {
        await get().exportGraph("json");
      },

      // Import merges the saved graph into the current one: existing
      // nodes/edges are kept, colliding imported ids are re-minted, and the
      // imported graph is placed around `insertCenter` (flow coordinates of
      // the viewport centre) plus a small offset. Never destructive, so no
      // confirmation is needed.
      importJson: async (insertCenter) => {
        const contents = await openTextFileWithPicker({});
        if (contents === null) return;

        const result = importGraphJson(contents);
        if (!result.ok) {
          window.alert(`Failed to import: ${result.error}`);
          return;
        }

        let imported: HydratedDocument;
        try {
          imported = hydrateDocument(result.document);
        } catch {
          window.alert(
            "Failed to import: document contains malformed nodes or edges.",
          );
          return;
        }
        const state = get();

        const offset = {
          x: (insertCenter?.x ?? 0) + IMPORT_OFFSET_STEP,
          y: (insertCenter?.y ?? 0) + IMPORT_OFFSET_STEP,
        };

        const merged = mergeImportedGraph({
          imported,
          existing: {
            // Deselect the live graph first (paste symmetry): only the
            // imported elements end up selected after the merge.
            nodes: state.nodes.map((node) =>
              node.selected ? { ...node, selected: false } : node,
            ),
            edges: state.edges.map((edge) =>
              edge.selected ? { ...edge, selected: false } : edge,
            ),
          },
          offset,
        });

        set({
          nodes: merged.nodes,
          edges: merged.edges,
          mode: EDITOR_MODES.select,
          pendingEdgeSources: [],
        });

        // No explicit persist: the debounced autosave writes the merged
        // graph (and any later undo) — explicit writes here would race undo
        // and leave localStorage ahead of the store.

        // A merge is a normal structural mutation: it stays on the undo
        // stack, so undo removes the imported nodes (unlike reset/hydrate,
        // which replace the document and clear history).
      },

      updateVertexPhase: (nodeId, phase) => {
        set({
          nodes: get().nodes.map((node) =>
            node.id === nodeId
              ? { ...node, data: { ...node.data, phase } }
              : node,
          ),
        });
      },

      // Visual label + location live in the view slice, like `rotation`:
      // purely visual, never sent to the compute layer.
      updateVertexVisualLabel: (nodeId, label) => {
        set({
          nodes: get().nodes.map((node) =>
            node.id === nodeId ? { ...node, label } : node,
          ),
        });
      },

      updateVertexLabelLocation: (nodeId, labelLocation) => {
        set({
          nodes: get().nodes.map((node) =>
            node.id === nodeId ? { ...node, labelLocation } : node,
          ),
        });
      },

      updateVertexType: (nodeId, vertexType) => {
        const current = get().nodes;
        // Assign the next available order in its new group when the
        // target is a boundary type; `assignBoundaryOrderOnTypeChange`
        // returns nodes unchanged for non-boundary targets.
        const nextNodes = isBoundaryVertex(vertexType)
          ? assignBoundaryOrderOnTypeChange({
            nodes: current,
            vertexId: nodeId,
            newType: vertexType,
          })
          : current.map((node) =>
            node.id === nodeId
              ? { ...node, data: { ...node.data, vertexType } }
              : node,
          );
        set({ nodes: nextNodes });
      },

      updateVertexOrder: (nodeId, targetOrder) => {
        // No-op reorder returns the original `nodes` reference, which the
        // zundo equality check treats as unchanged.
        const { nodes } = reorderBoundaryVertex({
          nodes: get().nodes,
          vertexId: nodeId,
          targetOrder,
        });
        set({ nodes });
      },

      updateVertexRotation: (nodeId, rotation) => {
        // Normalize at the store boundary so every caller gets the
        // canonical [0, 360) value.
        const normalized = normalizeRotation(rotation);
        set({
          nodes: get().nodes.map((node) =>
            node.id === nodeId ? { ...node, rotation: normalized } : node,
          ),
        });
      },

      updateEdgeKind: (edgeId, kind) => {
        set({
          edges: get().edges.map((edge) =>
            edge.id === edgeId
              ? { ...edge, data: { ...edge.data, kind } }
              : edge,
          ),
        });
      },

      reset: () => {
        // Reset the CURRENT tab: clear its graph + undo tree, keep its name
        // (a tab's name is its identity, not its content). The shared
        // clipboard survives — it belongs to the workspace, not the tab.
        const state = get();
        const tabs = state.tabs.map((tab) =>
          tab.id === state.activeTabId
            ? {
              ...tab,
              nodes: [],
              edges: [],
              history: { pastStates: [], futureStates: [] },
            }
            : tab,
        );

        set({
          tabs,
          nodes: [],
          edges: [],
          mode: EDITOR_MODES.select,
          confirmDialogue: null,
          isHelpOpen: false,
          isExportOpen: false,
          isPropertiesOpen: false,
          pendingEdgeSources: [],
          validationErrors: emptyValidationErrors(),
        });

        // Persist immediately (not via autosave) so a refresh keeps the
        // cleared tab.
        get().save();
        useGraphStore.temporal.getState().clear();
      },

      openConfirmDialogue: ({
        title,
        message,
        onConfirm,
        confirmText = "Confirm",
        cancelText = "Cancel",
        confirmButtonClassName = "bg-red-600 hover:bg-red-700",
      }) => {
        set({
          confirmDialogue: {
            title,
            message,
            confirmText,
            cancelText,
            confirmButtonClassName,
            onConfirm,
          },
        });
      },

      closeConfirmDialogue: () => {
        set({ confirmDialogue: null });
      },

      openHelp: () => {
        set({ isHelpOpen: true });
      },

      closeHelp: () => {
        set({ isHelpOpen: false });
      },

      toggleHelp: () => {
        set({ isHelpOpen: !get().isHelpOpen });
      },

      openIntro: () => {
        set({ isIntroOpen: true });
      },

      closeIntro: () => {
        set({ isIntroOpen: false });
      },

      openExport: () => {
        set({ isExportOpen: true });
      },

      closeExport: () => {
        set({ isExportOpen: false });
      },

      openProperties: () => {
        set({ isPropertiesOpen: true });
      },

      closeProperties: () => {
        set({ isPropertiesOpen: false });
      },

      // Group the flat error list by vertex id into a Record. Errors
      // without a `vertexId` (none today, but defended) are dropped —
      // they can't be attributed to a rendered node. An empty-string id
      // is dropped too: a node id is never `""`, so a "" bucket would
      // linger in the map with no renderer to consume it.
      setValidationErrors: (errors) => {
        // Null-prototype so an untrusted vertex id (e.g. "__proto__" or
        // "constructor" from an imported file) creates a real bucket instead
        // of resolving to an inherited Object.prototype member (which made
        // `??=` skip the assignment and `.push` throw).
        const grouped = emptyValidationErrors();
        for (const e of errors) {
          if (!e.vertexId) continue;
          (grouped[e.vertexId] ??= []).push(e);
        }
        set({ validationErrors: grouped });
      },

      clearValidationErrors: () => {
        set({ validationErrors: emptyValidationErrors() });
      },

      // True iff the graph has no nodes.
      isStateEmpty: () => {
        return get().nodes.length === 0;
      },

      onNodeDragStart: () => {
        // Snapshot pre-drag state, then pause tracking so intermediate
        // positions aren't recorded.
        dragGesture.begin(partialize(get()));
      },

      onNodeDragStop: () => {
        // Resume and push the pre-drag snapshot so undo restores
        // positions to before the drag.
        dragGesture.end();
      },

      onVertexPropertyEditStart: () => {
        // Same as onNodeDragStart for property-panel continuous edits.
        vertexPropertyEditGesture.begin(partialize(get()));
      },

      onVertexPropertyEditEnd: () => {
        vertexPropertyEditGesture.end();
      },

      onDebugButtonPressed: () => { console.log("For Debug!") }
    }),
    {
      partialize,
      // Compare slices by reference: zustand's `set` always makes a new
      // state object, so the default `Object.is` would push a pastState
      // on every set — even UI-only actions (`setMode`,
      // `openConfirmDialogue`) and no-op helper paths. Reference
      // equality reserves the undo stack for real graph-structure
      // changes; visual changes (drag, select) still bypass it via the
      // gesture controllers in `applyReactiveFlowChanges`.
      equality: temporalEquality,
      limit: UNDO_LIMIT,
    },
  ),
);
