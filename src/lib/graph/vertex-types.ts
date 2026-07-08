// src/lib/graph/vertex-types.ts
//
// Single source of truth for the selectable vertex types (ZXW generators) and
// how each one is drawn. Consumed by the vertex renderer (VertexNode) and the
// add-vertex side menu (VertexTypeMenu) so shapes/colors stay in sync.

import type { VertexType } from "./types";

type VertexShape = "circle" | "square" | "triangle";

export type VertexTypeMeta = {
  type: VertexType;
  label: string;

  shape: VertexShape;
  // control the size, which is also used to determine anchors
  size: number;

  // Tailwind classes applied to the shape body (fill + text + border color).
  className: string;

  defaultText: string,
};

// clip-path for the triangle body (also used for the menu swatch).
export const TRIANGLE_CLIP_PATH = "polygon(50% 0%, 0% 100%, 100% 100%)";

export const VERTEX_TYPES: VertexTypeMeta[] = [
  {
    type: "zbox",
    label: "Z box",
    shape: "square",
    size: 4,
    className: "bg-lime-500 text-black border-lime-900 border-2 text-sm",
    defaultText: ""
  },
  {
    type: "z",
    label: "Z spider",
    shape: "circle",
    size: 4,
    className: "bg-lime-500 text-black border-lime-900 border-2 text-sm",
    defaultText: ""
  },
  {
    type: "empty",
    label: "empty node",
    shape: "circle",
    size: 4.5,
    className: "border-2 border-dotted text-xs border-black/50",
    defaultText: ""
  },
  {
    type: "x",
    label: "X spider",
    shape: "circle",
    size: 4,
    className: "bg-rose-500 text-black border-rose-900 border-2 text-sm",
    defaultText: ""
  },
  {
    type: "xbox",
    label: "X box",
    shape: "square",
    size: 4,
    className: "bg-rose-500 text-black border-rose-900 border-2 text-sm",
    defaultText: ""
  },
  {
    type: "w",
    label: "W node",
    shape: "triangle",
    size: 5,
    className: "bg-slate-900 text-white pt-3 text-[10px]",
    defaultText: ""
  },
  {
    type: "h",
    label: "H box",
    shape: "square",
    size: 4,
    className: "bg-yellow-300 text-slate-900 border-yellow-900 border-2 text-sm",
    defaultText: ""
  },
  {
    type: "and",
    label: "And gate",
    shape: "square",
    size: 4,
    className: "bg-white text-slate-900 border-grey-900 border-2 text-sm",
    defaultText: "Λ"
  },
];

export const VERTEX_TYPE_MAP: Record<VertexType, VertexTypeMeta> =
  Object.fromEntries(VERTEX_TYPES.map((meta) => [meta.type, meta])) as Record<
    VertexType,
    VertexTypeMeta
  >;

export const DEFAULT_VERTEX_TYPE: VertexType = "z";
