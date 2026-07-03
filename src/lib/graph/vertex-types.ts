// src/lib/graph/vertex-types.ts
//
// Single source of truth for the selectable vertex types (ZXW generators) and
// how each one is drawn. Consumed by the vertex renderer (VertexNode) and the
// add-vertex side menu (VertexTypeMenu) so shapes/colors stay in sync.

import type { VertexType } from "./types";

export type VertexShape = "circle" | "square" | "triangle";

export type VertexTypeMeta = {
  type: VertexType;
  label: string;

  shape: VertexShape;
  // control the size, which is also used to determine anchors
  size: number;

  // Tailwind classes applied to the shape body (fill + text color).
  className: string;
  // Border color class — only applied to non-triangle shapes (a CSS border
  // does not follow a clip-path silhouette).
  borderClassName: string;
};

// clip-path for the triangle body (also used for the menu swatch).
export const TRIANGLE_CLIP_PATH = "polygon(50% 0%, 0% 100%, 100% 100%)";

export const VERTEX_TYPES: VertexTypeMeta[] = [
  {
    type: "z",
    label: "Z spider",
    shape: "circle",
    size: 6,
    className: "bg-green-500 text-white border-green-700",
  },
  {
    type: "x",
    label: "X spider",
    shape: "circle",
    size: 6,
    className: "bg-red-500 text-white border-red-700",
  },
  {
    type: "w",
    label: "W node",
    shape: "triangle",
    size: 8,
    className: "bg-slate-900 text-white",
  },
  {
    type: "h",
    label: "H box",
    shape: "square",
    size: 5,
    className: "bg-amber-300 text-slate-900 border-amber-500",
  },
];

export const VERTEX_TYPE_MAP: Record<VertexType, VertexTypeMeta> =
  Object.fromEntries(VERTEX_TYPES.map((meta) => [meta.type, meta])) as Record<
    VertexType,
    VertexTypeMeta
  >;

export const DEFAULT_VERTEX_TYPE: VertexType = "z";
