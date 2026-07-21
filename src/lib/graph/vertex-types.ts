// src/lib/graph/vertex-types.ts
//
// All visual information on vertex types, which corresponds to
// different tensors nodes
// It is consumed by the vertex renderer (VertexNode),
// add-vertex side menu (VertexTypeMenu), and vertex property panel 
// (VertexPropertyPanel)

import { createElement, type ReactNode } from "react";
import type { VertexType } from "./types";
import { AndGateGlyph } from "@/components/graph-editor/VertexGlyphs";

type VertexShape = "circle" | "square" | "triangle";

// `true` for vertex types that are asymmetric, false for symmetric
// ATM there are only two assymmetric tensor, W and AND
export function isDirectionalVertex(vertexType: VertexType): boolean {
  return VERTEX_TYPE_MAP[vertexType]?.directional === true;
}

// Vertex types whose label is interpreted as a *phase expression*
// rather than free-form text. For Z/X spiders and Z/X boxes the
// label-as-phase convention applies (see `AGENTS.md` §"Label as
// phase"); for H / W / AND / empty the label is decoration only.
//
// This is the single source of truth for "should I parse this label
// as a phase?" — the property panel live preview, the Rust compute
// entry point, and any future test that needs the same predicate
// all go through here.
export function isSpiderType(vertexType: VertexType): boolean {
  return (
    vertexType === "z" ||
    vertexType === "x" ||
    vertexType === "zbox" ||
    vertexType === "xbox"
  );
}

// Boundary vertex types — `input` and `output`. These are NOT tensors:
// they declare open legs of the resulting tensor (each leg dimension 2),
// so n inputs + m outputs → 2^m × 2^n matrix after contraction; no
// boundaries → scalar. They render as labeled circles (like `empty`)
// with symmetric handles, and must have degree ≤ 1 (enforced at compute
// time, not at edge-creation time — matches plan §5.6).
//
// Single source of truth for "is this a boundary marker?", paralleling
// `isSpiderType` and `isDirectionalVertex`.
export function isBoundaryVertex(vertexType: VertexType): boolean {
  return vertexType === "input" || vertexType === "output";
}

// Tailwind class for the corner radius matching each shape. The
// "empty" string for triangles is intentional — triangles are
// clipped to their silhouette, so a CSS border-radius on the box
// wouldn't follow the visible edges anyway. `rounded-sm` is kept
// for squares (instead of the `rounded-md` originally used in the
// swatch) so the live editor renders the same shape it always has.
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
// `radiusClass` and `isTriangle` are derived from `shape` so they
// can't drift between the entry and the consumers — see the
// `enrich` step below.
type VertexTypeMetaBase = {
  type: VertexType;
  // Label is also the phase of the vertex
  label: string;

  shape: VertexShape;
  // control the size, which is also used to determine anchors
  size: number;

  // Tailwind classes applied to the shape body (fill + text + border color).
  className: string;

  // Default text content for the vertex body, used as the initial
  // `VertexData.label` when a vertex of this type is created. The user
  // can override this by typing a custom label.
  defaultText: string,

  // Optional default visual glyph (e.g. an SVG) shown when the vertex
  // label is empty. Used for types whose "default" interior isn't a
  // font character (the And gate's Λ used to be — now an SVG, see
  // VertexGlyphs.tsx). Glyphs render in addition to (not instead of)
  // the type's color/shape, so they automatically pick up the
  // `className` text color via `currentColor`.
  glyph?: ReactNode,

  // If true, the vertex has a directional structure with a single
  // target edge at the top and multiple source edges spread across
  // the bottom. Used by vertex types that are asymmetric in ZXW
  // calculus — the W node ("copy", one input fan-out to many
  // outputs) and the And gate. The renderer (VertexNode) and the
  // edge component (StraightCenterEdge) both key off this flag;
  // symmetric types leave it unset and behave as before (edges meet
  // at the body center).
  directional?: boolean,
};

export type VertexTypeMeta = VertexTypeMetaBase & {
  // Derived from `shape` at module load. Pre-computed so the live
  // vertex and the type-menu swatch can never disagree on the
  // rounding class.
  radiusClass: string;
  // Convenience boolean — replaces the
  // `meta.shape === "triangle"` checks scattered across
  // VertexNode / VertexSwatch.
  isTriangle: boolean;
};

// clip-path for the triangle body (also used for the menu swatch).
export const TRIANGLE_CLIP_PATH = "polygon(50% 0%, 0% 100%, 100% 100%)";

const RAW_VERTEX_TYPES: VertexTypeMetaBase[] = [
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
    // Boundary marker: declares one open INPUT leg of the resulting
    // tensor. Not a tensor itself — see `isBoundaryVertex`. Rendered
    // as a labeled blue-dotted circle so it reads as "wire entering
    // the circuit" at a glance.
    type: "input",
    label: "input",
    shape: "circle",
    size: 4.5,
    className: "border-2 border-dotted text-xs border-blue-500 text-blue-700",
    defaultText: ""
  },
  {
    // Boundary marker: declares one open OUTPUT leg. Same shape as
    // input; green border distinguishes it. Both must have degree ≤ 1
    // (validated at compute time).
    type: "output",
    label: "output",
    shape: "circle",
    size: 4.5,
    className: "border-2 border-dotted text-xs border-green-500 text-green-700",
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
    defaultText: "",
    // W is the "copy" generator: one input (top) fans out to many
    // outputs (bottom). Renderer places one target handle at the top
    // and N source handles across the bottom; edges route
    // accordingly (see StraightCenterEdge).
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
    type: "and",
    label: "And gate",
    shape: "square",
    size: 4,
    className: "bg-white text-slate-900 border-grey-900 border-2 text-sm",
    defaultText: "",
    // The And gate's interior is a logical-AND shape, drawn as an
    // SVG (see VertexGlyphs.tsx) rather than the Λ font glyph. The
    // font character is missing or visually inconsistent on systems
    // without a font that ships the Greek block, so the gate used
    // to render differently across machines.
    glyph: createElement(AndGateGlyph),
    // And gate is directional like W: one input at the top, many
    // outputs at the bottom.
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

// Maps from type to typemeta (which is type info).
// TOUSE:
export const VERTEX_TYPE_MAP: Record<VertexType, VertexTypeMeta> =
  Object.fromEntries(VERTEX_TYPES.map((meta) => [meta.type, meta])) as Record<
    VertexType,
    VertexTypeMeta
  >;

export const DEFAULT_VERTEX_TYPE: VertexType = "z";
