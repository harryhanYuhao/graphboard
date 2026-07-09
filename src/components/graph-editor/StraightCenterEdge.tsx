"use client";

import { BaseEdge, type EdgeProps, useInternalNode } from "@xyflow/react";
import { VERTEX_TYPE_MAP } from "@/lib/graph/vertex-types";
import type { VertexType } from "@/lib/graph/types";

// Compute the connection point for one endpoint of an edge. Directional
// vertices (W node, And gate) move their *target* handle to the top
// edge so the user sees where the input enters; the source side stays
// at the body center, matching the original centered-handle behavior
// (which already supports a many-output fan-out from a single handle).
// Non-directional vertices still meet every edge at their center.
function getEndpointPoint(
  node: NonNullable<ReturnType<typeof useInternalNode>>,
  role: "source" | "target",
): { x: number; y: number } {
  const position = node.internals.positionAbsolute;
  const width = node.measured?.width ?? node.width ?? 48;
  const height = node.measured?.height ?? node.height ?? 48;

  // `node.data` from React Flow's internal store is typed loosely;
  // we only care about the vertexType discriminator.
  const data = node.data as { vertexType?: VertexType } | undefined;
  const vertexType = data?.vertexType;
  const meta = vertexType ? VERTEX_TYPE_MAP[vertexType] : undefined;
  const isDirectional = meta?.directional === true;

  if (isDirectional && role === "target") {
    // Directional target endpoint sits on the node's top edge — the
    // visual anchor the user sees in the editor.
    return { x: position.x + width / 2, y: position.y };
  }

  // Source endpoint (and all non-directional endpoints): the node
  // center. Preserves the pre-existing symmetric behavior for the
  // output side and for every endpoint on x/z/h/etc.
  return { x: position.x + width / 2, y: position.y + height / 2 };
}

export function StraightCenterEdge(props: EdgeProps) {
  const sourceNode = useInternalNode(props.source);
  const targetNode = useInternalNode(props.target);

  if (!sourceNode || !targetNode) {
    return null;
  }

  const sourcePoint = getEndpointPoint(sourceNode, "source");
  const targetPoint = getEndpointPoint(targetNode, "target");

  const path = `M ${sourcePoint.x},${sourcePoint.y} L ${targetPoint.x},${targetPoint.y}`;

  return (
    <BaseEdge
      path={path}
      markerEnd={props.markerEnd}
      style={{
        ...props.style,
        strokeWidth: 2,
      }}
    />
  );
}