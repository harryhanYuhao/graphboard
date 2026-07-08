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
  FileDown,
} from "lucide-react";
import { useStore } from "zustand";
import { useGraphStore } from "@/store/graph-store";
import type { EditorMode } from "@/lib/graph/types";

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
  const hasClipboard = useGraphStore(
    (state) => state.clipboard !== null && state.clipboard.nodes.length > 0,
  );

  const canUndo = useStore(useGraphStore.temporal, (state) => state.pastStates.length > 0);
  const canRedo = useStore(useGraphStore.temporal, (state) => state.futureStates.length > 0);

  const setEditorMode = (nextMode: EditorMode) => {
    setMode(nextMode);
  };


  return (
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
        title="Select"
        active={mode === "select"}
        onClick={() => setEditorMode("select")}
      >
        <MousePointer2 size={18} />
      </ToolbarButton>

      <ToolbarButton
        title="Add vertex"
        active={mode === "add-vertex"}
        onClick={() => setEditorMode("add-vertex")}
      >
        <PlusCircle size={18} />
      </ToolbarButton>

      <ToolbarButton
        title="Add edge"
        active={mode === "add-edge"}
        onClick={() => setEditorMode("add-edge")}
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

      <ToolbarButton title="Delete selected" onClick={deleteSelected}>
        <Trash2 size={18} />
      </ToolbarButton>

      <div className="mx-1 h-6 w-px bg-slate-200" />

      <ToolbarButton title="Save" onClick={save}>
        <Save size={18} />
      </ToolbarButton>

      <ToolbarButton
        title="Import JSON"
        onClick={() => {
          void importJson();
        }}
      >
        <FileDown size={18} />
      </ToolbarButton>

      <ToolbarButton
        title="Export JSON"
        onClick={() => {
          void exportJson();
        }}
      >
        <FolderInput size={18} />
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
  );
}
