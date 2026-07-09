// src/components/graph-editor/VertexLabelEditor.tsx
//
// The double-click-to-edit interaction for a vertex label. Owns its
// own editing / draft state and the input element. The parent decides
// when editing is allowed (typically: only in select / add-vertex
// modes — outside those, double-click is a no-op so the gesture
// doesn't fight React Flow's own double-click-to-reset-view).
//
// When the label is empty, the parent's `glyph` (e.g. the And gate's
// SVG Λ) is shown instead — see `VertexNode` for the wiring. Clearing
// the label reveals the glyph again.

"use client";

import { useRef, useState } from "react";
import type { ReactNode } from "react";

export type VertexLabelEditorProps = {
  value: string;
  // Default visual content shown when `value` is empty. The parent's
  // own glyph (e.g. an SVG) is used; we don't render any fallback
  // text here so the empty case can be a fully-rendered element.
  glyph: ReactNode;
  // Called with the trimmed label when the user commits (Enter / blur).
  onCommit: (label: string) => void;
  // Whether the editor should accept a start-editing gesture. The
  // parent typically gates this on the current editor mode.
  canStartEditing: boolean;
};

export function VertexLabelEditor({
  value,
  glyph,
  onCommit,
  canStartEditing,
}: VertexLabelEditorProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  function startEditing() {
    if (!canStartEditing) return;
    setDraft(value);
    setIsEditing(true);
  }

  function commit() {
    // Always commit, including the empty string — clearing the label
    // reveals the parent's default glyph again.
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

  // User has typed a custom label — show it. The type's default
  // glyph is intentionally hidden in this state; clearing the label
  // reveals the glyph again.
  if (value) {
    return <span onDoubleClick={startEditing}>{value}</span>;
  }

  // No user label — show the type's default glyph (e.g. the And
  // gate's SVG Λ) so the body has something inside. `h-full w-full`
  // on the SVG lets it fill the body box uniformly regardless of
  // the type's `size` or label length.
  // Wrapped in a span so the double-click target matches the
  // label-rendered path.
  return <span onDoubleClick={startEditing}>{glyph}</span>;
}
