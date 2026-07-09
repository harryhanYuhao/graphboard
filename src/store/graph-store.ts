"use client";

import {
  applyEdgeChanges,
  applyNodeChanges,
  type EdgeChange,
  type NodeChange,
} from "@xyflow/react";
import { create } from "zustand";
import { temporal } from "zundo";
import type {
  EditorMode,
  GraphEdge,
  VertexNode,
  VertexType,
} from "@/lib/graph/types";
import {
  createGraphEdge,
  createVertexNode,
  deleteSelectedElements,
  cloneSubgraphForClipboard,
  clearAllSelections,
  getSelectedSubgraph,
  pasteSubgraph,
  selectAllElements,
} from "@/lib/graph/operations";
import { DEFAULT_VERTEX_TYPE } from "@/lib/graph/vertex-types";
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

// Modifier flags captured at click time and forwarded into handleVertexClick
// so the store doesn't need to reach back into the DOM event.
export type VertexClickModifiers = {
  // Cmd (mac) or Ctrl (win/linux) — used to add to the pending source list
  // instead of committing.
  modifier: boolean;
  // Shift — used to commit without clearing the pending source list.
  shift: boolean;
};

type GraphStore = {
  title: string;
  nodes: VertexNode[];
  edges: GraphEdge[];
  mode: EditorMode;
  hasHydrated: boolean;
  // Vertex IDs staged as edge sources while in add-edge mode. Empty outside
  // of add-edge mode. Edges are fanned out from every ID in this list to the
  // next clicked target.
  pendingEdgeSources: string[];
  selectedVertexType: VertexType;

  isConfirmDialogueOpen: boolean;
  confirmDialogueTitle: string;
  confirmDialogueMsg: string;
  confirmDialogueConfirmText: string;
  confirmDialogueCancelText: string;
  confirmDialogueButtonClassName: string;
  // Pending action the dialog will run when the user confirms. Defaults to a
  // no-op so reads from the store are always safe (e.g. when the dialog is
  // closed). This is *state*, not an action — it gets overwritten on every
  // openConfirmDialogue call.
  pendingConfirmAction: () => void;

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

// Module-level stash for the pre-drag graph snapshot, so the drag-stop
// handler can push it into the undo stack as a single entry.
let preDragSnapshot: { nodes: VertexNode[]; edges: GraphEdge[] } | null = null;

// Module-level stash for the pre-panel-edit graph snapshot, so the
// panel's continuous-edit guard (rotation slider today, possibly more
// later) can collapse its many intermediate commits into one undo step.
// Kept distinct from `preDragSnapshot` so the two gestures don't
// trample each other's snapshot if they ever overlap.
let preVertexPropertyEditSnapshot: {
  nodes: VertexNode[];
  edges: GraphEdge[];
} | null = null;

export const useGraphStore = create<GraphStore>()(
  temporal(
    (set, get) => ({
      title: "Untitled Graph",
      nodes: [],
      edges: [],
      mode: "select",
      hasHydrated: false,

      pendingEdgeSources: [],
      selectedVertexType: DEFAULT_VERTEX_TYPE,

      isConfirmDialogueOpen: false,
      confirmDialogueTitle: "",
      confirmDialogueMsg: "",
      confirmDialogueConfirmText: "Confirm",
      confirmDialogueCancelText: "Cancel",
      confirmDialogueButtonClassName: "bg-red-600 hover:bg-red-700",
      pendingConfirmAction: () => { },

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
          const selectedIds = get()
            .nodes.filter((node) => node.selected)
            .map((node) => node.id);

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
        // Separate structural changes (remove) from visual-only changes
        // (dimensions, select, position). Only structural changes should
        // create undo snapshots; the others are side effects of rendering
        // or user navigation, not meaningful graph edits.
        const structuralChanges = changes.filter(
          (c) => c.type === "remove",
        );
        const visualChanges = changes.filter(
          (c) => c.type !== "remove",
        );

        // Apply visual changes without recording them in the undo stack.
        if (visualChanges.length > 0) {
          useGraphStore.temporal.getState().pause();
          set({
            nodes: applyNodeChanges(visualChanges, get().nodes),
          });
          useGraphStore.temporal.getState().resume();
        }

        // Apply structural changes with undo tracking.
        if (structuralChanges.length > 0) {
          set({
            nodes: applyNodeChanges(structuralChanges, get().nodes),
          });
        }
      },

      onEdgesChange: (changes) => {
        const structuralChanges = changes.filter(
          (c) => c.type === "remove",
        );
        const visualChanges = changes.filter(
          (c) => c.type !== "remove",
        );

        if (visualChanges.length > 0) {
          useGraphStore.temporal.getState().pause();
          set({
            edges: applyEdgeChanges(visualChanges, get().edges),
          });
          useGraphStore.temporal.getState().resume();
        }

        if (structuralChanges.length > 0) {
          set({
            edges: applyEdgeChanges(structuralChanges, get().edges),
          });
        }
      },

      addVertexAt: (position) => {
        const node = createVertexNode(position, get().selectedVertexType);

        set({
          nodes: [...get().nodes, node],
        });
      },

      handleVertexClick: (vertexId, modifiers) => {
        const state = get();

        if (state.mode !== "add-edge") return;

        const { pendingEdgeSources, nodes, edges } = state;

        // Cmd/Ctrl click: add this vertex to the pending source list
        // (idempotent — if it's already there, the wrong gesture was used
        // to toggle it off and there's nothing to do).
        if (modifiers.modifier) {
          if (pendingEdgeSources.includes(vertexId)) return;

          set({
            pendingEdgeSources: [...pendingEdgeSources, vertexId],
          });

          return;
        }

// Existing source→target pairs we won't recreate. Includes self-loops
// (a→a) — there's no special-case carve-out.
const existingPairs = new Set(
  edges.map((edge) => `${edge.source}->${edge.target}`),
);

        const buildFanOut = (clearAfter: boolean) => {
          const newEdges = pendingEdgeSources
            .filter(
              (sourceId) =>
                !existingPairs.has(`${sourceId}->${vertexId}`),
            )
            .map((sourceId) => createGraphEdge(sourceId, vertexId));

          // Nothing added and nothing to clear — leave state alone.
          if (newEdges.length === 0 && !clearAfter) return;

          if (clearAfter) {
            set({
              edges:
                newEdges.length > 0 ? [...edges, ...newEdges] : edges,
              pendingEdgeSources: [],
              nodes: nodes.map((node) => ({ ...node, selected: false })),
            });
          } else {
            set({ edges: [...edges, ...newEdges] });
          }
        };

        // Shift click: connect every pending source to this target but
        // keep the pending list intact so the user can broadcast the same
        // sources to multiple targets. Empty pending degrades to the
        // plain-click-on-empty behavior of starting a fresh pending list.
        if (modifiers.shift) {
          if (pendingEdgeSources.length === 0) {
            set({ pendingEdgeSources: [vertexId] });
            return;
          }

          buildFanOut(false);
          return;
        }

        // Plain click.
        if (pendingEdgeSources.length === 0) {
          set({ pendingEdgeSources: [vertexId] });
          return;
        }

        // Click on a vertex already in the pending list: toggle it off.
        if (pendingEdgeSources.includes(vertexId)) {
          set({
            pendingEdgeSources: pendingEdgeSources.filter(
              (id) => id !== vertexId,
            ),
          });
          return;
        }

        // Plain click with a fresh target: commit the fan-out and reset
        // both the pending list and any selection.
        buildFanOut(true);
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
        const selectedIds = get()
          .nodes.filter((node) => node.selected)
          .map((node) => node.id);

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
        // don't have to keep clocks in sync.
        saveGraphDocument({
          id: "local-document",
          title: state.title,
          nodes: state.nodes,
          edges: state.edges,
          createdAt: new Date().toISOString(),
        });
      },

      exportJson: async () => {
        const state = get();

        const contents = exportGraphJson({
          title: state.title,
          nodes: state.nodes,
          edges: state.edges,
        });
        const filename = toSafeFilename(state.title || "graph-board");

        await saveTextFileWithPicker({
          suggestedName: `${filename}.json`,
          contents,
          mimeType: "application/json",
          extension: ".json",
        });
      },

      // Open a JSON file from disk and replace the current editor state
      // with its contents.
      // Importing is destructive when the canvas already has content, so
      // we route through the confirmation dialog. 
      importJson: async () => {
        const contents = await openTextFileWithPicker({});
        if (contents === null) return;

        // Validate the file up front so we never open a confirm dialog for
        // a document we're going to reject anyway.
        const result = importGraphJson(contents);
        if (!result.ok) {
          window.alert(`Failed to import: ${result.error}`);
          return;
        }

        const applyImport = () => {
          const hydrated = hydrateDocument(result.document);

          set({
            title: hydrated.title,
            nodes: hydrated.nodes,
            edges: hydrated.edges,
            mode: "select",
            pendingEdgeSources: [],
            clipboard: null,
            isHelpOpen: false,
          });

          // Persist immediately so the imported state survives a refresh
          // even if the user closes the tab before the autosave timer fires.
          saveGraphDocument({
            id: hydrated.id,
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
          nodes: hydrated.nodes,
          edges: hydrated.edges,
          mode: "select",
          isConfirmDialogueOpen: false,
          isHelpOpen: false,
          clipboard: null,
          pendingEdgeSources: [],
        });

        saveGraphDocument({
          id: hydrated.id,
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
          isConfirmDialogueOpen: true,
          confirmDialogueTitle: title,
          confirmDialogueMsg: message,
          confirmDialogueConfirmText: confirmText,
          confirmDialogueCancelText: cancelText,
          confirmDialogueButtonClassName: confirmButtonClassName,
          pendingConfirmAction: onConfirm,
        });
      },

      closeConfirmDialogue: () => {
        set({
          isConfirmDialogueOpen: false,
          confirmDialogueTitle: "",
          confirmDialogueMsg: "",
          // Reset to a no-op so stray reads after close don't re-fire the
          // last action.
          pendingConfirmAction: () => { },
        });
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
        preDragSnapshot = partialize(get());
        useGraphStore.temporal.getState().pause();
      },

      onNodeDragStop: () => {
        const temporalState = useGraphStore.temporal.getState();

        // Resume tracking first so future operations are recorded normally.
        temporalState.resume();

        // Push the pre-drag snapshot into pastStates so that undo
        // correctly restores the vertex positions from before the drag.
        if (preDragSnapshot) {
          useGraphStore.temporal.setState({
            pastStates: [...temporalState.pastStates, preDragSnapshot],
            futureStates: [],
          });
          preDragSnapshot = null;
        }
      },

      onVertexPropertyEditStart: () => {
        preVertexPropertyEditSnapshot = partialize(get());
        useGraphStore.temporal.getState().pause();
      },

      onVertexPropertyEditEnd: () => {
        const temporalState = useGraphStore.temporal.getState();

        temporalState.resume();

        if (preVertexPropertyEditSnapshot) {
          useGraphStore.temporal.setState({
            pastStates: [...temporalState.pastStates, preVertexPropertyEditSnapshot],
            futureStates: [],
          });
          preVertexPropertyEditSnapshot = null;
        }
      },
    }),
    {
      partialize,
      limit: 50,
    },
  ),
);
