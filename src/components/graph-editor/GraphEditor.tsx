"use client";

import { useCallback, useEffect, useMemo } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type EdgeTypes,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { VertexNode } from "./VertexNode";
import { GraphToolbar } from "./GraphToolbar";
import { VertexTypeMenu } from "./VertexTypeMenu";
import { ConfirmationDialog } from "./ConfirmationDialog";
import { useGraphStore } from "@/store/graph-store";
import type { GraphEdge, VertexNode as VertexNodeType } from "@/lib/graph/types";
import { StraightCenterEdge } from "./StraightCenterEdge";

function GraphEditorInner() {
  const nodes = useGraphStore((state) => state.nodes);
  const edges = useGraphStore((state) => state.edges);
  const mode = useGraphStore((state) => state.mode);
  const hasHydrated = useGraphStore((state) => state.hasHydrated);

  const hydrate = useGraphStore((state) => state.hydrate);
  const onNodesChange = useGraphStore((state) => state.onNodesChange);
  const onEdgesChange = useGraphStore((state) => state.onEdgesChange);
  const addVertexAt = useGraphStore((state) => state.addVertexAt);
  const deleteSelected = useGraphStore((state) => state.deleteSelected);
  const copySelected = useGraphStore((state) => state.copySelected);
  const paste = useGraphStore((state) => state.paste);
  const cutSelected = useGraphStore((state) => state.cutSelected);
  const clearPendingEdgeSources = useGraphStore(
    (state) => state.clearPendingEdgeSources,
  );
  const onNodeDragStart = useGraphStore((state) => state.onNodeDragStart);
  const onNodeDragStop = useGraphStore((state) => state.onNodeDragStop);
  const isResetConfirmOpen = useGraphStore((state) => state.isResetConfirmOpen);
  const reset = useGraphStore((state) => state.reset);
  const closeResetConfirm = useGraphStore((state) => state.closeResetConfirm);

  const reactFlow = useReactFlow<VertexNodeType, GraphEdge>();

  const nodeTypes = useMemo<NodeTypes>(
    () => ({
      vertex: VertexNode,
    }),
    [],
  );
  const edgeTypes = useMemo<EdgeTypes>(
    () => ({
      "straight-center": StraightCenterEdge,
    }),
    [],
  );

  const handleVertexClick = useGraphStore((state) => state.handleVertexClick);
  const handleNodeClick = useCallback(
    (event: React.MouseEvent, node: VertexNodeType) => {
      if (mode !== "add-edge") return;

      event.stopPropagation();
      handleVertexClick(node.id, {
        modifier: event.metaKey || event.ctrlKey,
        shift: event.shiftKey,
      });
    },
    [handleVertexClick, mode],
  );

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      // do not handle in input mode
      const tag = (event.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      if (event.key === "Backspace" || event.key === "Delete") {
        deleteSelected();
      } else if (event.key === "Escape") {
        // Escape clears the pending edge source list without creating
        // edges — a no-op if the list is already empty.
        if (useGraphStore.getState().pendingEdgeSources.length > 0) {
          clearPendingEdgeSources();
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [clearPendingEdgeSources, deleteSelected]);

  // Undo/Redo keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod) return;

      if (event.key === "z" && !event.shiftKey) {
        event.preventDefault();
        useGraphStore.temporal.getState().undo();
      } else if ((event.key === "z" && event.shiftKey) || event.key === "y") {
        event.preventDefault();
        useGraphStore.temporal.getState().redo();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Copy / Paste / Cut keyboard shortcuts. Skip when typing into an input
  // (e.g. vertex label editor) so the browser's native clipboard handling
  // stays intact for text fields.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod) return;

      const tag = (event.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      if (event.key === "c" && !event.shiftKey) {
        event.preventDefault();
        copySelected();
      } else if (event.key === "v" && !event.shiftKey) {
        event.preventDefault();
        paste();
      } else if (event.key === "x" && !event.shiftKey) {
        event.preventDefault();
        cutSelected();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [copySelected, paste, cutSelected]);

  // Auto save
  useEffect(() => {
    if (!hasHydrated) return;

    const timeout = window.setTimeout(() => {
      useGraphStore.getState().save();
    }, 2000);

    return () => window.clearTimeout(timeout);
  }, [nodes, edges, hasHydrated]);


  const handlePaneClick = useCallback(
    (event: React.MouseEvent) => {
      if (mode === "add-vertex") {
        const position = reactFlow.screenToFlowPosition({
          x: event.clientX,
          y: event.clientY,
        });

        addVertexAt(position);
        return;
      }

      if (mode === "add-edge") {
        // Clicking empty pane in add-edge mode cancels the pending source
        // list without creating any edges.
        clearPendingEdgeSources();
      }
    },
    [addVertexAt, clearPendingEdgeSources, mode, reactFlow],
  );

  if (!hasHydrated) {
    return (
      <div className="flex h-screen w-screen items-center justify-center text-sm text-slate-500">
        Loading graph editor...
      </div>
    );
  }


  return (
    <div className="relative h-screen w-screen bg-slate-50">
      <ReactFlow<VertexNodeType, GraphEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        onPaneClick={handlePaneClick}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={onNodeDragStop}
        nodesConnectable={false}
        fitView
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} />
        <Controls />
        <MiniMap />
      </ReactFlow>

      <GraphToolbar />
      <VertexTypeMenu />

      <ConfirmationDialog
        isOpen={isResetConfirmOpen}
        title="Reset Graph"
        message="Are you sure you want to reset the graph? This will delete all nodes, edges, and the current title. This action cannot be undone."
        confirmText="Reset"
        cancelText="Cancel"
        onConfirm={reset}
        onCancel={closeResetConfirm}
        confirmButtonClassName="bg-red-600 hover:bg-red-700"
      />
    </div>
  );
}

export function GraphEditor() {
  return (
    <ReactFlowProvider>
      <GraphEditorInner />
    </ReactFlowProvider>
  );
}

