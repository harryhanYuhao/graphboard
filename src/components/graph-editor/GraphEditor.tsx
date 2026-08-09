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
import { ExportDialog } from "./ExportDialog";
import { HelpDialog } from "./HelpDialog";
import { IntroGuideDialog } from "./IntroGuideDialog";
import { ComputeResultDialog } from "./ComputeResultDialog";
import { GraphPropertiesDialog } from "./GraphPropertiesDialog";
import { useKeyboardShortcuts } from "./useKeyboardShortcuts";
import { useCompute } from "@/lib/hooks/useCompute";
import { useGraphStore } from "@/store/graph-store";
import {
  EDGE_TYPES,
  EDITOR_MODES,
  type GraphEdge,
  type VertexNode as VertexNodeType,
} from "@/lib/graph/types";
import { GRID_SIZE } from "@/lib/graph/operations";
import { StraightCenterEdge } from "./StraightCenterEdge";

function GraphEditorInner() {
  // `useShallow` bundles multi-field state into one shallow comparison so the
  // component re-renders only when a read slice changes. The actions below are
  // stable references and don't need shallow.
  const { nodes, edges, mode, hasHydrated, title } = useGraphStore(
    useShallow((state) => ({
      nodes: state.nodes,
      edges: state.edges,
      mode: state.mode,
      hasHydrated: state.hasHydrated,
      title: state.title,
    })),
  );
  const { confirmDialogue, isHelpOpen, isIntroOpen, isExportOpen, isPropertiesOpen } =
    useGraphStore(
      useShallow((state) => ({
        confirmDialogue: state.confirmDialogue,
        isHelpOpen: state.isHelpOpen,
        isIntroOpen: state.isIntroOpen,
        isExportOpen: state.isExportOpen,
        isPropertiesOpen: state.isPropertiesOpen,
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
  const openIntro = useGraphStore((state) => state.openIntro);
  const closeIntro = useGraphStore((state) => state.closeIntro);
  const closeExport = useGraphStore((state) => state.closeExport);
  const closeProperties = useGraphStore((state) => state.closeProperties);
  // Bumps whenever the store replaces the graph (import, hydrate). The store
  // can't call `fitView()` itself (React Flow hooks only work under the
  // provider), so the view layer watches this nonce.
  const fitViewNonce = useGraphStore((state) => state.fitViewNonce);

  const reactFlow = useReactFlow<VertexNodeType, GraphEdge>();

  // Compute orchestration (WASM worker, promise/progress, result dialog) lives
  // in a hook, not the store — it's a one-shot async computation. The toolbar
  // button and the Cmd/Ctrl+Enter shortcut both call `requestCompute`.
  const compute = useCompute();

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
      if (mode !== EDITOR_MODES.addEdge) return;

      event.stopPropagation();
      handleVertexClick(node.id, {
        modifier: event.metaKey || event.ctrlKey,
        shift: event.shiftKey,
      });
    },
    [handleVertexClick, mode],
  );

  // `onSelectionEnd` fires only at the end of a box-select drag (Shift+drag),
  // not on single shift-clicks — exactly the gesture to capture here. Sweeps
  // the just-selected nodes into the pending source list for fan-out edges.
  const handleSelectionEnd = useCallback(() => {
    if (mode !== "add-edge") return;
    addSelectedToPendingSources();
  }, [addSelectedToPendingSources, mode]);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  // Refit on graph replacement (import / non-empty hydrate). The `0` guard
  // skips the pre-hydrate render and empty graphs, so placing the first vertex
  // on an empty canvas doesn't snap the camera to it. This explicit nonce
  // avoids `<ReactFlow fitView>`'s stale queued fit on empty graphs.
  useEffect(() => {
    if (fitViewNonce === 0) return;
    reactFlow.fitView({ duration: 400 });
  }, [fitViewNonce, reactFlow]);

  useKeyboardShortcuts({ onCompute: compute.requestCompute });

  // Auto save. `save()` persists `title` too, so title changes must also
  // reset the debounce (not just node/edge changes).
  useEffect(() => {
    if (!hasHydrated) return;

    const timeout = window.setTimeout(() => {
      useGraphStore.getState().save();
    }, 2000);

    return () => window.clearTimeout(timeout);
  }, [nodes, edges, title, hasHydrated]);


  const handlePaneClick = useCallback(
    (event: React.MouseEvent) => {
      if (mode === EDITOR_MODES.addVertex) {
        const position = reactFlow.screenToFlowPosition({
          x: event.clientX,
          y: event.clientY,
        });

        addVertexAt(position);
        return;
      }

      if (mode === EDITOR_MODES.addEdge) {
        // Empty-pane click in add-edge mode cancels the pending source list.
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
        // Shift+drag becomes a box-select that sweeps vertices into the pending
        // source list (handled in onSelectionEnd). selectionKeyCode is already
        // 'Shift', so we only flip selectionOnDrag on for add-edge mode.
        selectionOnDrag={mode === EDITOR_MODES.addEdge}
        onSelectionEnd={handleSelectionEnd}
        nodesConnectable={false}
        defaultViewport={{ x: 0, y: 0, zoom: 2 }}
      >
        <Background variant={BackgroundVariant.Dots} gap={GRID_SIZE} size={1} />
        <Controls />
        <MiniMap />
      </ReactFlow>

      <GraphToolbar onCompute={compute.requestCompute} />
      <VertexTypeMenu />
      <VertexPropertyPanel />

      <ConfirmationDialog
        isOpen={confirmDialogue !== null}
        title={confirmDialogue?.title ?? ""}
        message={confirmDialogue?.message ?? ""}
        confirmText={confirmDialogue?.confirmText ?? "Confirm"}
        cancelText={confirmDialogue?.cancelText ?? "Cancel"}
        confirmButtonClassName={confirmDialogue?.confirmButtonClassName}
        onConfirm={() => {
          // Snapshot the action before closeConfirm nulls out the dialogue.
          const action = confirmDialogue?.onConfirm;
          closeConfirm();
          action?.();
        }}
        onCancel={closeConfirm}
      />

      <HelpDialog
        isOpen={isHelpOpen}
        onClose={closeHelp}
        onShowIntro={openIntro}
      />

      <IntroGuideDialog isOpen={isIntroOpen} onClose={closeIntro} />

      <ExportDialog isOpen={isExportOpen} onClose={closeExport} />

      <GraphPropertiesDialog
        isOpen={isPropertiesOpen}
        onClose={closeProperties}
      />

      <ComputeResultDialog
        key={`compute-${compute.computeSeq}`}
        isOpen={compute.computeOpen}
        onClose={compute.closeCompute}
        computePromise={compute.computePromise}
        progress={compute.progress}
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

