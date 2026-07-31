// src/components/graph-editor/VertexHandles.tsx
//
// The two React Flow handles that anchor a vertex. Directional vertices (W,
// And gate) get a visible top-edge target dot plus a centered bottom source;
// symmetric vertices get a centered target and source. One handle accepts
// many connections, so the bottom source covers multi-output fan-out.

"use client";

import { Handle, Position } from "@xyflow/react";
import { HANDLE_IDS } from "@/lib/graph/types";

// Transparent full-size overlay anchored to body center — used for both ends
// of symmetric vertices and the output of directional ones.
const CENTERED_HANDLE_CLASS_NAME =
  "!absolute !left-1/2 !top-1/2 !-translate-x-1/2 !-translate-y-1/2 !-rounded-full !border-0 !bg-transparent";

// Small visible dot pinned to the body's top edge via `Position.Top`.
const DIRECTIONAL_HANDLE_CLASS_NAME =
  "!absolute !rounded-full !border !border-slate-400 !bg-white";

// Inline dimensions kept separate from the className (rendered as a number).
const DIRECTIONAL_HANDLE_STYLE = { width: "0.4rem", height: "0.4rem" };

export function VertexHandles({
  isDirectional,
  dimension,
}: {
  isDirectional: boolean;
  dimension: string;
}) {
  if (isDirectional) {
    return (
      <>
        <Handle
          type="target"
          position={Position.Top}
          id={HANDLE_IDS.top}
          className={DIRECTIONAL_HANDLE_CLASS_NAME}
          style={DIRECTIONAL_HANDLE_STYLE}
        />
        <Handle
          type="source"
          position={Position.Bottom}
          id={HANDLE_IDS.centerSource}
          className={CENTERED_HANDLE_CLASS_NAME}
          style={{ width: dimension, height: dimension }}
        />
      </>
    );
  }

  return (
    <>
      <Handle
        type="target"
        position={Position.Top}
        id={HANDLE_IDS.centerTarget}
        className={CENTERED_HANDLE_CLASS_NAME}
        style={{ width: dimension, height: dimension }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id={HANDLE_IDS.centerSource}
        className={CENTERED_HANDLE_CLASS_NAME}
        style={{ width: dimension, height: dimension }}
      />
    </>
  );
}
