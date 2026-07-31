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
  // `rotation` lives on the runtime node (not in `data` — it's a view
  // field), so we read it through the store with a per-id selector.
  // Returning a primitive keeps re-renders cheap: this component only
  // re-renders when *its* rotation actually changes.
  //
  // The selector body uses the memoized `nodesById` map (O(1) lookup)
  // rather than `nodes.find(...)` — the latter made every drag O(n²)
  // because the selector runs on every store update for every mounted
  // vertex.
  const rotation = useGraphStore(
    (state) => nodesById(state.nodes).get(id)?.rotation ?? 0,
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

  // Ref into the label editor so the outer-div double-click handler
  // (below) can request editing on its behalf. The inner <span>'s
  // own onDoubleClick only fires when the click lands directly on
  // the span/glyph — that misses all the cases where the user
  // double-clicks the body background (which is most of the visible
  // body for empty-label vertices like W / Z / X / H, where there's
  // no glyph to fill the box). The outer-div handler catches every
  // double-click that bubbles up from anywhere inside the vertex.
  const labelEditorRef = useRef<VertexLabelEditorHandle>(null);

  return (
    <div
      className="relative"
      onDoubleClick={(event) => {
        // Stop React Flow's pane-level double-click from also firing
        // (it would otherwise reset the viewport).
        event.stopPropagation();
        labelEditorRef.current?.startEditing();
      }}
    >
      {/* Order badge for boundary vertices (input / output). Placed in
          the OUTER non-rotated wrapper (not the inner rotated one) so it
          stays screen-upright at any rotation — a number that spins with
          the vertex would be unreadable. Rendered only when `order` is a
          finite number; legacy docs with unset `order` still show the
          node itself, just without a (potentially misleading) number.
          `pointer-events-none` keeps clicks/drags routed to the body and
          React Flow. Input pins top-left (it clusters at the left canvas
          edge), output pins top-right — mirrors the blue/green palette
          already used for these types. */}
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
