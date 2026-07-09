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
//
// The inner `<span>` here still carries `onDoubleClick` as the
// semantic trigger ("double-click the editor to edit it") — the unit
// tests pin that surface. `VertexNode` additionally wires
// `onDoubleClick` on its own outer div so clicks that land on the
// body background (where there's no glyph/text to receive the event)
// still reach the editor via the imperative handle exposed below.

"use client";

import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from "react";
import type { ReactNode } from "react";
import { renderLabel } from "@/lib/label/renderLabel";

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

// Imperative surface for the parent to request "start editing now"
// from somewhere *outside* this component's DOM subtree. The inner
// span's own onDoubleClick only catches clicks that land directly
// on the label/glyph; clicks on the body background or on the React
// Flow Handle overlays would otherwise miss it (events bubble up
// the DOM, never down). See VertexNode.tsx for the wiring.
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

  const startEditing = useCallback(() => {
    // Gate on mode / capability first.
    if (!canStartEditing) return;
    // If we're already editing, the user is interacting with the
    // `<input>` (typing, selecting text via double-click, etc.). A
    // stray double-click that bubbles up to the parent's outer-div
    // handler should not reset the draft they're currently typing
    // into — `setDraft(value)` would clobber their in-progress text.
    if (isEditing) return;
    setDraft(value);
    setIsEditing(true);
  }, [canStartEditing, isEditing, value]);

  // Expose `startEditing` so the parent can trigger it from a
  // double-click anywhere on the vertex, not just on the inner span.
  // The callback is stable when its deps don't change, so the handle
  // isn't recreated on every render.
  useImperativeHandle(ref, () => ({ startEditing }), [startEditing]);

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
  //
  // Labels are routed through `renderLabel`, which KaTeX-renders
  // any `$...$` / `$$...$$` content and otherwise returns plain text
  // (HTML-escaped). `renderLabel` is XSS-safe — see its doc comment
  // for the trust / fallback rules. We use `dangerouslySetInnerHTML`
  // here because KaTeX output is HTML, not text; the escape happens
  // upstream.
  if (value) {
    const rendered = renderLabel(value);
    return (
      <span
        onDoubleClick={startEditing}
        dangerouslySetInnerHTML={{ __html: rendered.html }}
      />
    );
  }

  // No user label — show the type's default glyph (e.g. the And
  // gate's SVG Λ) so the body has something inside. `h-full w-full`
  // on the SVG lets it fill the body box uniformly regardless of
  // the type's `size` or label length.
  // Wrapped in a span so the double-click target matches the
  // label-rendered path.
  return <span onDoubleClick={startEditing}>{glyph}</span>;
});