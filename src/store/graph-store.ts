"use client";

import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type EdgeChange,
  type NodeChange,
} from "@xyflow/react";
import { create } from "zustand";
import type { EditorMode, GraphEdge, VertexNode } from "@/lib/graph/types";
import {
  createGraphEdge,
  createVertexNode,
  deleteSelectedElements,
} from "@/lib/graph/operations";
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

  hydrate: () => void;
  setMode: (mode: EditorMode) => void;

  onNodesChange: (changes: NodeChange<VertexNode>[]) => void;
  onEdgesChange: (changes: EdgeChange<GraphEdge>[]) => void;
  onConnect: (connection: Connection) => void;

  addVertexAt: (position: { x: number; y: number }) => void;
  handleVertexClick: (vertexId: string) => void;
  addEdgeBetween: (sourceId: string, targetId: string) => void;
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

  onConnect: (connection) => {
    if (!connection.source || !connection.target) return;

    const existingEdge = get().edges.find((edge) => {
      const sameDirection =
        edge.source === connection.source && edge.target === connection.target;

      const oppositeDirection =
        edge.source === connection.target && edge.target === connection.source;

      return sameDirection || oppositeDirection;
    });

    if (existingEdge) return;

    const edge = createGraphEdge(connection.source, connection.target);

    set({
      edges: addEdge(edge, get().edges),
    });
  },

  addVertexAt: (position) => {
    const node = createVertexNode(position);

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

  addEdgeBetween: (sourceId, targetId) => {
    if (sourceId === targetId) return;

    const edge = createGraphEdge(sourceId, targetId);

    set({
      edges: addEdge(edge, get().edges),
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
