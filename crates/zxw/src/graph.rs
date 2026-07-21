// crates/zxw/src/graph.rs
//
// `GraphSlice` data model — the contract between the frontend (TS) and
// the Rust compute layer. The compute
// layer consumes `doc.graph` straight off the WASM boundary, so this is
// the *only* shape that crosses it. Source of truth for the TS side:
// `src/lib/graph/types.ts`.
//
// The persisted form is nested and camelCase (e.g. `vertexType`, not
// `vertex_type`), mirroring the TS `GraphNodeRecord { id, data: { label,
// vertexType } }`. The `#[serde(rename_all = "camelCase")]` attributes
// below are load-bearing — without them the wasm boundary fails to
// deserialize. See `doc/plans.md` §4.0 and `tests/graph_serde.rs`.
//
// Handle indices on edges are `Option<u32>`: absent in JSON means "use
// the role default" (see `src/lib/graph/serialization.ts`), and the
// numeric meaning is 0 = top, 1 = bottom. The compute layer treats all
// legs of a symmetric tensor as equivalent and ignores the index in v1;
// it must still deserialize cleanly, hence `Option`.

use serde::{Deserialize, Serialize};

/// The compute contract: a list of vertex records + a list of edge
/// records. Carries nothing visual (no positions, no rotations, no React
/// Flow plumbing) — those live in the `view` slice the compute layer
/// never sees.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphSlice {
    pub nodes: Vec<GraphNodeRecord>,
    pub edges: Vec<GraphEdgeRecord>,
}

/// A persisted vertex: id + the data the compute layer consumes (label +
/// type). The nesting (`data: { label, vertexType }`) matches the TS
/// contract exactly.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphNodeRecord {
    pub id: String,
    pub data: VertexData,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VertexData {
    pub label: String,
    pub vertex_type: VertexType,
}

/// The ten vertex types: eight ZXW generators plus two boundary markers
/// (`Input`, `Output`). Boundary types are NOT tensors — they declare
/// open legs of the resulting tensor (each leg dimension 2), so n inputs
/// + m outputs → 2^m × 2^n matrix after contraction; no boundaries →
/// scalar. Serialized lowercase to match the TS `VertexType` string
/// union. `Copy` so dispatch on the type is cheap and borrow-free.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum VertexType {
    Z,
    Empty,
    X,
    W,
    H,
    Zbox,
    Xbox,
    And,
    Input,
    Output,
}

/// A persisted edge: endpoints plus the optional numeric connection
/// indices. `source_handle` / `target_handle` are `None` when the JSON
/// omits the field (meaning "use the role default" on the TS side); the
/// compute layer ignores the specific value for symmetric tensors in v1.
///
/// `skip_serializing_if` keeps re-serialized output byte-compatible with
/// what the frontend emits — an edge that never had handles shouldn't
/// sprout `"sourceHandle": null` on the way back out.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphEdgeRecord {
    pub id: String,
    pub source: String,
    pub target: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_handle: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_handle: Option<u32>,
}
