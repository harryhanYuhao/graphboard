"use client";

import { BaseEdge, type EdgeProps, useInternalNode } from "@xyflow/react";

export function StraightCenterEdge(props: EdgeProps) {
  const sourceNode = useInternalNode(props.source);
  const targetNode = useInternalNode(props.target);

  if (!sourceNode || !targetNode) {
    return null;
  }

  const sourceWidth = sourceNode.measured?.width ?? sourceNode.width ?? 48;
  const sourceHeight = sourceNode.measured?.height ?? sourceNode.height ?? 48;

  const targetWidth = targetNode.measured?.width ?? targetNode.width ?? 48;
  const targetHeight = targetNode.measured?.height ?? targetNode.height ?? 48;

  const sourceX = sourceNode.internals.positionAbsolute.x + sourceWidth / 2;
  const sourceY = sourceNode.internals.positionAbsolute.y + sourceHeight / 2;

  const targetX = targetNode.internals.positionAbsolute.x + targetWidth / 2;
  const targetY = targetNode.internals.positionAbsolute.y + targetHeight / 2;

  const path = `M ${sourceX},${sourceY} L ${targetX},${targetY}`;

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