"use client";

import { type NodeProps } from "@xyflow/react";
import { useRef } from "react";
import { EDITOR_MODES, type VertexNode as VertexNodeType } from "@/lib/graph/types";
import {
  DEFAULT_VERTEX_TYPE,
  TRIANGLE_CLIP_PATH,
  VERTEX_TYPE_MAP,
  isBoundaryVertex,
  isDirectionalVertex,
} from "@/lib/graph/vertex-types";
import { useGraphStore } from "@/store/graph-store";
import { nodesById } from "@/store/selectors";
import { VertexHandles } from "./VertexHandles";
import {
  VertexLabelEditor,
  type VertexLabelEditorHandle,
} from "./VertexLabelEditor";

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
  // `rotation` is a view field on the runtime node, read via the memoized
  // `nodesById` map so the primitive return only re-renders on change.
  const rotation = useGraphStore(
    (state) => nodesById(state.nodes).get(id)?.rotation ?? 0,
  );

  const isPendingEdgeSource = pendingEdgeSources.includes(id);

  const meta = VERTEX_TYPE_MAP[data.vertexType] ?? VERTEX_TYPE_MAP[DEFAULT_VERTEX_TYPE];
  const isDirectional = isDirectionalVertex(data.vertexType);

  // CSS borders don't follow a clip-path silhouette; a drop-shadow respects
  // the clipped alpha shape, so it works uniformly across all shapes.
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

  // A vertex "has content" if it has a user label or a type default glyph;
  // the body grows when it does to give the label/glyph room.
  const hasContent = data.label !== "" || meta.glyph != null;
  const dimension = hasContent
    ? `${meta.size * 0.35}rem`
    : `${meta.size * 0.25}rem`;

  // Ref into the label editor so the outer-div onDoubleClick can trigger
  // editing; the inner span's own handler only catches clicks that land
  // directly on the label/glyph, not the body background.
  const labelEditorRef = useRef<VertexLabelEditorHandle>(null);

  return (
    <div
      className="relative"
      onDoubleClick={(event) => {
        // Stop React Flow's pane-level double-click (resets the viewport).
        event.stopPropagation();
        labelEditorRef.current?.startEditing();
      }}
    >
      {/* Boundary vertex (input/output) order badge. Placed in the outer
          non-rotated wrapper so the number stays screen-upright at any
          rotation. Input pins top-left, output pins top-right. */}
      {isBoundaryVertex(data.vertexType) &&
        typeof data.order === "number" &&
        Number.isFinite(data.order) && (
          <div
            className={[
              "pointer-events-none absolute top-0 z-10 flex min-w-[0.9rem] items-center justify-center rounded-full px-1 text-[10px] font-bold leading-none text-white ring-2 ring-white",
              data.vertexType === "input"
                ? "left-0 -translate-x-1/2 -translate-y-1/2 bg-blue-600"
                : "right-0 translate-x-1/2 -translate-y-1/2 bg-green-600",
            ].join(" ")}
          >
            {data.order}
          </div>
        )}

      <div
        className="relative"
        style={{
          transform: rotation ? `rotate(${rotation}deg)` : undefined,
          transformOrigin: "center",
        }}
      >
        <VertexHandles isDirectional={isDirectional} dimension={dimension} />

        <div
          style={{
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
            }}
          >
            <VertexLabelEditor
              ref={labelEditorRef}
              value={data.label}
              glyph={meta.glyph}
              canStartEditing={
                mode === EDITOR_MODES.select || mode === EDITOR_MODES.addVertex
              }
              onCommit={(label) => updateVertexLabel(id, label)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
