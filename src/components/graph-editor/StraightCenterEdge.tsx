"use client";

import {
    BaseEdge,
    getStraightPath,
    type EdgeProps,
} from "@xyflow/react";

export function StraightCenterEdge(props: EdgeProps) {
    const [edgePath] = getStraightPath({
        sourceX: props.sourceX,
        sourceY: props.sourceY,
        targetX: props.targetX,
        targetY: props.targetY,
    });

    return (
        <BaseEdge
            path={edgePath}
            markerEnd={props.markerEnd}
            style={{
                ...props.style,
                strokeWidth: 2,
            }}
        />
    );
}
