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
import { IntroGuideDialog } from "./IntroGuideDialog";
import { ComputeResultDialog } from "./ComputeResultDialog";
import { useKeyboardShortcuts } from "./useKeyboardShortcuts";
import { useCompute } from "@/lib/hooks/useCompute";
import { useGraphStore } from "@/store/graph-store";
import {
  EDGE_TYPES,
  EDITOR_MODES,
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
  const { confirmDialogue, isHelpOpen, isIntroOpen } = useGraphStore(
    useShallow((state) => ({
      confirmDialogue: state.confirmDialogue,
      isHelpOpen: state.isHelpOpen,
      isIntroOpen: state.isIntroOpen,
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
  // Bumps whenever the store replaces the graph (import today, possibly
  // hydrate/load later). We watch it so the view layer can refit the
  // viewport — the store can't call `fitView()` itself because React
  // Flow hooks only work inside a React component under the provider.
  const fitViewNonce = useGraphStore((state) => state.fitViewNonce);

  const reactFlow = useReactFlow<VertexNodeType, GraphEdge>();

  // Compute orchestration (WASM worker, promise/progress state, result
  // dialog) lives in a hook rather than the store — it's a one-shot async
  // computation, not graph state. Both the toolbar button and the
  // Cmd/Ctrl+Enter shortcut call `requestCompute`, and the dialog is
  // rendered here alongside the other top-level modals.
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

  // Refit the viewport after a graph is imported. The store bumps
  // `fitViewNonce` from inside `importJson`; the view layer reacts here.
  // Skip the initial 0 so we don't double-fit on first mount (the
  // `<ReactFlow fitView>` prop already handles that).
  useEffect(() => {
    if (fitViewNonce === 0) return;
    reactFlow.fitView({ duration: 400 });
  }, [fitViewNonce, reactFlow]);

  useKeyboardShortcuts({ onCompute: compute.requestCompute });

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
      if (mode === EDITOR_MODES.addVertex) {
        const position = reactFlow.screenToFlowPosition({
          x: event.clientX,
          y: event.clientY,
        });

        addVertexAt(position);
        return;
      }

      if (mode === EDITOR_MODES.addEdge) {
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
        selectionOnDrag={mode === EDITOR_MODES.addEdge}
        onSelectionEnd={handleSelectionEnd}
        nodesConnectable={false}
        fitView
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} />
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
          // Snapshot the action before closing 
          // closeConfirmDialogue nulls out the dialogue, 
          const action = confirmDialogue?.onConfirm;
          closeConfirm();
          action?.();
        }}
        onCancel={closeConfirm}
      />

      <KeyboardShortcutsDialog
        isOpen={isHelpOpen}
        onClose={closeHelp}
        onShowIntro={openIntro}
      />

      <IntroGuideDialog isOpen={isIntroOpen} onClose={closeIntro} />

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

