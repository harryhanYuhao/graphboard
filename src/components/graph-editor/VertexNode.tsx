"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { VertexNode as VertexNodeType } from "@/lib/graph/types";

export function VertexNode({ data, selected }: NodeProps<VertexNodeType>) {
  return (
    <div
      className={[
        "flex h-12 w-12 items-center justify-center rounded-full border-2 bg-white text-sm font-semibold shadow-sm",
        selected ? "border-blue-600 ring-2 ring-blue-200" : "border-slate-900",
      ].join(" ")}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!h-2 !w-2 !bg-slate-900"
      />

      <span>{data.label}</span>

      <Handle
        type="source"
        position={Position.Bottom}
        className="!h-2 !w-2 !bg-slate-900"
      />
    </div>
  );
}