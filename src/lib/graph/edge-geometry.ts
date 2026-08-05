// src/lib/graph/edge-geometry.ts
//
// Pure geometry for `StraightCenterEdge`. Kept out of the component so the
// rotation math is unit-testable without React Flow internals.

import { isDirectionalVertex } from "./vertex-types";
import { normalizeRotation } from "@/lib/serialisation";
import type { VertexType } from "./types";

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
