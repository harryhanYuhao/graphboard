// src/components/graph-editor/GraphEditor.tsx

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
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { VertexNode } from "./VertexNode";
import { GraphToolbar } from "./GraphToolbar";
import { useGraphStore } from "@/store/graph-store";
import type { GraphEdge, VertexNode as VertexNodeType } from "@/lib/graph/types";

function GraphEditorInner() {
  const nodes = useGraphStore((state) => state.nodes);
  const edges = useGraphStore((state) => state.edges);
  const mode = useGraphStore((state) => state.mode);
  const hasHydrated = useGraphStore((state) => state.hasHydrated);

  const hydrate = useGraphStore((state) => state.hydrate);
  const onNodesChange = useGraphStore((state) => state.onNodesChange);
  const onEdgesChange = useGraphStore((state) => state.onEdgesChange);
  const onConnect = useGraphStore((state) => state.onConnect);
  const addVertexAt = useGraphStore((state) => state.addVertexAt);
  const deleteSelected = useGraphStore((state) => state.deleteSelected);

  const reactFlow = useReactFlow<VertexNodeType, GraphEdge>();

  const nodeTypes = useMemo<NodeTypes>(
    () => ({
      vertex: VertexNode,
    }),
    [],
  );

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Backspace" || event.key === "Delete") {
        deleteSelected();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [deleteSelected]);

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
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onPaneClick={handlePaneClick}
        fitView
        deleteKeyCode={["Backspace", "Delete"]}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} />
        <Controls />
        <MiniMap />
      </ReactFlow>

      <GraphToolbar />
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