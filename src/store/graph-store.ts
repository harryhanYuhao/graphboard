"use client";

import {
  addEdge,
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

type GraphStore = {
  title: string;
  nodes: VertexNode[];
  edges: GraphEdge[];
  mode: EditorMode;
  hasHydrated: boolean;
  pendingEdgeSourceId: string | null;
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
  handleVertexClick: (vertexId: string) => void;
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

      pendingEdgeSourceId: null,
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
        set({
          mode,
          pendingEdgeSourceId: null,
          nodes: get().nodes.map((node) => ({
            ...node,
            selected: false,
          })),
          edges: get().edges.map((edge) => ({
            ...edge,
            selected: false,
          })),
        });
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

      handleVertexClick: (vertexId) => {
        const state = get();

        if (state.mode !== "add-edge") return;

        if (!state.pendingEdgeSourceId) {
          set({
            pendingEdgeSourceId: vertexId,
          });

          return;
        }

        if (state.pendingEdgeSourceId === vertexId) {
          set({
            pendingEdgeSourceId: null,
          });

          return;
        }

        const edge = createGraphEdge(state.pendingEdgeSourceId, vertexId);

        set({
          edges: addEdge(edge, state.edges),
          pendingEdgeSourceId: null,
        });
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
