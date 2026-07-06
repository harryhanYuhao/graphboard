"use client";

import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type EdgeChange,
  type NodeChange,
} from "@xyflow/react";
import { create } from "zustand";
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

  hydrate: () => void;
  setMode: (mode: EditorMode) => void;
  setVertexType: (vertexType: VertexType) => void;

  onNodesChange: (changes: NodeChange<VertexNode>[]) => void;
  onEdgesChange: (changes: EdgeChange<GraphEdge>[]) => void;

  addVertexAt: (position: { x: number; y: number }) => void;
  handleVertexClick: (vertexId: string) => void;
  updateVertexLabel: (nodeId: string, label: string) => void;
  deleteSelected: () => void;
  save: () => void;
  exportJson: () => Promise<void>;
  reset: () => void;
};

export const useGraphStore = create<GraphStore>((set, get) => ({
  title: "Untitled Graph",
  nodes: [],
  edges: [],
  mode: "select",
  hasHydrated: false,

  pendingEdgeSourceId: null,
  selectedVertexType: DEFAULT_VERTEX_TYPE,

  hydrate: () => {
    const document = loadGraphDocument();

    set({
      title: document.title,
      nodes: document.nodes,
      edges: document.edges,
      hasHydrated: true,
    });
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
    set({
      nodes: applyNodeChanges(changes, get().nodes),
    });
  },

  onEdgesChange: (changes) => {
    set({
      edges: applyEdgeChanges(changes, get().edges),
    });
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
    });

    saveGraphDocument(document);
  },
}));
