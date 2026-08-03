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
  EDITOR_MODES,
  PERSISTED_IDS,
  type EditorMode,
  type GraphEdge,
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
} from "@/lib/graph/vertex-types";
import { selectSelectedNodeIds } from "@/store/selectors";
import {
  createEmptyGraphDocument,
  hydrateDocument,
  loadGraphDocument,
  saveGraphDocument,
  exportGraphJson,
  importGraphJson,
  normalizeRotation,
} from "@/lib/graph/serialization";

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

  // Destructive-action confirmation dialog (`null` when closed).
  confirmDialogue: ConfirmDialogueState | null;

  // Help dialog. Kept in the store so the `?` keybinding and toolbar
  // button share one source of truth.
  isHelpOpen: boolean;

  // First-run intro. Auto-opened by `hydrate()` when the
  // `graph-board-seen-intro` flag is absent; the flag is stamped at open
  // time so the intro never reappears on reload.
  isIntroOpen: boolean;

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
  updateVertexOrder: (nodeId: string, targetOrder: number) => void;
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

  openIntro: () => void;
  closeIntro: () => void;


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

// Save the graph to localStorage under the stable local-doc id. Shared
// by `save`, `importJson.applyImport`, and `reset` so the field list
// lives in one place.
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

      confirmDialogue: null,

      isHelpOpen: false,

      isIntroOpen: false,

      validationErrors: {},

      clipboard: null,

      hydrate: () => {
        // Hydrate the persisted doc (v2 `{ graph, view }` shape) into
        // runtime `VertexNode[]` / `GraphEdge[]`; the persisted shape
        // never reaches the store.
        const document = loadGraphDocument();
        const hydrated = hydrateDocument(document);

        set({
          title: hydrated.title,
          createdAt: hydrated.createdAt,
          nodes: hydrated.nodes,
          edges: hydrated.edges,
          hasHydrated: true,
          validationErrors: {},
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
        // `updatedAt` is stamped in `saveGraphDocument`; `createdAt` is
        // preserved from the store.
        persistLocal(state);
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

      // Import replaces the editor state; if the canvas is non-empty the
      // user must confirm the destructive import first.
      importJson: async () => {
        const contents = await openTextFileWithPicker({});
        if (contents === null) return;

        const result = importGraphJson(contents);
        if (!result.ok) {
          window.alert(`Failed to import: ${result.error}`);
          return;
        }

        const applyImport = () => {
          const hydrated = hydrateDocument(result.document);

          set({
            title: hydrated.title,
            createdAt: hydrated.createdAt,
            nodes: hydrated.nodes,
            edges: hydrated.edges,
            mode: EDITOR_MODES.select,
            pendingEdgeSources: [],
            clipboard: null,
            isHelpOpen: false,
            validationErrors: {},
            // Refit now that the graph replaced.
            fitViewNonce: get().fitViewNonce + 1,
          });

          persistLocal(hydrated);

          // A new document must not carry the old undo history (same as
          // `hydrate` / `reset`), or undo after import would rewind into
          // the pre-import graph.
          useGraphStore.temporal.getState().clear();
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
          clipboard: null,
          pendingEdgeSources: [],
          validationErrors: {},
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

      // Group the flat error list by vertex id into a Record. Errors
      // without a `vertexId` (none today, but defended) are dropped —
      // they can't be attributed to a rendered node. An empty-string id
      // is dropped too: a node id is never `""`, so a "" bucket would
      // linger in the map with no renderer to consume it.
      setValidationErrors: (errors) => {
        const grouped: Record<string, ValidationError[]> = {};
        for (const e of errors) {
          if (!e.vertexId) continue;
          (grouped[e.vertexId] ??= []).push(e);
        }
        set({ validationErrors: grouped });
      },

      clearValidationErrors: () => {
        set({ validationErrors: {} });
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
