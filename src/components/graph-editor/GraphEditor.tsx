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
import { VertexPropertyPanel } from "./VertexPropertyPanel";
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
  const addSelectedToPendingSources = useGraphStore(
    (state) => state.addSelectedToPendingSources,
  );
  const onNodeDragStart = useGraphStore((state) => state.onNodeDragStart);
  const onNodeDragStop = useGraphStore((state) => state.onNodeDragStop);

  const isConfirmOpen = useGraphStore((state) => state.isConfirmDialogueOpen);
  const confirmTitle = useGraphStore((state) => state.confirmDialogueTitle);
  const confirmMessage = useGraphStore((state) => state.confirmDialogueMsg);
  const confirmText = useGraphStore((state) => state.confirmDialogueConfirmText);
  const cancelText = useGraphStore((state) => state.confirmDialogueCancelText);
  const confirmButtonClassName = useGraphStore(
    (state) => state.confirmDialogueButtonClassName,
  );
  const onConfirm = useGraphStore((state) => state.pendingConfirmAction);

  const closeConfirm = useGraphStore((state) => state.closeConfirmDialogue);

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

  // React Flow's `onSelectionEnd` only fires when a box-select drag finishes
  // (Shift+drag on the pane), not on single shift-clicks — which is exactly
  // the gesture we want to capture here. We funnel the just-selected nodes
  // into the pending source list so the user can sweep a region of vertices
  // into the fan-out with one drag instead of N cmd-clicks.
  const handleSelectionEnd = useCallback(() => {
    if (mode !== "add-edge") return;
    addSelectedToPendingSources();
  }, [addSelectedToPendingSources, mode]);

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
        // Shift+drag on the pane becomes a box-select that sweeps vertices
        // into the pending source list (handled in onSelectionEnd). The
        // default selectionKeyCode is already 'Shift', so we only need to
        // flip selectionOnDrag on for add-edge mode.
        selectionOnDrag={mode === "add-edge"}
        onSelectionEnd={handleSelectionEnd}
        nodesConnectable={false}
        fitView
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} />
        <Controls />
        <MiniMap />
      </ReactFlow>

      <GraphToolbar />
      <VertexTypeMenu />
      <VertexPropertyPanel />

      <ConfirmationDialog
        isOpen={isConfirmOpen}
        title={confirmTitle}
        message={confirmMessage}
        confirmText={confirmText}
        cancelText={cancelText}
        confirmButtonClassName={confirmButtonClassName}
        onConfirm={onConfirm}
        onCancel={closeConfirm}
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

