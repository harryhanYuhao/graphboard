// src/components/graph-editor/useKeyboardShortcuts.ts
//
// Single owner of the editor's window-level keydown handling. Attaches one
// listener for the component's lifetime and reads store state via `getState()`
// so callers don't re-subscribe on every mode/selection change. Every shortcut
// is suppressed while an `<input>`/`<textarea>` has focus. `onCompute` bypasses
// the store (compute orchestration lives in `useCompute`) and reaches it via a
// ref so the single-listener invariant holds across re-renders.

"use client";

import { useEffect, useRef } from "react";
import { useReactFlow } from "@xyflow/react";
import { useGraphStore } from "@/store/graph-store";
import { hasSelection } from "@/store/selectors";
import { EDITOR_MODES, type VertexType } from "@/lib/graph/types";
import { VERTEX_TYPES } from "@/lib/graph/vertex-registry";

export interface KeyboardShortcutOptions {
  onCompute: () => void;
}

function isTypingTarget(target: EventTarget | null): boolean {
  const tag = (target as HTMLElement | null)?.tagName;
  return tag === "INPUT" || tag === "TEXTAREA";
}

export function useKeyboardShortcuts({
  onCompute,
}: KeyboardShortcutOptions): void {
  const reactFlow = useReactFlow();
  // Latest-ref pattern: keep `onCompute` current for the long-lived listener
  // without making it an effect dep (which would re-add the window listener).
  const onComputeRef = useRef(onCompute);
  useEffect(() => {
    onComputeRef.current = onCompute;
  }, [onCompute]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (isTypingTarget(event.target)) return;

      const mod = event.metaKey || event.ctrlKey;
      const { mode, setMode, deleteSelected, copySelected, paste, cutSelected, clearPendingEdgeSources, selectAll, clearSelection, save, setVertexType, toggleHelp, switchAdjacentTab } =
        useGraphStore.getState();

      // Modal dialogs swallow every shortcut except `?` closing help.
      const { isHelpOpen, isIntroOpen, isExportOpen, isPropertiesOpen, confirmDialogue } =
        useGraphStore.getState();
      const anyDialogOpen =
        isHelpOpen ||
        isIntroOpen ||
        isExportOpen ||
        isPropertiesOpen ||
        confirmDialogue !== null;
      if (anyDialogOpen) {
        if (isHelpOpen && !mod && event.key === "?") toggleHelp();
        return;
      }

      // ---- Modifier-bearing shortcuts ----
      // Handled before the single-key block so Ctrl+S never collides with a
      // future single-key `s` binding, etc.
      if (mod) {
        const key = event.key.toLowerCase();

        if (key === "a") {
          // Ctrl/Cmd+A — select all; suppress the browser's text selection.
          event.preventDefault();
          selectAll();
          return;
        }

        if (key === "d" && !event.shiftKey) {
          // Ctrl/Cmd+D — duplicate (copy + paste). Only with a live
          // selection; otherwise `copySelected` keeps the old clipboard
          // and `paste` would resurrect it.
          event.preventDefault();
          const { nodes, edges } = useGraphStore.getState();
          if (hasSelection(nodes, edges)) {
            copySelected();
            paste();
          }
          return;
        }

        if (key === "s") {
          // Ctrl/Cmd+S — save; suppress the browser's "save page as".
          event.preventDefault();
          save();
          return;
        }

        if (key === "enter") {
          // Ctrl/Cmd+Enter — compute (orchestration in `useCompute`).
          event.preventDefault();
          onComputeRef.current();
          return;
        }

        if (key === "c" && !event.shiftKey) {
          event.preventDefault();
          copySelected();
          return;
        }

        if (key === "v" && !event.shiftKey) {
          event.preventDefault();
          paste();
          return;
        }

        if (key === "x" && !event.shiftKey) {
          event.preventDefault();
          cutSelected();
          return;
        }

        if (event.shiftKey && key === "[") {
          // Ctrl/Cmd+Shift+[ — previous tab. Browsers reserve Ctrl+Tab for
          // their own tab switching, so the bracket pair is the tab shortcut.
          event.preventDefault();
          switchAdjacentTab(-1);
          return;
        }

        if (event.shiftKey && key === "]") {
          // Ctrl/Cmd+Shift+] — next tab.
          event.preventDefault();
          switchAdjacentTab(1);
          return;
        }

        if (key === "z" && !event.shiftKey) {
          event.preventDefault();
          useGraphStore.temporal.getState().undo();
          return;
        }

        if ((key === "z" && event.shiftKey) || key === "y") {
          event.preventDefault();
          useGraphStore.temporal.getState().redo();
          return;
        }

        // Other modifier-bearing keys: leave alone for the browser (e.g. Ctrl+F).
        return;
      }

      // ---- Single-key shortcuts ----
      //
      // Lowercase the key so Shift/caps lock doesn't disable a binding; the
      // modifier block above handles every Shift-prefixed shortcut, so plain
      // `S`, `Shift+S`, and caps-lock `S` all reach the same mode switch.
      switch (event.key.toLowerCase()) {
        case "s":
          setMode(EDITOR_MODES.select);
          return;
        case "v":
          setMode(EDITOR_MODES.addVertex);
          return;
        case "e":
          setMode(EDITOR_MODES.addEdge);
          return;
        case "f":
          // Fit view to all nodes/edges.
          reactFlow.fitView({ padding: 0.1, duration: 200 });
          return;
        case "?":
          // Toggle help — handled before the default vertex-type-number branch.
          toggleHelp();
          return;
        case "backspace":
        case "delete":
          deleteSelected();
          return;
        case "escape": {
          // Three-step escape ladder (top-down): pending edge sources →
          // selection → snap back to select mode.
          const state = useGraphStore.getState();
          if (state.pendingEdgeSources.length > 0) {
            clearPendingEdgeSources();
            return;
          }
          if (hasSelection(state.nodes, state.edges)) {
            clearSelection();
            return;
          }
          if (state.mode !== EDITOR_MODES.select) {
            setMode(EDITOR_MODES.select);
          }
          return;
        }
        default: {
          // Vertex-type number shortcuts (only in add-vertex mode): `1` selects
          // the first entry in VERTEX_TYPES, etc. Guarded on `mode` so pressing
          // `0` elsewhere is a no-op.
          if (mode !== EDITOR_MODES.addVertex) return;

          const index = Number.parseInt(event.key, 10);
          if (!Number.isFinite(index) || index < 1) return;

          const next = VERTEX_TYPES[index - 1] as
            | (typeof VERTEX_TYPES)[number]
            | undefined;
          if (next) {
            const nextType = next.type as VertexType;
            setVertexType(nextType);
          }
          return;
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [reactFlow]);
}
