// src/lib/graph/edge-geometry.ts
//
// Pure geometry for `StraightCenterEdge`. The endpoint computation is
// the part worth covering under test (the renderer just draws the
// path); keeping it out of the component makes the rotation math
// unit-testable without standing up React Flow internals.

import { isDirectionalVertex } from "./vertex-types";
import type { VertexType } from "./types";

// Inputs to a single edge endpoint. Mirrors the fields the React Flow
// `useInternalNode` hook exposes, plus our custom `rotation`.
export type EndpointInput = {
  // Top-left of the node in absolute (flow-space) coordinates.
  positionAbsolute: { x: number; y: number };
  // Measured node size; React Flow fills these in after layout.
  width: number;
  height: number;
  vertexType: VertexType | undefined;
  // CSS rotation in degrees (view-slice field). 0 = un-rotated.
  rotation: number;
};

// Compute where an edge endpoint should sit on a node.
//   - for Directional (W / And gate, where input and output are different)
//     *target* anchor on the top edge, *source* anchor one-third of the
//     way down the body (a visual offset so the fan-out of outgoing
//     edges doesn't pile on top of incoming edges at the center).
//   - Everything else (symmetric vertices, both roles) anchors to center.
export function getEdgeEndpoint(
  node: EndpointInput,
  role: "source" | "target",
): { x: number; y: number } {
  const { positionAbsolute, width, height, vertexType, rotation } = node;
  const isDirectional = vertexType
    ? isDirectionalVertex(vertexType)
    : false;

  // Node center — the pivot for the CSS rotation.
  const cx = positionAbsolute.x + width / 2;
  const cy = positionAbsolute.y + height / 2;

  // Local offset of the un-rotated endpoint from the node center.
  //   - directional target → top edge,      offset (0, -height/2)
  //   - directional source → 1/3 down body, offset (0, +height/3)
  //   - everything else    → center,        offset (0, 0)
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
