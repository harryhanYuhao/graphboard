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
      handleVertexClick(node.id);
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
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [deleteSelected]);

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
      if (mode !== "add-vertex") return;

      const position = reactFlow.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      addVertexAt(position);
    },
    [addVertexAt, mode, reactFlow],
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
        nodesConnectable={false}
        fitView
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} />
        <Controls />
        <MiniMap />
      </ReactFlow>

      <GraphToolbar />
      <VertexTypeMenu />
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

