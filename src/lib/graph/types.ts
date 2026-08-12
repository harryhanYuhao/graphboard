// src/lib/graph/types.ts
//
// Barrel over the split type files in `./type/`:
//
//   type/editor-types.ts  — editor + document-level (EDITOR_MODES, EditorMode,
//                           PERSISTED_IDS, GraphSlice, ViewSlice, GraphDocument,
//                           CURRENT_SCHEMA_VERSION)
//   type/vertex-types.ts  — vertex + node (VertexType, HANDLE_IDS/HandleId,
//                           LabelLocation family, VertexData, VertexNode,
//                           GraphNodeRecord, NodeView)
//   type/edge-types.ts    — edge (EDGE_TYPES/EdgeType, EDGE_KINDS, EdgeKind,
//                           DEFAULT_EDGE_KIND, GraphEdge, GraphEdgeRecord,
//                           EdgeView)
//
// Import from `@/lib/graph/types` (this barrel) as before; the granular files
// are available for new code that only needs one slice.
//
// Registries + behaviour predicates live next door, not here:
//   - `./vertex-registry.ts` — VERTEX_TYPES / VERTEX_TYPE_MAP, isSpiderType,
//     isDirectionalVertex, isBoundaryVertex
//   - `./edge-registry.ts`   — EDGE_KIND_MAP, coerceEdgeKind

export * from "./type/editor-types";
export * from "./type/vertex-types";
export * from "./type/edge-types";
