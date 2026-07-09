"use client";

import { type NodeProps } from "@xyflow/react";
import { type VertexNode as VertexNodeType } from "@/lib/graph/types";
import {
  DEFAULT_VERTEX_TYPE,
  TRIANGLE_CLIP_PATH,
  VERTEX_TYPE_MAP,
  isDirectionalVertex,
} from "@/lib/graph/vertex-types";
import { useGraphStore } from "@/store/graph-store";
import { VertexHandles } from "./VertexHandles";
import { VertexLabelEditor } from "./VertexLabelEditor";

export function VertexNode({
  id,
  data,
  selected,
}: NodeProps<VertexNodeType>) {
  const mode = useGraphStore((state) => state.mode);
  const pendingEdgeSources = useGraphStore(
    (state) => state.pendingEdgeSources,
  );
  const updateVertexLabel = useGraphStore((state) => state.updateVertexLabel);
  // `rotation` lives on the runtime node (not in `data` — it's a view
  // field), so we read it through the store with a per-id selector.
  // Returning a primitive keeps re-renders cheap: this component only
  // re-renders when *its* rotation actually changes.
  const rotation = useGraphStore(
    (state) => state.nodes.find((node) => node.id === id)?.rotation ?? 0,
  );

  const isPendingEdgeSource = pendingEdgeSources.includes(id);

  const meta = VERTEX_TYPE_MAP[data.vertexType] ?? VERTEX_TYPE_MAP[DEFAULT_VERTEX_TYPE];
  const isDirectional = isDirectionalVertex(data.vertexType);

  // A CSS border/ring does not follow a clip-path silhouette, so we use a
  // drop-shadow (which respects the clipped alpha shape) to convey the
  // selected / pending-edge-source state uniformly across all shapes.
  const highlightFilter = isPendingEdgeSource
    ? "drop-shadow(0 0 4px rgb(245 158 11))"
    : selected
      ? "drop-shadow(0 0 3px rgb(37 99 235))"
      : undefined;

  const className = [
    "flex items-center justify-center font-semibold shadow-sm",
    meta.radiusClass,
    meta.className,
  ]
    .filter(Boolean)
    .join(" ");

  // Size is applied via inline style. A vertex "has content" if it
  // has a non-empty user label *or* a type-level default glyph
  // (e.g. the And gate's SVG Λ). Without content, the body shrinks
  // to the small size; with content, it grows to give the label /
  // glyph room.
  const hasContent = data.label !== "" || meta.glyph != null;
  const dimension = hasContent
    ? `${meta.size * 0.35}rem`
    : `${meta.size * 0.25}rem`;

  return (
    <div className="relative">
      <VertexHandles isDirectional={isDirectional} dimension={dimension} />

      <div
        style={{
          // The filter lives on this wrapper rather than the body
          // so the drop-shadow is computed against the body's
          // *clipped* silhouette (the triangle for W). When filter
          // and clip-path sit on the same element, the CSS spec
          // applies the filter first and the clip-path second —
          // meaning the shadow is cast around the full rectangle and
          // almost everything outside the triangle gets clipped away
          // before reaching the page. Splitting them onto a wrapper
          // puts the clip-path "before" the filter in the rendering
          // pipeline (parent renders its children first, then the
          // parent's filter sees the already-clipped result), so the
          // shadow follows the actual visible shape. For non-triangle
          // vertices this is a no-op: the body has no clip-path, so
          // the wrapper's filter sees the same content the body
          // would have.
          width: dimension,
          height: dimension,
          filter: highlightFilter,
        }}
      >
        <div
          className={className}
          style={{
            width: "100%",
            height: "100%",
            clipPath: meta.isTriangle ? TRIANGLE_CLIP_PATH : undefined,
            // Rotate the body around its own center. Handles stay at the
            // (un-rotated) top/bottom edges so connection points don't
            // move — typical graph-editor convention for a visual
            // rotation of the decoration without disturbing the
            // graph-theoretic connection geometry.
            transform: rotation ? `rotate(${rotation}deg)` : undefined,
            transformOrigin: "center",
          }}
        >
          <VertexLabelEditor
            value={data.label}
            glyph={meta.glyph}
            canStartEditing={mode === "select" || mode === "add-vertex"}
            onCommit={(label) => updateVertexLabel(id, label)}
          />
        </div>
      </div>
    </div>
  );
}
