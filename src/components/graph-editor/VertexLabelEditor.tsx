// src/components/graph-editor/VertexLabelEditor.tsx
//
// Double-click-to-edit interaction for a vertex label; owns its own editing
// and draft state. The parent gates editing via `canStartEditing` (typically
// select/add-vertex modes only). When the label is empty the parent's `glyph`
// is shown instead. The imperative `startEditing` handle lets the parent
// trigger edits from double-clicks that land on the body background.

"use client";

import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from "react";
import type { ReactNode } from "react";
import { renderLabel } from "@/lib/label/renderLabel";
import { useKatexReady } from "@/lib/hooks/useKatexReady";

export type VertexLabelEditorProps = {
  value: string;
  // Default content shown when `value` is empty (parent's glyph element).
  glyph: ReactNode;
  /** Called with the trimmed label when the user commits (Enter / blur). */
  onCommit: (label: string) => void;
  /** Whether the editor should accept a start-editing gesture (parent-gated). */
  canStartEditing: boolean;
};

// Lets the parent request "start editing" from outside this subtree — the
// inner span's onDoubleClick only catches direct hits on the label/glyph.
export type VertexLabelEditorHandle = {
  startEditing: () => void;
};

export const VertexLabelEditor = forwardRef<
  VertexLabelEditorHandle,
  VertexLabelEditorProps
>(function VertexLabelEditor(
  { value, glyph, onCommit, canStartEditing },
  ref,
) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  // Re-render once the lazy-loaded KaTeX chunk resolves so a LaTeX label
  // upgrades from escaped text to rendered math.
  useKatexReady();

  const startEditing = useCallback(() => {
    if (!canStartEditing) return;
    // Ignore a re-entrant double-click while already editing so the draft in
    // flight isn't clobbered.
    if (isEditing) return;
    setDraft(value);
    setIsEditing(true);
  }, [canStartEditing, isEditing, value]);

  // Expose `startEditing` so the parent can trigger edits from anywhere.
  useImperativeHandle(ref, () => ({ startEditing }), [startEditing]);

  function commit() {
    // Committing the empty string reveals the parent's default glyph.
    onCommit(draft.trim());
    setIsEditing(false);
  }

  function cancel() {
    setDraft(value);
    setIsEditing(false);
  }

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            inputRef.current?.blur();
          } else if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
        }}
        className="w-full bg-transparent text-center text-inherit outline-none"
        style={{ fontSize: "inherit" }}
      />
    );
  }

  // User has a custom label — render it. `renderLabel` is XSS-safe (plain text
  // is escaped; LaTeX uses `trust: false`); we use `dangerouslySetInnerHTML`
  // only because KaTeX output is HTML.
  if (value) {
    const rendered = renderLabel(value);
    return (
      <span
        onDoubleClick={startEditing}
        dangerouslySetInnerHTML={{ __html: rendered.html }}
      />
    );
  }

  // No user label — show the type's default glyph. Wrapped in a span so the
  // double-click target matches the label-rendered path.
  return <span onDoubleClick={startEditing}>{glyph}</span>;
});