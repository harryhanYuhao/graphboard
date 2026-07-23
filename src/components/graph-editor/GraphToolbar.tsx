// src/components/graph-editor/GraphToolbar.tsx

"use client";

import {
  Clipboard,
  Copy,
  GitBranch,
  MousePointer2,
  PlusCircle,
  Redo2,
  Save,
  Scissors,
  Trash2,
  OctagonX,
  Undo2,
  FolderInput,
  FolderOutput,
  CircleQuestionMark,
  Calculator,
} from "lucide-react";
import { useRef, useState } from "react";
import { useStore } from "zustand";
import { useGraphStore } from "@/store/graph-store";
import { ComputeResultDialog } from "./ComputeResultDialog";
import { computeTensor, type ComputeCallbacks } from "@/lib/compute";
import type { TensorResult } from "@/lib/compute/result-types";
import { projectDocument } from "@/lib/graph/serialization";
import { EDITOR_MODES, PERSISTED_IDS } from "@/lib/graph/types";

function ToolbarButton(props: {
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title: string;
}) {
  return (
    <button
      type="button"
      title={props.title}
      onClick={props.onClick}
      disabled={props.disabled}
      className={[
        "inline-flex h-9 w-9 items-center justify-center rounded-md border text-sm",
        props.disabled
          ? "border-slate-200 bg-slate-50 text-slate-300 cursor-not-allowed"
          : props.active
            ? "border-slate-900 bg-slate-900 text-white"
            : "border-slate-300 bg-white text-slate-900 hover:bg-slate-100",
      ].join(" ")}
    >
      {props.children}
    </button>
  );
}

