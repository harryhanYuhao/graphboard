// src/components/graph-editor/VertexGlyphs.tsx
//
// SVG glyphs that serve as default vertex content. Stored on the type meta
// (`VERTEX_TYPES[*].glyph`), so any renderer taking a ReactNode (vertex body,
// swatches) picks them up. Inline SVG with `stroke="currentColor"` avoids font
// dependencies and inherits the surrounding text color.

import type { ReactElement } from "react";

// Logical AND (∧): two diagonals meeting at the top. `h-full w-full` + a
// 0-100 viewBox scale to any container; `currentColor` matches body text.
export function AndGateGlyph(): ReactElement {
  return (
    <svg
      viewBox="0 0 100 100"
      className="h-full w-full"
      fill="none"
      stroke="currentColor"
      strokeWidth={12}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M 22 78 L 50 22 L 78 78" />
    </svg>
  );
}
