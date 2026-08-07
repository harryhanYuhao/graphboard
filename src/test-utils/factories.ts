// Shared `makeVertex` / `makeEdge` factories for tests. Adding a required
// field to `VertexNode` / `GraphEdge` surfaces as a TS error here rather
// than across every test file at once.

import {
  DEFAULT_LABEL_LOCATION,
  EDGE_TYPES,
  type GraphEdge,
  type LabelLocation,
  type VertexData,
  type VertexNode,
} from "@/lib/graph/types";

const DEFAULT_VERTEX_DATA: VertexData = { phase: "", vertexType: "z" };

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
    label: "",
    labelLocation: DEFAULT_LABEL_LOCATION,
    data: { ...DEFAULT_VERTEX_DATA },
  };
}

export type VertexWithOptions = {
  position?: { x: number; y: number };
  selected?: boolean;
  rotation?: number;
  label?: string;
  labelLocation?: LabelLocation;
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
    label: options.label ?? "",
    labelLocation: options.labelLocation ?? DEFAULT_LABEL_LOCATION,
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
