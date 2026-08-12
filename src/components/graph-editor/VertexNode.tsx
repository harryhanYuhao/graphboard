"use client";

import { type NodeProps } from "@xyflow/react";
import { useRef } from "react";
import {
  DEFAULT_LABEL_LOCATION,
  EDITOR_MODES,
  type VertexNode as VertexNodeType,
} from "@/lib/graph/types";
import {
  DEFAULT_VERTEX_TYPE,
  TRIANGLE_CLIP_PATH,
  VERTEX_TYPE_MAP,
  isBoundaryVertex,
  isDirectionalVertex,
} from "@/lib/graph/vertex-registry";
import { useGraphStore } from "@/store/graph-store";
import { nodesById } from "@/store/selectors";
import { useKatexReady } from "@/lib/hooks/useKatexReady";
import { renderLabel } from "@/lib/label/renderLabel";
import { VertexHandles } from "./VertexHandles";
import {
  VertexLabelEditor,
  type VertexLabelEditorHandle,
} from "./VertexLabelEditor";

// Stable empty-array ref for the no-error case so the Zustand selector
// returns the same reference and skips re-renders when unrelated vertices'
// errors change.
const NO_ERRORS: readonly never[] = [];

export function VertexNode({
  id,
  data,
  selected,
}: NodeProps<VertexNodeType>) {
  const mode = useGraphStore((state) => state.mode);
  const pendingEdgeSources = useGraphStore(
    (state) => state.pendingEdgeSources,
  );
  const updateVertexPhase = useGraphStore((state) => state.updateVertexPhase);
  // `rotation`, `label`, and `labelLocation` are view fields on the runtime
  // node, read via the memoized `nodesById` map so the primitive returns only
  // re-render on change.
  const rotation = useGraphStore(
    (state) => nodesById(state.nodes).get(id)?.rotation ?? 0,
  );
  const visualLabel = useGraphStore(
    (state) => nodesById(state.nodes).get(id)?.label ?? "",
  );
  const labelLocation = useGraphStore(
    (state) =>
      nodesById(state.nodes).get(id)?.labelLocation ?? DEFAULT_LABEL_LOCATION,
  );
  // This vertex's validation errors (from the last compute). The stable
  // `NO_ERRORS` ref keeps the no-error case from re-rendering on unrelated
  // error changes.
  const errors = useGraphStore(
    (state) => state.validationErrors[id] ?? NO_ERRORS,
  );

  const isPendingEdgeSource = pendingEdgeSources.includes(id);

  const meta = VERTEX_TYPE_MAP[data.vertexType] ?? VERTEX_TYPE_MAP[DEFAULT_VERTEX_TYPE];
  const isDirectional = isDirectionalVertex(data.vertexType);

  // CSS borders don't follow a clip-path silhouette; a drop-shadow respects
  // the clipped alpha shape, so it works uniformly across all shapes.
  // Validation errors take precedence (red) over selected/pending.
  const highlightFilter = errors.length > 0
    ? "drop-shadow(0 0 4px rgb(220 38 38))"
    : isPendingEdgeSource
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

  // A vertex "has content" if it has a user phase or a type default glyph;
  // the body grows when it does to give the phase/glyph room.
  const hasContent = data.phase !== "" || meta.glyph != null;
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
                : "right-0 translate-x-1/2 translate-y-3 bg-green-600",
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
              value={data.phase}
              glyph={meta.glyph}
              canStartEditing={
                mode === EDITOR_MODES.select || mode === EDITOR_MODES.addVertex
              }
              onCommit={(phase) => updateVertexPhase(id, phase)}
            />
          </div>
        </div>
      </div>

      {/* On-canvas error text. Outside the rotated wrapper so it stays
          readable at any rotation. Below the body, pointer-events-none so
          it never intercepts canvas clicks/drags. */}
      {errors.length > 0 && (
        <div className="pointer-events-none absolute left-1/2 top-full z-10 mt-1 max-w-[10rem] -translate-x-1/2 text-center text-[10px] leading-tight text-red-600">
          {errors.map((e, i) => (
            <div key={i} className="break-words">
              {e.message}
            </div>
          ))}
        </div>
      )}

      {/* Visual annotation label (view slice; KaTeX-enabled). Outside the
          rotated wrapper so it stays screen-upright at any rotation, and
          pointer-events-none so it never intercepts canvas interactions. */}
      {visualLabel !== "" && labelLocation !== "none" && (
        <VisualVertexLabel
          value={visualLabel}
          labelLocation={labelLocation}
        />
      )}
    </div>
  );
}

// Position the visual label relative to the node body. `labelLocation` picks
// which side; each class combo pins one edge of the label chip to the node.
const LABEL_LOCATION_CLASSES: Record<string, string> = {
  top: "bottom-full left-1/2 mb-1 -translate-x-1/2",
  bottom: "top-full left-1/2 mt-1 -translate-x-1/2",
  left: "right-full top-1/2 mr-1 -translate-y-1/2",
  right: "left-full top-1/2 ml-1 -translate-y-1/2",
};

function VisualVertexLabel({
  value,
  labelLocation,
}: {
  value: string;
  labelLocation: string;
}) {
  // Re-render once the lazy-loaded KaTeX chunk resolves so a LaTeX label
  // upgrades from escaped text to rendered math.
  useKatexReady();
  const rendered = renderLabel(value);

  return (
    <div
      className={[
        "pointer-events-none absolute z-10 whitespace-nowrap rounded border border-slate-300 bg-white/90 px-1 py-px text-[10px] leading-tight text-slate-700 shadow-sm",
        LABEL_LOCATION_CLASSES[labelLocation] ?? LABEL_LOCATION_CLASSES.top,
      ].join(" ")}
      // `renderLabel` is XSS-safe (escaped text; KaTeX `trust: false`).
      dangerouslySetInnerHTML={{ __html: rendered.html }}
    />
  );
}
