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
  PERSISTED_IDS,
  type EditorMode,
  type GraphEdge,
  type VertexNode,
  type VertexType,
} from "@/lib/graph/types";
import {
  computeVertexClick,
  createVertexNode,
  deleteSelectedElements,
  cloneSubgraphForClipboard,
  clearAllSelections,
  getSelectedSubgraph,
  pasteSubgraph,
  selectAllElements,
  type VertexClickModifiers,
} from "@/lib/graph/operations";
import { DEFAULT_VERTEX_TYPE } from "@/lib/graph/vertex-types";
import { selectSelectedNodeIds } from "@/store/selectors";
import {
  createEmptyGraphDocument,
  hydrateDocument,
  loadGraphDocument,
  saveGraphDocument,
  exportGraphJson,
  importGraphJson,
} from "@/lib/graph/serialization";

import { openTextFileWithPicker, saveTextFileWithPicker } from "@/lib/download";

import { toSafeFilename } from "@/lib/filename";

// One shape for the destructive-action confirmation dialog. `null`
// means "no dialog open"; consumers should `confirmDialogue?.onConfirm`
// rather than reading the action off the store directly.
export type ConfirmDialogueState = {
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
  buttonClassName: string;
  onConfirm: () => void;
};

type GraphStore = {
  title: string;

  // `createdAt`, for autosave is stamped once
  // when the document is first created (or imported)
  createdAt: string;
  nodes: VertexNode[];
  edges: GraphEdge[];
  mode: EditorMode;
  hasHydrated: boolean;
  // Monotonic counter bumped whenever an import finishes. Purely a
  // signal for the view layer to call `reactFlow.fitView()` after a
  // fresh graph lands — the store itself never touches React Flow.
  fitViewNonce: number;
  // Vertex IDs staged as edge sources while in add-edge mode. Empty outside
  // of add-edge mode. Edges are fanned out from every ID in this list to the
  // next clicked target.
  pendingEdgeSources: string[];
  selectedVertexType: VertexType;

  // Destructive-action confirmation dialog. `null` when no dialog is
  // open; the dialog component renders nothing when it receives a
  // null/undefined `state` prop. See `ConfirmDialogueState` above.
  confirmDialogue: ConfirmDialogueState | null;

  // Keyboard-shortcuts help dialog. Pure UI — no pending action — but kept
  // in the store so the global `?` keybinding and the toolbar button share
  // a single source of truth.
  isHelpOpen: boolean;

  // Session-scoped clipboard. Not persisted — paste should not survive a reload.
  clipboard: {
    nodes: VertexNode[];
    edges: GraphEdge[];
    // How many times the current clipboard has been pasted; each paste adds
    // `PASTE_OFFSET_STEP * pasteCount` so duplicates don't overlap exactly.
    pasteCount: number;
  } | null;

  hydrate: () => void;
  setMode: (mode: EditorMode) => void;
  setVertexType: (vertexType: VertexType) => void;

  onNodesChange: (changes: NodeChange<VertexNode>[]) => void;
  onEdgesChange: (changes: EdgeChange<GraphEdge>[]) => void;

  addVertexAt: (position: { x: number; y: number }) => void;
  handleVertexClick: (
    vertexId: string,
    modifiers: VertexClickModifiers,
  ) => void;
  clearPendingEdgeSources: () => void;
  addSelectedToPendingSources: () => void;
  updateVertexLabel: (nodeId: string, label: string) => void;
  updateVertexType: (nodeId: string, vertexType: VertexType) => void;
  updateVertexRotation: (nodeId: string, rotation: number) => void;
  copySelected: () => void;
  paste: () => void;
  cutSelected: () => void;
  deleteSelected: () => void;
  selectAll: () => void;
  clearSelection: () => void;
  save: () => void;
  exportJson: () => Promise<void>;
  importJson: () => Promise<void>;
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


  isStateEmpty: () => boolean;

  onNodeDragStart: () => void;
  onNodeDragStop: () => void;

  // Bounding box for any continuous "live preview" edit in the property
  // panel (e.g. dragging the rotation slider). The pattern mirrors
  // onNodeDragStart/Stop: pause the undo stack during the gesture, then
  // inject a single pre-gesture snapshot so undo restores to before the
  // edit, not to some intermediate drag step. Generic on purpose — a
  // future color picker or scale slider can reuse it.
  onVertexPropertyEditStart: () => void;
  onVertexPropertyEditEnd: () => void;
};

function partialize(state: GraphStore) {
  const { nodes, edges } = state;
  return { nodes, edges };
}

// Module-level stash for in-flight continuous-edit snapshots. Each
// gesture (drag, property-panel slider, future colour picker, …) owns
// its own controller so two overlapping gestures don't trample each
// other's pre-state — see `makeGestureController` below.
type GraphSnapshot = { nodes: VertexNode[]; edges: GraphEdge[] };

