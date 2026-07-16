// src/components/graph-editor/useKeyboardShortcuts.ts
//
// Single owner of the editor's window-level keydown handling. The previous
// shape was three separate `useEffect` blocks in `GraphEditor.tsx`, each
// registering its own listener — fine while the surface was small, but
// every new shortcut made the split harder to reason about. This hook
// attaches exactly one listener for the lifetime of the component and
// reads store state via `getState()` so callers don't have to re-subscribe
// the whole editor on every mode/selection change.
//
// Input guard: every shortcut is suppressed when an `<input>` or
// `<textarea>` has focus, so editing a vertex label doesn't accidentally
// trigger a mode switch.

"use client";

import { useEffect } from "react";
import { useReactFlow } from "@xyflow/react";
import { useGraphStore } from "@/store/graph-store";
import { hasSelection } from "@/store/selectors";
import type { VertexType } from "@/lib/graph/types";
import { VERTEX_TYPES } from "@/lib/graph/vertex-types";

function isTypingTarget(target: EventTarget | null): boolean {
  const tag = (target as HTMLElement | null)?.tagName;
  return tag === "INPUT" || tag === "TEXTAREA";
}

export function useKeyboardShortcuts(): void {
  const reactFlow = useReactFlow();

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (isTypingTarget(event.target)) return;

      const mod = event.metaKey || event.ctrlKey;
      const { mode, setMode, deleteSelected, copySelected, paste, cutSelected, clearPendingEdgeSources, selectAll, clearSelection, save, setVertexType, toggleHelp } =
        useGraphStore.getState();

      // ---- Modifier-bearing shortcuts ----
      // Handled before the single-key block so Ctrl+S never collides with
      // a future single-key `s` binding, etc.
      if (mod) {
        const key = event.key.toLowerCase();

        if (key === "a") {
          // Ctrl/Cmd+A — select everything. Suppress the browser's native
          // "select all text" behaviour.
          event.preventDefault();
          selectAll();
          return;
        }

        if (key === "d" && !event.shiftKey) {
          // Ctrl/Cmd+D — duplicate (copy + paste).
          event.preventDefault();
          copySelected();
          paste();
          return;
        }

        if (key === "s") {
          // Ctrl/Cmd+S — save. Suppress the browser's "save page as" dialog.
          event.preventDefault();
          save();
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

        // Other modifier-bearing keys: leave alone so the browser can do
        // its thing (e.g. Ctrl+F find-in-page).
        return;
      }

      // ---- Single-key shortcuts ----
      //
      // Lowercase the key so Shift (and caps lock) doesn't silently
      // disable a binding — the modifier block above already handles
      // every Shift-prefixed shortcut, so plain `S`, `Shift+S`, and
      // caps-lock `S` all reach the same mode switch.
      switch (event.key.toLowerCase()) {
        case "s":
          setMode("select");
          return;
        case "v":
          setMode("add-vertex");
          return;
        case "e":
          setMode("add-edge");
          return;
        case "f":
          // Fit view to all nodes/edges — handy for getting back to the
          // canvas after panning off into the void.
          reactFlow.fitView({ padding: 0.1, duration: 200 });
          return;
        case "?":
          // Toggle the keyboard-shortcuts help dialog. Works regardless of
          // the current editor mode, including add-vertex (where the
          // default branch below would otherwise try to parse it as a
          // vertex-type index).
          toggleHelp();
          return;
        case "backspace":
        case "delete":
          deleteSelected();
          return;
        case "escape": {
          // Three-step escape ladder, applied top-down:
          //   1. If there are pending edge sources, clear those.
          //   2. Otherwise, if anything is selected, clear selection.
          //   3. Otherwise, if we're not in select mode, snap back to it.
          const state = useGraphStore.getState();
          if (state.pendingEdgeSources.length > 0) {
            clearPendingEdgeSources();
            return;
          }
          if (hasSelection(state.nodes, state.edges)) {
            clearSelection();
            return;
          }
          if (state.mode !== "select") {
            setMode("select");
          }
          return;
        }
        default: {
          // Vertex-type number shortcuts: only meaningful while placing
          // vertices. `1` selects the first entry in VERTEX_TYPES, `2` the
          // second, etc. No-op if the number is out of range — but we
          // also guard on `mode` so users can press e.g. `0` in other
          // modes without surprise.
          if (mode !== "add-vertex") return;

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
