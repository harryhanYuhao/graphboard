"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { VertexNode as VertexNodeType } from "@/lib/graph/types";
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

  return (
    <div
      className="relative h-12 w-12"
      onClick={(event) => {
        if (mode !== "add-edge") return;

        event.stopPropagation();
        handleVertexClick(id);
      }}
    >
      <Handle
        type="target"
        position={Position.Top}
        id="center-target"
        isConnectable={mode === "add-edge"}
        className="!absolute !left-1/2 !top-1/2 !h-12 !w-12 !-translate-x-1/2 !-translate-y-1/2 !rounded-full !border-0 !bg-transparent"
      />

      <Handle
        type="source"
        position={Position.Bottom}
        id="center-source"
        isConnectable={mode === "add-edge"}
        className="!absolute !left-1/2 !top-1/2 !h-12 !w-12 !-translate-x-1/2 !-translate-y-1/2 !rounded-full !border-0 !bg-transparent"
      />

      <div
        className={[
          "pointer-events-none flex h-12 w-12 items-center justify-center rounded-full border-2 bg-white text-sm font-semibold shadow-sm",
          selected ? "border-blue-600 ring-2 ring-blue-200" : "border-slate-900",
          isPendingEdgeSource ? "ring-4 ring-amber-300" : "",
        ].join(" ")}
      >
        <span>{data.label}</span>
      </div>
    </div>
  );
}