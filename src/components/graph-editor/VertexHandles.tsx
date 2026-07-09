// src/components/graph-editor/VertexHandles.tsx
//
// The two React Flow `<Handle>`s that anchor a vertex. Directional
// vertices (W, And gate) place a single visible target dot on the
// top edge plus a centered source handle on the bottom; symmetric
// vertices get a centered target and a centered source. A single
// React Flow handle accepts any number of connections, so the
// bottom source handle is reused for W / And gate's many-output
// fan-out without a row of slots.

"use client";

import { Handle, Position } from "@xyflow/react";
import { HANDLE_IDS } from "@/lib/graph/types";

// CSS class for the centered handle — full-size transparent overlay
// anchored to the body center. Used for both ends of symmetric
// vertices and the output end of directional ones.
const CENTERED_HANDLE_CLASS_NAME =
  "!absolute !left-1/2 !top-1/2 !-translate-x-1/2 !-translate-y-1/2 !-rounded-full !border-0 !bg-transparent";

// CSS class for the directional input handle — a small visible dot
// placed on the actual top edge of the body via `Position.Top`.
const DIRECTIONAL_HANDLE_CLASS_NAME =
  "!absolute !rounded-full !border !border-slate-400 !bg-white";

// Inline dimensions for the directional handle. Kept separate from
// the className because the value is rendered as a number (rem).
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
