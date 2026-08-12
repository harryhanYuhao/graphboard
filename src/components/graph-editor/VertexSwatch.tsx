// src/components/graph-editor/VertexSwatch.tsx
//
// Visual chip mirroring a vertex's shape/color/glyph. Shared between the
// add-vertex menu and the property panel to stay in sync with VERTEX_TYPES.

import {
  TRIANGLE_CLIP_PATH,
  type VertexTypeMeta,
} from "@/lib/graph/vertex-registry";

export function VertexSwatch({ meta }: { meta: VertexTypeMeta }) {
  return (
    <div
      className={[
        // Triangles are clipped to their silhouette, so a CSS border (which
        // would draw outside the clipped shape) is skipped for them.
        "h-5 w-5 shrink-0 flex items-center justify-center",
        meta.isTriangle ? "" : "border",
        meta.radiusClass,
        meta.className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ clipPath: meta.isTriangle ? TRIANGLE_CLIP_PATH : undefined }}
    >
      {/* Default glyph, or fallback text. `h-full w-full` fills the swatch. */}
      <span className="block h-full w-full">
        {meta.glyph ?? meta.defaultPhase}
      </span>
    </div>
  );
}
