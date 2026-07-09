// src/components/graph-editor/VertexSwatch.tsx
//
// A small visual chip that mirrors the styling of a vertex (shape, color,
// default glyph). Shared between the add-vertex side menu
// (VertexTypeMenu) and the single-vertex property panel so both stay in
// sync with VERTEX_TYPES.

import {
  TRIANGLE_CLIP_PATH,
  type VertexTypeMeta,
} from "@/lib/graph/vertex-types";

export function VertexSwatch({ meta }: { meta: VertexTypeMeta }) {
  const isTriangle = meta.shape === "triangle";

  const shapeRadius =
    meta.shape === "circle"
      ? "rounded-full"
      : meta.shape === "square"
        ? "rounded-md"
        : "";

  return (
    <div
      className={[
        // `border-1` from the previous version isn't a real Tailwind
        // class — the visible border for non-triangle types comes
        // from the conditional `border` below. Triangles are clipped
        // to their silhouette so a CSS border on the box would draw
        // outside the visible shape, hence the explicit skip.
        "h-5 w-5 shrink-0 flex items-center justify-center",
        isTriangle ? "" : "border",
        shapeRadius,
        meta.className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ clipPath: isTriangle ? TRIANGLE_CLIP_PATH : undefined }}
    >
      {/* Render the type's default glyph (e.g. the And gate's SVG Λ)
          when present, otherwise fall back to the default text.
          `block h-full w-full` on the wrapper makes the SVG fill the
          swatch uniformly; the text fallback is unaffected. */}
      <span className="block h-full w-full">
        {meta.glyph ?? meta.defaultText}
      </span>
    </div>
  );
}
