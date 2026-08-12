"use client";

import {
  applyEdgeChanges,
  applyNodeChanges,
  type EdgeChange,
  type NodeChange,
} from "@xyflow/react";
import { create } from "zustand";
import { temporal } from "zundo";
import {
  DEFAULT_EDGE_KIND,
  EDITOR_MODES,
  PERSISTED_IDS,
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
  createEmptyGraphDocument,
  getExportFormat,
  hydrateDocument,
  importGraphJson,
  type HydratedDocument,
  loadGraphDocument,
  LOCAL_STORAGE_BACKUP_KEY,
  normalizeRotation,
  saveGraphDocument,
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

type GraphStore = {
  title: string;

  // Stamped once at document creation/import; preserved across saves.
  createdAt: string;
  nodes: VertexNode[];
  edges: GraphEdge[];
  mode: EditorMode;
  hasHydrated: boolean;
  // Bumped after an import so the view layer calls `reactFlow.fitView()`;
  // the store never touches React Flow itself.
  fitViewNonce: number;
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

// Pre-gesture snapshot for a continuous edit. Each gesture owns its
// own controller so overlapping gestures don't trample each other.
type GraphSnapshot = { nodes: VertexNode[]; edges: GraphEdge[] };

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
    params.setSlice(params.apply(structuralChanges, params.getCurrent()));
  }

  if (visualChanges.length > 0) {
    useGraphStore.temporal.getState().pause();
    params.setSlice(params.apply(visualChanges, params.getCurrent()));
    useGraphStore.temporal.getState().resume();
  }
}

// Pause/resume bookkeeping for one continuous-edit gesture. While
// active the temporal store is paused (intermediate commits create no
// undo entry); on end the pre-gesture snapshot is pushed to
// `pastStates` so undo restores to before the gesture.
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
      if (snapshot) {
        useGraphStore.temporal.setState({
          pastStates: [...temporalState.pastStates, snapshot],
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

// Recovery copy written before the hydrate fallback replaces a possibly-
// valid document; lets a regression (vs. real corruption) be recovered.
// Key lives in storage.ts so the parse-fail backup path shares it.

// Save the graph to localStorage under the stable local-doc id. Shared
// by `save` and `reset` so the field list lives in one place.
function persistLocal(doc: {
  title: string;
  nodes: VertexNode[];
  edges: GraphEdge[];
  createdAt: string;
}): void {
  saveGraphDocument({
    id: PERSISTED_IDS.localDocument,
    title: doc.title,
    nodes: doc.nodes,
    edges: doc.edges,
    createdAt: doc.createdAt,
  });
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

      fitViewNonce: 0,

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
        // Hydrate the persisted doc (v2 `{ graph, view }` shape) into
        // runtime `VertexNode[]` / `GraphEdge[]`; the persisted shape
        // never reaches the store.
        const document = loadGraphDocument();
        let hydrated: HydratedDocument;
        try {
          hydrated = hydrateDocument(document);
        } catch {
          // A localStorage doc can pass the shape check yet hold malformed
          // elements (e.g. `data: null`); fail soft instead of crashing.
          // Back the parsed doc up first so a regression (rather than real
          // corruption) can't silently destroy the user's only copy once
          // the empty fallback is autosaved.
          console.warn(
            "graph-board: persisted document failed hydration; loading empty document.",
          );
          try {
            localStorage.setItem(
              LOCAL_STORAGE_BACKUP_KEY,
              JSON.stringify(document),
            );
          } catch {
            // Quota / availability issues must not block recovery.
          }
          hydrated = hydrateDocument(createEmptyGraphDocument());
        }

        set({
          title: hydrated.title,
          createdAt: hydrated.createdAt,
          nodes: hydrated.nodes,
          edges: hydrated.edges,
          hasHydrated: true,
          validationErrors: emptyValidationErrors(),
        });

        useGraphStore.temporal.getState().clear();

        // Frame on reload only when there's something to frame.
        if (hydrated.nodes.length > 0) {
          set({ fitViewNonce: get().fitViewNonce + 1 });
        }

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

        set({ ...next, pendingEdgeSources });
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
          clipboard: {
            ...cloneSubgraphForClipboard(subgraph),
            pasteCount: 0,
          },
        });
      },

      save: () => {
        const state = get();
        // `updatedAt` is stamped in `saveGraphDocument`; `createdAt` is
        // preserved from the store.
        persistLocal(state);
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
          existing: { nodes: state.nodes, edges: state.edges },
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
        // Hydrate an empty v2 doc to runtime shape (the persisted records
        // are not runtime React Flow objects).
        const document = createEmptyGraphDocument();
        const hydrated = hydrateDocument(document);

        set({
          title: hydrated.title,
          createdAt: hydrated.createdAt,
          nodes: hydrated.nodes,
          edges: hydrated.edges,
          mode: EDITOR_MODES.select,
          confirmDialogue: null,
          isHelpOpen: false,
          isExportOpen: false,
          isPropertiesOpen: false,
          clipboard: null,
          pendingEdgeSources: [],
          validationErrors: emptyValidationErrors(),
        });

        persistLocal(hydrated);
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
      equality: (a, b) => a.nodes === b.nodes && a.edges === b.edges,
      limit: 50,
    },
  ),
);
