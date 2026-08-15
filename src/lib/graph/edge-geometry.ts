// src/lib/graph/edge-geometry.ts
//
// Pure geometry + styling for `StraightCenterEdge`. Kept out of the
// component so the rotation math is unit-testable without React Flow
// internals.

import type { CSSProperties } from "react";
import { isDirectionalVertex } from "./vertex-registry";
import { normalizeRotation } from "@/lib/serialisation";
import { DEFAULT_EDGE_KIND, type EdgeKind, type VertexType } from "./types";
import { EDGE_KIND_MAP } from "./edge-registry";

// Inputs to a single edge endpoint. Mirrors React Flow's `useInternalNode`,
// plus our custom `rotation`.
export type EndpointInput = {
  // Top-left of the node in absolute (flow-space) coordinates.
  positionAbsolute: { x: number; y: number };
  // React Flow fills these in after layout.
  width: number;
  height: number;
  vertexType: VertexType | undefined;
  // CSS rotation in degrees (view-slice field). 0 = un-rotated.
  rotation: number;
};

// Where an edge endpoint sits on a node. Directional types (W / And gate)
// anchor *target* on the top edge and *source* one-third down the body (so the
// outgoing fan-out doesn't pile on incoming edges at the center); everything
// else anchors to center.
export function getEdgeEndpoint(
  node: EndpointInput,
  role: "source" | "target",
): { x: number; y: number } {
  const { positionAbsolute, width, height, vertexType } = node;
  // Normalize at the boundary: a non-finite rotation would propagate through
  // sin/cos and yield NaN endpoints; normalizeRotation maps it to 0.
  const rotation = normalizeRotation(node.rotation);
  const isDirectional = vertexType
    ? isDirectionalVertex(vertexType)
    : false;

  // Node center — the CSS rotation pivot.
  const cx = positionAbsolute.x + width / 2;
  const cy = positionAbsolute.y + height / 2;

  // Local offset from center (un-rotated): directional target → (0, -height/2),
  // directional source → (0, +height/3), everything else → (0, 0).
  const localX = 0;

  let localY = 0;
  if (isDirectional) {
    localY = role === "target" ? -height / 2 : height / 3;
  }

  if (rotation === 0) {
    return { x: cx + localX, y: cy + localY };
  }

  // Rotate by `rotation` degrees around the center clockwise
  // (y-down), matching CSS `rotate(positive)`.
  const theta = (rotation * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const rx = localX * cos - localY * sin;
  const ry = localX * sin + localY * cos;

  return { x: cx + rx, y: cy + ry };
}

// Edge-kind path styling for `StraightCenterEdge`. The default kind draws a
// thin 1.5pt line (matching the pre-kind look, slightly slimmer); dashed-blue
// edges draw dashed in blue at 2pt.
//
// `selected` adds a blue drop-shadow glow as the selection indicator (the
// same colour VertexNode uses). The kind's own stroke is kept — the glow
// marks selection rather than swapping the stroke colour.
export function edgeKindPathStyle(
  kind: EdgeKind,
  selected: boolean,
): CSSProperties | undefined {
  // Unknown kinds (smuggled past the typed boundary) fall back to the
  // default style rather than crashing the renderer.
  const meta = EDGE_KIND_MAP[kind] ?? EDGE_KIND_MAP[DEFAULT_EDGE_KIND];

  // Selected edges glow blue, mirroring the vertex selection highlight
  // (VertexNode uses the same drop-shadow colour). The kind's own stroke is
  // kept — the glow is the selection indicator, not a colour swap.
  if (selected) {
    return {
      filter: "drop-shadow(0 0 2px rgb(37 99 235))",
      stroke: meta.stroke,
      strokeDasharray: meta.strokeDashArray,
      strokeWidth: meta.strokeWidth,
    };
  }

  return {
    stroke: meta.stroke,
    strokeDasharray: meta.strokeDashArray,
    strokeWidth: meta.strokeWidth,
  };
}
