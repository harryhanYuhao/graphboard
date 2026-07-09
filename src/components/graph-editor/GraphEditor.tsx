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
import { useShallow } from "zustand/react/shallow";

import { VertexNode } from "./VertexNode";
import { GraphToolbar } from "./GraphToolbar";
import { VertexTypeMenu } from "./VertexTypeMenu";
import { VertexPropertyPanel } from "./VertexPropertyPanel";
import { ConfirmationDialog } from "./ConfirmationDialog";
import { KeyboardShortcutsDialog } from "./KeyboardShortcutsDialog";
import { useKeyboardShortcuts } from "./useKeyboardShortcuts";
import { useGraphStore } from "@/store/graph-store";
import {
  EDGE_TYPES,
  type GraphEdge,
  type VertexNode as VertexNodeType,
} from "@/lib/graph/types";
import { StraightCenterEdge } from "./StraightCenterEdge";

function GraphEditorInner() {
  // Group state slices by concern so the component re-renders only
  // when a slice it actually reads changes. `useShallow` makes the
  // multi-field bundle a single shallow comparison; the actions
  // below are stable references and don't need shallow.
  const { nodes, edges, mode, hasHydrated } = useGraphStore(
    useShallow((state) => ({
      nodes: state.nodes,
      edges: state.edges,
      mode: state.mode,
      hasHydrated: state.hasHydrated,
    })),
  );
  const { confirmDialogue, isHelpOpen } = useGraphStore(
    useShallow((state) => ({
      confirmDialogue: state.confirmDialogue,
      isHelpOpen: state.isHelpOpen,
    })),
  );

  const hydrate = useGraphStore((state) => state.hydrate);
  const onNodesChange = useGraphStore((state) => state.onNodesChange);
  const onEdgesChange = useGraphStore((state) => state.onEdgesChange);
  const addVertexAt = useGraphStore((state) => state.addVertexAt);
  const clearPendingEdgeSources = useGraphStore(
    (state) => state.clearPendingEdgeSources,
  );
  const addSelectedToPendingSources = useGraphStore(
    (state) => state.addSelectedToPendingSources,
  );
  const onNodeDragStart = useGraphStore((state) => state.onNodeDragStart);
  const onNodeDragStop = useGraphStore((state) => state.onNodeDragStop);
  const handleVertexClick = useGraphStore((state) => state.handleVertexClick);
  const closeConfirm = useGraphStore((state) => state.closeConfirmDialogue);
  const closeHelp = useGraphStore((state) => state.closeHelp);

  const reactFlow = useReactFlow<VertexNodeType, GraphEdge>();

  const nodeTypes = useMemo<NodeTypes>(
    () => ({
      vertex: VertexNode,
    }),
    [],
  );
  const edgeTypes = useMemo<EdgeTypes>(
    () => ({
      [EDGE_TYPES.straightCenter]: StraightCenterEdge,
    }),
    [],
  );

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

  useKeyboardShortcuts();

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
        isOpen={confirmDialogue !== null}
        title={confirmDialogue?.title ?? ""}
        message={confirmDialogue?.message ?? ""}
        confirmText={confirmDialogue?.confirmText ?? "Confirm"}
        cancelText={confirmDialogue?.cancelText ?? "Cancel"}
        confirmButtonClassName={
          confirmDialogue?.buttonClassName ?? "bg-red-600 hover:bg-red-700"
        }
        onConfirm={() => {
          // Snapshot the action before closing 
          // closeConfirmDialogue nulls out the dialogue, 
          const action = confirmDialogue?.onConfirm;
          closeConfirm();
          action?.();
        }}
        onCancel={closeConfirm}
      />

      <KeyboardShortcutsDialog isOpen={isHelpOpen} onClose={closeHelp} />
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

