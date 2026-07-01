// src/components/graph-editor/VertexNode.tsx

"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { VertexNode as VertexNodeType } from "@/lib/graph/types";

export function VertexNode({ data, selected }: NodeProps<VertexNodeType>) {
  return (
    <div className="relative h-12 w-12">
      <Handle
        type="target"
        position={Position.Top}
        id="center-target"
        className="!absolute !left-1/2 !top-1/2 !h-12 !w-12 !-translate-x-1/2 !-translate-y-1/2 !rounded-full !border-0 !bg-transparent"
      />

      <Handle
        type="source"
        position={Position.Bottom}
        id="center-source"
        className="!absolute !left-1/2 !top-1/2 !h-12 !w-12 !-translate-x-1/2 !-translate-y-1/2 !rounded-full !border-0 !bg-transparent"
      />

      <div
        className={[
          "pointer-events-none flex h-12 w-12 items-center justify-center rounded-full border-2 bg-white text-sm font-semibold shadow-sm",
          selected ? "border-blue-600 ring-2 ring-blue-200" : "border-slate-900",
        ].join(" ")}
      >
        <span></span>
      </div>
    </div>
  );
}
