// src/components/graph-editor/VertexGlyphs.tsx
//
// SVG glyphs used as the default visual content for specific vertex
// types. See `VERTEX_TYPES[*].glyph` in `@/lib/graph/vertex-types.ts`.
// A glyph is a regular React element stored on the type meta, so any
// renderer that knows how to drop in a `ReactNode` (the live vertex
// body, the type-menu swatch, the property-panel swatch) gets the
// default visual for free.
//
// The "and" gate originally used the Λ (U+039B, GREEK CAPITAL LETTER
// LAMBDA) character rendered as text. That character is missing or
// visually inconsistent on systems without a font that ships the
// Greek block, so the user reported the gate's interior rendering
// differently across machines. An inline SVG that draws the shape
// with `stroke="currentColor"` sidesteps the font dependency
// entirely and inherits the surrounding text color, so the swatch
// and the live vertex stay color-consistent.

import type { ReactElement } from "react";

// Logical AND (∧), drawn as two diagonals meeting at the top center.
//
// Sizing: `viewBox="0 0 100 100"` + `className="h-full w-full"` lets
// the glyph fill whatever container it's placed in, scaling
// uniformly whether the body is the small 1rem swatch or the larger
// 1.4rem live vertex body.
//
// Stroke: `currentColor` inherits the surrounding text color, so the
// glyph takes the same color as the rest of the vertex body
// (Tailwind `text-slate-900` for the And gate). `strokeLinecap`
// `round` softens the open ends to match the rounded feel of the
// other ZXW generator shapes.
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
