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
        "h-5 w-5 shrink-0 flex item-center justify-center border-1",
        isTriangle ? "" : "border",
        shapeRadius,
        meta.className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ clipPath: isTriangle ? TRIANGLE_CLIP_PATH : undefined }}
    >
      <span className="text-justify">{meta.defaultText}</span>
    </div>
  );
}