// Split a stream of React Flow change events into structural changes
// (only `remove` today — future kinds may join) and visual-only changes
// (everything else: dimension, position, select). Apply each kind with
// the right undo policy:
//   - structural: regular undo tracking; the user expects to be able
//     to undo a delete.
//   - visual: paused undo tracking; the user does not expect every
//     drag tick or select toggle to land on the undo stack.
//
// Shared between `onNodesChange` and `onEdgesChange` so the two streams
// always behave identically. The structural change is applied first so
// the subsequent visual apply sees the post-deletion slice — otherwise
// a single batch with both a `select` and a `remove` would either drop
// the deletion (visual first) or the selection update (structural
// first on stale data).
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

// Owns one continuous-edit gesture's pause/snapshot bookkeeping. The
// pattern mirrors React Flow's drag model: while the gesture is
// active, the temporal store is paused (so intermediate commits
// don't create an undo entry); on end, the pre-gesture snapshot
// is pushed into `pastStates` so undo restores to before the gesture
// started.
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

export const useGraphStore = create<GraphStore>()(
  temporal(
    (set, get) => ({
      title: "Untitled Graph",
      // Placeholder until `hydrate` runs; replaced with the persisted
      // document's real `createdAt` on first hydration.
      createdAt: new Date().toISOString(),
      nodes: [],
      edges: [],
      mode: "select",
      hasHydrated: false,

      // When is is not 0, an useEffect in grapheditor fits the view
      fitViewNonce: 0,

      pendingEdgeSources: [],
      selectedVertexType: DEFAULT_VERTEX_TYPE,

      confirmDialogue: null,

      isHelpOpen: false,

      clipboard: null,

      hydrate: () => {
        // Load the persisted document (v2 `{ graph, view }` shape) and
        // hydrate it back into runtime `VertexNode[]` / `GraphEdge[]` for
        // the store + React Flow. The persisted shape never reaches the
        // store directly.
        const document = loadGraphDocument();
        const hydrated = hydrateDocument(document);

        set({
          title: hydrated.title,
          // Preserve the document's original creation timestamp so
          // subsequent saves don't clobber it (the bug this field
          // exists to fix).
          createdAt: hydrated.createdAt,
          nodes: hydrated.nodes,
          edges: hydrated.edges,
          hasHydrated: true,
        });

        useGraphStore.temporal.getState().clear();
      },

      setMode: (mode) => {
        // Selection is intentionally preserved across mode switches so a
        // user can pre-select vertices in select mode and have them
        // auto-promote to pending edge sources when they switch to add-edge.
        if (mode === "add-edge") {
          // Auto-promote currently-selected vertices into the pending source
          // list. Merge with anything already pending so toggling add-edge
          // off and back on preserves work-in-progress.
          const selectedIds = selectSelectedNodeIds(get().nodes);

          const merged = Array.from(
            new Set([...get().pendingEdgeSources, ...selectedIds]),
          );

          set({ mode, pendingEdgeSources: merged });
        } else {
          // Pending sources only make sense in add-edge mode — drop them
          // whenever we leave it so the list stays coherent.
          set({ mode, pendingEdgeSources: [] });
        }
      },

      setVertexType: (vertexType) => {
        set({ selectedVertexType: vertexType });
      },

      onNodesChange: (changes) => {
        applyReactiveFlowChanges({
          changes,
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
        const node = createVertexNode(position, get().selectedVertexType);

        set({
          nodes: [...get().nodes, node],
        });
      },

      handleVertexClick: (vertexId, modifiers) => {
        // `handleVertexClick` is only meaningful in add-edge mode —
        // outside it the click belongs to React Flow's selection
        // machinery and the store stays out of the way.
        const state = get();
        if (state.mode !== "add-edge") return;

        // The six-case dispatch lives in `computeVertexClick` (see
        // operations.ts). It returns a partial state patch or `null`
        // for no-op clicks (e.g. modifier-click on an already-pending
        // vertex).
        const patch = computeVertexClick({
          vertexId,
          modifiers,
          pendingEdgeSources: state.pendingEdgeSources,
          nodes: state.nodes,
          edges: state.edges,
        });

        if (patch) set(patch);
      },

      clearPendingEdgeSources: () => {
        set({ pendingEdgeSources: [] });
      },

      // Merge every currently-selected vertex into the pending source list.
      // Intended for the box-select end in add-edge mode (Shift+drag on the
      // pane) — React Flow has just finished updating `selected` on the
      // boxed nodes by the time this fires, so we can read them straight
      // from the store. Duplicates and already-pending IDs are deduped.
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

        set(next);
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

        // Cut = copy to clipboard + remove the original selection.
        const remaining = deleteSelectedElements({
          nodes: get().nodes,
          edges: get().edges,
        });

        set({
          ...remaining,
          clipboard: {
            ...cloneSubgraphForClipboard(subgraph),
            pasteCount: 0,
          },
        });
      },

      save: () => {
        const state = get();

        // `updatedAt` is stamped inside `saveGraphDocument` so callers
        // don't have to keep clocks in sync. `createdAt` is preserved
        // from the store so repeated saves don't overwrite the
        // document's original creation time.
        saveGraphDocument({
          id: PERSISTED_IDS.localDocument,
          title: state.title,
          nodes: state.nodes,
          edges: state.edges,
          createdAt: state.createdAt,
        });
      },

      exportJson: async () => {
        const state = get();

        const contents = exportGraphJson({
          title: state.title,
          nodes: state.nodes,
          edges: state.edges,
          createdAt: state.createdAt,
        });
        const filename = toSafeFilename(state.title || "graph-board");

        await saveTextFileWithPicker({
          suggestedName: `${filename}.json`,
          contents,
          mimeType: "application/json",
          extension: ".json",
        });
      },

      // Load JSON as graph and replace the current editor state
      // with its contents. Importing is destructive
      // ask if user would like to delte the current graph
      importJson: async () => {
        const contents = await openTextFileWithPicker({});
        if (contents === null) return;

        // Validate the file
        const result = importGraphJson(contents);
        if (!result.ok) {
          window.alert(`Failed to import: ${result.error}`);
          return;
        }

        // Helper function
        const applyImport = () => {
          const hydrated = hydrateDocument(result.document);

          set({
            title: hydrated.title,
            createdAt: hydrated.createdAt,
            nodes: hydrated.nodes,
            edges: hydrated.edges,
            mode: "select",
            pendingEdgeSources: [],
            clipboard: null,
            isHelpOpen: false,
            // Nudge the view layer to refit now that the graph replaced.
            fitViewNonce: get().fitViewNonce + 1,
          });

          // Save immediatiately
          // The local document always keeps its own id
          saveGraphDocument({
            id: PERSISTED_IDS.localDocument,
            title: hydrated.title,
            nodes: hydrated.nodes,
            edges: hydrated.edges,
            createdAt: hydrated.createdAt,
          });
        };

        if (!get().isStateEmpty()) {
          get().openConfirmDialogue({
            title: "Clear Canvas?",
            message:
              "The canvas is not empty. Importing will delete the existing nodes. This action cannot be undone.",
            confirmText: "Import",
            confirmButtonClassName: "bg-red-600 hover:bg-red-700",
            onConfirm: () => {
              get().closeConfirmDialogue();
              applyImport();
            },
          });
          return;
        }

        applyImport();
      },

      updateVertexLabel: (nodeId, label) => {
        set({
          nodes: get().nodes.map((node) =>
            node.id === nodeId
              ? { ...node, data: { ...node.data, label } }
              : node,
          ),
        });
      },

      updateVertexType: (nodeId, vertexType) => {
        set({
          nodes: get().nodes.map((node) =>
            node.id === nodeId
              ? { ...node, data: { ...node.data, vertexType } }
              : node,
          ),
        });
      },

      updateVertexRotation: (nodeId, rotation) => {
        set({
          nodes: get().nodes.map((node) =>
            node.id === nodeId ? { ...node, rotation } : node,
          ),
        });
      },

      reset: () => {
        // Empty v2 doc → hydrate to runtime shape for the store. We don't
        // reuse the persisted `nodes`/`edges` directly because after the
        // v2 split those are `GraphNodeRecord[]` / `GraphEdgeRecord[]`,
        // not runtime React Flow objects.
        const document = createEmptyGraphDocument();
        const hydrated = hydrateDocument(document);

        set({
          title: hydrated.title,
          createdAt: hydrated.createdAt,
          nodes: hydrated.nodes,
          edges: hydrated.edges,
          mode: "select",
          confirmDialogue: null,
          isHelpOpen: false,
          clipboard: null,
          pendingEdgeSources: [],
        });

        saveGraphDocument({
          id: PERSISTED_IDS.localDocument,
          title: hydrated.title,
          nodes: hydrated.nodes,
          edges: hydrated.edges,
          createdAt: hydrated.createdAt,
        });
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
            buttonClassName: confirmButtonClassName,
            onConfirm,
          },
        });
      },

      closeConfirmDialogue: () => {
        // Drop the whole dialogue in one go. Reads after close see null
        // and components that key off the dialogue cleanly render their
        // closed state.
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

      // Return true if and only if the graph has no nodes.
      isStateEmpty: () => {
        return get().nodes.length === 0;
      },

      onNodeDragStart: () => {
        // Snapshot the pre-drag graph state, then pause tracking so
        // intermediate drag positions are not recorded in the undo stack.
        dragGesture.begin(partialize(get()));
      },

      onNodeDragStop: () => {
        // Resume tracking and push the pre-drag snapshot into pastStates
        // so undo restores vertex positions to before the drag.
        dragGesture.end();
      },

      onVertexPropertyEditStart: () => {
        // Same idea as onNodeDragStart, but for the property panel's
        // continuous edits (rotation slider today; future pickers reuse
        // this without a new code path).
        vertexPropertyEditGesture.begin(partialize(get()));
      },

      onVertexPropertyEditEnd: () => {
        vertexPropertyEditGesture.end();
      },
    }),
    {
      partialize,
      limit: 50,
    },
  ),
);
