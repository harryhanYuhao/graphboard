// src/lib/graph/vertex-types.ts
//
// Visual metadata for each vertex type (tensor node). Consumed by the vertex
// renderer (VertexNode), add-vertex menu (VertexTypeMenu), and property panel.

import { createElement, type ReactNode } from "react";
import type { VertexType } from "./types";
import { AndGateGlyph } from "@/components/graph-editor/VertexGlyphs";

type VertexShape = "circle" | "square" | "triangle";

// True for asymmetric vertex types — currently just W and And gate.
export function isDirectionalVertex(vertexType: VertexType): boolean {
  return VERTEX_TYPE_MAP[vertexType]?.directional === true;
}

// True for vertex types whose label is parsed as a phase expression (Z/X
// spiders and boxes; see `AGENTS.md` §"Label as phase") rather than free text.
// Single source of truth for "parse this label as a phase?".
export function isSpiderType(vertexType: VertexType): boolean {
  return (
    vertexType === "z" ||
    vertexType === "x" ||
    vertexType === "zbox" ||
    vertexType === "xbox"
  );
}

// Boundary marker types (input/output) — not tensors; they declare open legs
// (dimension 2 each), so n inputs + m outputs → 2^m × 2^n matrix after
// contraction
export function isBoundaryVertex(vertexType: VertexType): boolean {
  return vertexType === "input" || vertexType === "output";
}

// Tailwind corner-radius class per shape. Triangles return "" because they're
// clip-pathed to their silhouette, so a CSS border-radius wouldn't follow the
// visible edges.
function shapeRadiusClass(shape: VertexShape): string {
  switch (shape) {
    case "circle":
      return "rounded-full";
    case "square":
      return "rounded-sm";
    case "triangle":
      return "";
  }
}

// Base shape metadata declared inline per type in `VERTEX_TYPES`.
// `radiusClass` / `isTriangle` are derived from `shape` via `enrich` so they
// can't drift from the entry.
type VertexTypeMetaBase = {
  type: VertexType;
  // Also the vertex's phase (for spider types).
  label: string;

  shape: VertexShape;
  // Body size; also determines handle anchor positions.
  size: number;

  // Tailwind classes for the shape body (fill + text + border color).
  className: string;

  // Initial `VertexData.label` for a newly created vertex of this type.
  defaultText: string,

  // Optional glyph (SVG) shown when the label is empty. Renders on top of
  // color/shape and inherits `className`'s text color via `currentColor`.
  glyph?: ReactNode,

  // True for asymmetric ZXW types (W node, And gate): one target at the top,
  // multiple sources across the bottom. Renderer (VertexNode) and edge
  // component (StraightCenterEdge) key off this; symmetric types leave it
  // unset and route edges through the body center.
  directional?: boolean,
};

export type VertexTypeMeta = VertexTypeMetaBase & {
  // Derived from `shape` at module load so the vertex and menu swatch agree.
  radiusClass: string;
  // Convenience boolean replacing scattered `meta.shape === "triangle"` checks.
  isTriangle: boolean;
};

// clip-path for the triangle body (also used for the menu swatch).
export const TRIANGLE_CLIP_PATH = "polygon(50% 0%, 0% 100%, 100% 100%)";

const RAW_VERTEX_TYPES: VertexTypeMetaBase[] = [
  {
    type: "z",
    label: "Z spider",
    shape: "circle",
    size: 4,
    className: "bg-lime-500 text-black border-lime-900 border-2 text-sm",
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
    type: "black_dot",
    label: "Dot",
    shape: "circle",
    size: 2,
    className: "bg-black text-black text-sm",
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
    // Boundary marker: one open INPUT leg (see `isBoundaryVertex`).
    type: "input",
    label: "input",
    shape: "circle",
    size: 4.5,
    className: "border-2 border-dotted text-xs border-blue-500 text-blue-700",
    defaultText: ""
  },
  {
    // Boundary marker: one open OUTPUT leg. Same shape as input; green border distinguishes it.
    type: "output",
    label: "output",
    shape: "circle",
    size: 4.5,
    className: "border-2 border-dotted text-xs border-green-500 text-green-700",
    defaultText: ""
  },
  {
    type: "w",
    label: "W node",
    shape: "triangle",
    size: 5,
    className: "bg-slate-900 text-white pt-3 text-[10px]",
    defaultText: "",
    // W is the "copy" generator: one input (top) fans out to many outputs (bottom).
    directional: true,
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
    type: "zbox",
    label: "Z box",
    shape: "square",
    size: 4,
    className: "bg-lime-500 text-black border-lime-900 border-2 text-sm",
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
    type: "and",
    label: "And gate",
    shape: "square",
    size: 4,
    className: "bg-white text-slate-900 border-grey-900 border-2 text-sm",
    defaultText: "",
    // AND interior is drawn as an SVG (VertexGlyphs.tsx), not a font glyph.
    glyph: createElement(AndGateGlyph),
    // Directional like W: one input at the top, many outputs at the bottom.
    directional: true,
  },
];

function enrich(base: VertexTypeMetaBase): VertexTypeMeta {
  return {
    ...base,
    radiusClass: shapeRadiusClass(base.shape),
    isTriangle: base.shape === "triangle",
  };
}

export const VERTEX_TYPES: VertexTypeMeta[] = RAW_VERTEX_TYPES.map(enrich);

// Lookup from vertex type to its metadata.
export const VERTEX_TYPE_MAP: Record<VertexType, VertexTypeMeta> =
  Object.fromEntries(VERTEX_TYPES.map((meta) => [meta.type, meta])) as Record<
    VertexType,
    VertexTypeMeta
  >;

export const DEFAULT_VERTEX_TYPE: VertexType = "z";
