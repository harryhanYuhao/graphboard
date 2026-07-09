// src/test-utils/factories.ts
//
// Shared `makeVertex` / `makeEdge` helpers for the project's vitest
// tests. Centralising the shape means tests don't drift from the
// runtime `VertexNode` / `GraphEdge` types — adding a required
// field to the type surfaces as a TS error here, not in 10 test
// files at once.
//
// Two vertex factories are provided, matching the call sites that
// already exist in the test files:
//
//   - `makeVertex(id, position?, selected?)` — positional; used
//     by `operations.test.ts` where the test cares about position
//     and selection in that order.
//   - `makeVertexWith(id, options?)` — id first, then named
//     options; used by `graph-store.test.ts` where tests need to
//     flip selection / data / etc. by name.

import {
  EDGE_TYPES,
  type GraphEdge,
  type VertexData,
  type VertexNode,
} from "@/lib/graph/types";

const DEFAULT_VERTEX_DATA: VertexData = { label: "", vertexType: "z" };

export function makeVertex(
  id: string,
  position: { x: number; y: number } = { x: 0, y: 0 },
  selected = false,
): VertexNode {
  return {
    id,
    type: "vertex",
    position,
    origin: [0.5, 0.5],
    selected,
    rotation: 0,
    data: { ...DEFAULT_VERTEX_DATA },
  };
}

export type VertexWithOptions = {
  position?: { x: number; y: number };
  selected?: boolean;
  rotation?: number;
  data?: Partial<VertexData>;
};

export function makeVertexWith(
  id: string,
  options: VertexWithOptions = {},
): VertexNode {
  return {
    id,
    type: "vertex",
    position: options.position ?? { x: 0, y: 0 },
    origin: [0.5, 0.5],
    selected: options.selected ?? false,
    rotation: options.rotation ?? 0,
    data: { ...DEFAULT_VERTEX_DATA, ...options.data },
  };
}

export function makeEdge(
  id: string,
  source: string,
  target: string,
  selected = false,
): GraphEdge {
  return { id, source, target, type: EDGE_TYPES.straightCenter, selected };
}
