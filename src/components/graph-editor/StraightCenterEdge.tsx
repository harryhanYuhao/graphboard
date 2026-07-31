"use client";

import { BaseEdge, type EdgeProps, useInternalNode } from "@xyflow/react";
import type { VertexNode as VertexNodeType, VertexType } from "@/lib/graph/types";
import { getEdgeEndpoint } from "@/lib/graph/edge-geometry";
import { useGraphStore } from "@/store/graph-store";
import { nodesById } from "@/store/selectors";

export function StraightCenterEdge(props: EdgeProps) {
  const sourceNode = useInternalNode<VertexNodeType>(props.source);
  const targetNode = useInternalNode<VertexNodeType>(props.target);

  // Read each endpoint's rotation via the memoized id→node map; the primitive
  // return re-renders only on change. A directional (W/And) target's top
  // handle orbits the center as the body rotates via CSS, so the edge endpoint
  // must follow it (see `getEdgeEndpoint` for the geometry).
  const sourceRotation = useGraphStore(
    (state) => nodesById(state.nodes).get(props.source)?.rotation ?? 0,
  );
  const targetRotation = useGraphStore(
    (state) => nodesById(state.nodes).get(props.target)?.rotation ?? 0,
  );

  if (!sourceNode || !targetNode) {
    return null;
  }

  const sourcePoint = getEdgeEndpoint(
    {
      positionAbsolute: sourceNode.internals.positionAbsolute,
      width: sourceNode.measured?.width ?? sourceNode.width ?? 48,
      height: sourceNode.measured?.height ?? sourceNode.height ?? 48,
      vertexType: (sourceNode.data as { vertexType?: VertexType } | undefined)
        ?.vertexType,
      rotation: sourceRotation,
    },
    "source",
  );
  const targetPoint = getEdgeEndpoint(
    {
      positionAbsolute: targetNode.internals.positionAbsolute,
      width: targetNode.measured?.width ?? targetNode.width ?? 48,
      height: targetNode.measured?.height ?? targetNode.height ?? 48,
      vertexType: (targetNode.data as { vertexType?: VertexType } | undefined)
        ?.vertexType,
      rotation: targetRotation,
    },
    "target",
  );

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