export function GraphToolbar() {
  const mode = useGraphStore((state) => state.mode);
  const setMode = useGraphStore((state) => state.setMode);
  const save = useGraphStore((state) => state.save);
  const exportJson = useGraphStore((state) => state.exportJson);
  const importJson = useGraphStore((state) => state.importJson);
  const openResetConfirm = useGraphStore((state) => state.openConfirmDialogue);
  const closeResetConfirm = useGraphStore((state) => state.closeConfirmDialogue);
  const deleteSelected = useGraphStore((state) => state.deleteSelected);
  const reset = useGraphStore((state) => state.reset);
  const copySelected = useGraphStore((state) => state.copySelected);
  const cutSelected = useGraphStore((state) => state.cutSelected);
  const paste = useGraphStore((state) => state.paste);
  const openHelp = useGraphStore((state) => state.openHelp);
  const hasClipboard = useGraphStore(
    (state) => state.clipboard !== null && state.clipboard.nodes.length > 0,
  );

  const canUndo = useStore(useGraphStore.temporal, (state) => state.pastStates.length > 0);
  const canRedo = useStore(useGraphStore.temporal, (state) => state.futureStates.length > 0);

  // Compute dialog state lives here (mirrors how RESET owns its confirm
  // dialog inline). The button kicks off the contraction; the resulting
  // promise + progress state feeds the dialog as controlled props.
  const [computeOpen, setComputeOpen] = useState(false);
  const [computePromise, setComputePromise] = useState<
    Promise<TensorResult> | null
  >(null);
  const [computeProgress, setComputeProgress] = useState<{
    contracted: number;
    total: number;
  } | null>(null);
  // `key` derived from an open-counter forces the dialog to remount on
  // each Compute click, resetting its internal ok/error state cleanly.
  const [computeSeq, setComputeSeq] = useState(0);
  // Keep the AbortController in a ref so the dialog can cancel via a
  // callback that closes over the *current* controller, not a stale
  // state capture.
  const abortRef = useRef<AbortController | null>(null);

  const handleCompute = () => {
    // Read snapshot of the current graph from the store and project to
    // the persisted `GraphSlice` shape the compute layer expects. We
    // use `useGraphStore.getState()` rather than reactive reads
    // because we want the state *at click time*, not on every change.
    const state = useGraphStore.getState();
    const doc = projectDocument({
      id: PERSISTED_IDS.localDocument,
      title: state.title,
      nodes: state.nodes,
      edges: state.edges,
      createdAt: state.createdAt,
      updatedAt: new Date().toISOString(),
    });
    const graph = doc.graph;

    const controller = new AbortController();
    abortRef.current = controller;
    const callbacks: ComputeCallbacks = {
      signal: controller.signal,
      onProgress: (contracted, total) =>
        setComputeProgress({ contracted, total }),
    };

    setComputeProgress({ contracted: 0, total: 0 });
    setComputePromise(computeTensor(graph, callbacks));
    setComputeSeq((n) => n + 1);
    setComputeOpen(true);
  };

  const handleComputeClose = () => {
    // Soft-cancel any in-flight computation when the dialog closes.
    abortRef.current?.abort();
    abortRef.current = null;
    setComputeOpen(false);
    setComputePromise(null);
    setComputeProgress(null);
  };


  return (
    <>
    <ComputeResultDialog
      key={`compute-${computeSeq}`}
      isOpen={computeOpen}
      onClose={handleComputeClose}
      computePromise={computePromise}
      progress={computeProgress}
    />
    <div className="absolute left-4 top-4 z-10 flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-2 shadow-sm">
      <ToolbarButton
        title="Undo (Ctrl+Z)"
        disabled={!canUndo}
        onClick={() => useGraphStore.temporal.getState().undo()}
      >
        <Undo2 size={18} />
      </ToolbarButton>

      <ToolbarButton
        title="Redo (Ctrl+Shift+Z)"
        disabled={!canRedo}
        onClick={() => useGraphStore.temporal.getState().redo()}
      >
        <Redo2 size={18} />
      </ToolbarButton>

      <div className="mx-1 h-6 w-px bg-slate-200" />

      <ToolbarButton
        title="Select (S)"
        active={mode === EDITOR_MODES.select}
        onClick={() => setMode(EDITOR_MODES.select)}
      >
        <MousePointer2 size={18} />
      </ToolbarButton>

      <ToolbarButton
        title="Add vertex (V)"
        active={mode === EDITOR_MODES.addVertex}
        onClick={() => setMode(EDITOR_MODES.addVertex)}
      >
        <PlusCircle size={18} />
      </ToolbarButton>

      <ToolbarButton
        title="Add edge (E)"
        active={mode === EDITOR_MODES.addEdge}
        onClick={() => setMode(EDITOR_MODES.addEdge)}
      >
        <GitBranch size={18} />
      </ToolbarButton>

      <ToolbarButton title="Cut (Ctrl+X)" onClick={cutSelected}>
        <Scissors size={18} />
      </ToolbarButton>

      <ToolbarButton title="Copy (Ctrl+C)" onClick={copySelected}>
        <Copy size={18} />
      </ToolbarButton>

      <ToolbarButton
        title="Paste (Ctrl+V)"
        disabled={!hasClipboard}
        onClick={paste}
      >
        <Clipboard size={18} />
      </ToolbarButton>

      <ToolbarButton title="Delete selected (Del)" onClick={deleteSelected}>
        <Trash2 size={18} />
      </ToolbarButton>

      <ToolbarButton
        title="Keyboard shortcuts (?)"
        onClick={openHelp}
        aria-label="Show keyboard shortcuts"
      >
        <CircleQuestionMark size={18} />
      </ToolbarButton>

      <div className="mx-1 h-6 w-px bg-slate-200" />

      <ToolbarButton title="Save (Ctrl+S)" onClick={save}>
        <Save size={18} />
      </ToolbarButton>

      <ToolbarButton
        title="Import JSON"
        onClick={() => {
          void importJson();
        }}
      >
        <FolderInput size={18} />
      </ToolbarButton>

      <ToolbarButton
        title="Export JSON"
        onClick={() => {
          void exportJson();
        }}
      >
        <FolderOutput size={18} />
      </ToolbarButton>

      <ToolbarButton
        title="Compute tensor"
        onClick={handleCompute}
      >
        <Calculator size={18} />
      </ToolbarButton>

      <ToolbarButton
        title="RESET (Can NOT be undo)"
        onClick={() => {
          openResetConfirm({
            title: "Reset Graph",
            message:
              "Are you sure you want to reset the graph? This will delete all nodes, edges, and the current title. This action cannot be undone.",
            confirmText: "Reset",
            confirmButtonClassName: "bg-red-600 hover:bg-red-700",
            onConfirm: () => {
              closeResetConfirm();
              reset();
            },
          });
        }}>
        <OctagonX size={18} color="#f00707" />
      </ToolbarButton>
    </div>
    </>
  );
}
