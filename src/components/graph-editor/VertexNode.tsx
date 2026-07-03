"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
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
  const pendingEdgeSourceId = useGraphStore((state) => state.pendingEdgeSourceId);
  const handleVertexClick = useGraphStore((state) => state.handleVertexClick);

  const isPendingEdgeSource = pendingEdgeSourceId === id;

  const meta = VERTEX_TYPE_MAP[data.vertexType] ?? VERTEX_TYPE_MAP[DEFAULT_VERTEX_TYPE];
  const isTriangle = meta.shape === "triangle";

  const shapeRadius =
    {
      circle: "rounded-full",
      square: "rounded-md",
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
    isTriangle ? "pt-3 text-[10px]" : "border-2 text-sm",
    shapeRadius,
    meta.className,
    `w-${meta.size}`,
    `h-${meta.size}`,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className="relative"
      onClick={(event) => {
        if (mode !== "add-edge") return;

        event.stopPropagation();
        handleVertexClick(id);
      }}
    >
      <Handle
        type="target"
        // position={Position.Top}
        id="center-target"
        isConnectable={mode === "add-edge"}
        className={`!absolute !left-1/2 !top-1/2 !h-${meta.size} !w-${meta.size} !-translate-x-1/2 !-translate-y-1/2 !rounded-full !border-0 !bg-transparent`}
      />

      <Handle
        type="source"
        // position={Position.Bottom}
        id="center-source"
        isConnectable={mode === "add-edge"}
        className={`!absolute !left-1/2 !top-1/2 !h-${meta.size} !w-${meta.size} !-translate-x-1/2 !-translate-y-1/2 !rounded-full !border-0 !bg-transparent`}
      />

      <div
        className={className}
        style={{
          clipPath: isTriangle ? TRIANGLE_CLIP_PATH : undefined,
          filter: highlightFilter,
        }}
      >
        <span>{data.label}</span>
      </div>
    </div>
  );
}
