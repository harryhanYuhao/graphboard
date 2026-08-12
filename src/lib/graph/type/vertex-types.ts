// src/lib/graph/type/vertex-types.ts
//
// Vertex + node types: the `VertexType` union, the handle-id and label-
// location vocabularies, the graph-slice `VertexData`, and the runtime
// `VertexNode` plus its persisted records (`GraphNodeRecord`, `NodeView`).
//
// The per-type behaviour predicates (isSpiderType, isDirectionalVertex,
// isBoundaryVertex) and the visual metadata table (VERTEX_TYPE_MAP) live in
// `src/lib/graph/vertex-registry.ts` — the registry, not the types.

import type { Node } from "@xyflow/react";

// ---- Vertex types -----------------------------------------------------------
//
// The 11 vertex types, grouped by role:
//
//   Spiders (phase-bearing, `isSpiderType`): z, x, zbox, xbox
//     The phase expression lives in `VertexData.phase` (empty = phase 0).
//     z / x are round spiders; zbox / xbox are their boxed variants.
//   Directional (`isDirectionalVertex`): w, and
//     One input at the top, fan-out outputs at the bottom. The W generator
//     and the And gate.
//   Boxes (fixed arity): h
//     The Hadamard box, always arity 2.
//   Plain markers: empty, black_dot
//     `empty`: the empty node (isolated → scalar 1, wired → identity).
//     `black_dot`: a filled dot — a phaseless Z spider (compute:
//     z_spider(arity, 0)).
//   Boundary (`isBoundaryVertex`): input, output
//     Not tensors — they declare the open legs (dimension 2 each), so
//     n inputs + m outputs → 2^m × 2^n matrix after contraction; no
//     boundaries → scalar.
//
// `VERTEX_TYPE_MAP` in `src/lib/graph/vertex-registry.ts` is the single source
// of truth for shape/colour/size and the behaviour predicates above.
export type VertexType =
  | "z"
  | "empty"
  | "x"
  | "w"
  | "h"
  | "zbox"
  | "xbox"
  | "and"
  | "input"
  | "output"
  | "black_dot";

// ---- Vertex string-literal vocabularies ------------------------------------
//
// Centralized string constants — the shared contract between vertex creation
// (operations.ts), serialisation (src/lib/serialisation/document.ts), and the
// renderer. Don't sprinkle the literals elsewhere.

// React Flow handle ids on VertexNode: `center-source` / `center-target` are
// the transparent overlays at the body center; `top` is the visible dot that
// anchors the directional W / And-gate target.
export const HANDLE_IDS = {
  centerSource: "center-source",
  centerTarget: "center-target",
  top: "top",
} as const satisfies Record<string, string>;

export type HandleId = (typeof HANDLE_IDS)[keyof typeof HANDLE_IDS];

// Where a visual label sits relative to its node; `none` hides it. Default is
// above the node (DEFAULT_LABEL_LOCATION).
export const LABEL_LOCATIONS = [
  "top",
  "bottom",
  "left",
  "right",
  "none",
] as const;

export type LabelLocation = (typeof LABEL_LOCATIONS)[number];

// Where an unset label location defaults to: above the node.
export const DEFAULT_LABEL_LOCATION: LabelLocation = "top";

// ---- Vertex data (graph slice) ---------------------------------------------

export type VertexData = {
  // The vertex's phase expression — the compute input for spider/box types
  // (`z`/`x`/`zbox`/`xbox`); decoration only for other types. Empty = phase 0
  // (identity). Renamed from `label` in schema v2 so the name matches its
  // semantics; the visual label now lives in the view slice (`NodeView.label`).
  phase: string;
  vertexType: VertexType;
  // 0-indexed ordering of `input` / `output` boundary vertices, sets the final
  // axis order of the contracted tensor (Rust compute layer §5.4). Inputs and
  // outputs order independently; ignored for other types. Optional — missing
  // falls back to array position so older saved graphs still work.
  order?: number;
};

// ---- Runtime layer (in-memory, what the store + React Flow hold) -----------
//
// React Flow's own object types: renderer data (position, plumbing, ephemeral
// `selected`); React Flow injects `measured`, `internals.positionAbsolute`, etc.
// at render time. Never persisted — see the persistence types below.

// `rotation`, `label`, and `labelLocation` live outside `data` deliberately —
// they are visual concerns that belong in the view slice (`NodeView`), not in
// the graph-slice `VertexData`.
export type VertexNode = Node<VertexData, "vertex"> & {
  rotation: number;
  // Visual annotation (KaTeX-enabled) shown near the node; "" = not shown.
  label: string;
  // Where the visual label sits relative to the node body.
  labelLocation: LabelLocation;
};

// ---- Persisted vertex records ----------------------------------------------

// Persisted vertex — only what computation needs.
export type GraphNodeRecord = {
  id: string;
  data: VertexData;
};

// View entry for a node — position, rotation, and the visual label today;
// more visual fields later.
//
// `rotation` is degrees, applied via CSS transform. `label` is a KaTeX-enabled
// annotation shown near the node (see `src/lib/label/renderLabel.ts`);
// `labelLocation` picks which side it sits on. All visual only — the compute
// layer reads `graph` and never sees these. Optional for backward compat with
// pre-rotation/pre-label saves; missing values hydrate to defaults (rotation
// 0, label "", labelLocation "top").
export type NodeView = {
  id: string;
  position: { x: number; y: number };
  rotation?: number;
  label?: string;
  labelLocation?: LabelLocation;
};
