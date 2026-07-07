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
  getSelectedSubgraph,
  pasteSubgraph,
} from "@/lib/graph/operations";
import { DEFAULT_VERTEX_TYPE } from "@/lib/graph/vertex-types";
import {
  createEmptyGraphDocument,
  loadGraphDocument,
  saveGraphDocument,
  exportGraphJson,
} from "@/lib/graph/serialization";

import { saveTextFileWithPicker } from "@/lib/download";

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
  isResetConfirmOpen: boolean;
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
  updateVertexLabel: (nodeId: string, label: string) => void;
  copySelected: () => void;
  paste: () => void;
  cutSelected: () => void;
  deleteSelected: () => void;
  save: () => void;
  exportJson: () => Promise<void>;
  reset: () => void;
  openResetConfirm: () => void;
  closeResetConfirm: () => void;

  onNodeDragStart: () => void;
  onNodeDragStop: () => void;
};

function partialize(state: GraphStore) {
  const { nodes, edges } = state;
  return { nodes, edges };
}

// Module-level stash for the pre-drag graph snapshot, so the drag-stop
// handler can push it into the undo stack as a single entry.
let preDragSnapshot: { nodes: VertexNode[]; edges: GraphEdge[] } | null = null;

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
      isResetConfirmOpen: false,
      clipboard: null,

      hydrate: () => {
        const document = loadGraphDocument();

        set({
          title: document.title,
          nodes: document.nodes,
          edges: document.edges,
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

        // Existing source→target pairs we won't recreate. Self-loops are
        // explicitly allowed — only parallel duplicates are filtered.
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

      deleteSelected: () => {
        const next = deleteSelectedElements({
          nodes: get().nodes,
          edges: get().edges,
        });

        set(next);
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

        saveGraphDocument({
          id: "local-document",
          title: state.title,
          nodes: state.nodes,
          edges: state.edges,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
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

      updateVertexLabel: (nodeId, label) => {
        set({
          nodes: get().nodes.map((node) =>
            node.id === nodeId
              ? { ...node, data: { ...node.data, label } }
              : node,
          ),
        });
      },

      reset: () => {
        const document = createEmptyGraphDocument();

        set({
          title: document.title,
          nodes: document.nodes,
          edges: document.edges,
          mode: "select",
          isResetConfirmOpen: false,
          clipboard: null,
          pendingEdgeSources: [],
        });

        saveGraphDocument(document);
        useGraphStore.temporal.getState().clear();
      },

      openResetConfirm: () => {
        set({ isResetConfirmOpen: true });
      },

      closeResetConfirm: () => {
        set({ isResetConfirmOpen: false });
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
    }),
    {
      partialize,
      limit: 50,
    },
  ),
);
