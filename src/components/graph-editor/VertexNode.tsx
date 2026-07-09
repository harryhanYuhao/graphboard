"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { useRef, useState } from "react";
import type { VertexNode as VertexNodeType } from "@/lib/graph/types";
import {
  DEFAULT_VERTEX_TYPE,
  TRIANGLE_CLIP_PATH,
  VERTEX_TYPE_MAP,
} from "@/lib/graph/vertex-types";
import { useGraphStore } from "@/store/graph-store";

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
  const isTriangle = meta.shape === "triangle";

  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(data.label);
  const inputRef = useRef<HTMLInputElement>(null);

  const shapeRadius =
    {
      circle: "rounded-full",
      square: "rounded-sm",
      triangle: "",
    }[meta.shape] ?? "";

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
    shapeRadius,
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

  const handleClassName = "!absolute !left-1/2 !top-1/2 !-translate-x-1/2 !-translate-y-1/2 !-rounded-full !border-0 !bg-transparent";

  function startEditing() {
    if (mode !== "select" && mode !== "add-vertex") return;
    setDraft(data.label);
    setIsEditing(true);
  }

  function commitEdit() {
    // Always commit, including the empty string 
    updateVertexLabel(id, draft.trim());
    setIsEditing(false);
  }

  function cancelEdit() {
    setDraft(data.label);
    setIsEditing(false);
  }

  return (
    <div
      className="relative"
      onDoubleClick={(event) => {
        event.stopPropagation();
        startEditing();
      }}
    >
      <Handle
        type="target"
        position={Position.Top}
        id="center-target"
        className={handleClassName}
        style={{ width: dimension, height: dimension }}
      />

      <Handle
        type="source"
        position={Position.Bottom}
        id="center-source"
        className={handleClassName}
        style={{ width: dimension, height: dimension }}
      />

      <div
        className={className}
        style={{
          width: dimension,
          height: dimension,
          clipPath: isTriangle ? TRIANGLE_CLIP_PATH : undefined,
          filter: highlightFilter,
          // Rotate the body around its own center. Handles stay at the
          // (un-rotated) top/bottom edges so connection points don't
          // move — typical graph-editor convention for a visual
          // rotation of the decoration without disturbing the
          // graph-theoretic connection geometry.
          transform: rotation ? `rotate(${rotation}deg)` : undefined,
          transformOrigin: "center",
        }}
      >
        {isEditing ? (
          <input
            ref={inputRef}
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                inputRef.current?.blur();
              } else if (e.key === "Escape") {
                e.preventDefault();
                cancelEdit();
              }
            }}
            className="w-full bg-transparent text-center text-inherit outline-none"
            style={{ fontSize: "inherit" }}
          />
        ) : data.label ? (
          // User has typed a custom label — show it. The type's
          // default glyph is intentionally hidden in this state;
          // clearing the label reveals the glyph again.
          <span>{data.label}</span>
        ) : (
          // No user label — show the type's default glyph (e.g. the
          // And gate's SVG Λ) so the body has something inside.
          // `h-full w-full` on the SVG lets it fill the body box
          // uniformly regardless of the type's `size` or label
          // length.
          meta.glyph
        )}
      </div>
    </div>
  );
}
