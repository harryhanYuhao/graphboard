// crates/zxw/src/graph.rs
//
// `GraphSlice` — the only shape that crosses the WASM boundary. Source of
// truth for the TS side: `src/lib/graph/types.ts`.
//
// `#[serde(rename_all = "camelCase")]` is load-bearing: the persisted
// field names must match the TS `GraphNodeRecord { id, data: { phase,
// vertexType } }` or the wasm boundary fails to deserialize.
//
// Edge handles are `Option<u32>`: absent in JSON means "use the role
// default" (0 = top, 1 = bottom). The compute layer ignores the numeric
// value for symmetric tensors; for the directional W node it uses edge
// *direction* (W as source → output leg, W as target → input leg) to pick
// the axis. `Option` still deserializes cleanly even though unused.

use serde::{Deserialize, Serialize};

/// The compute contract: vertex records + edge records. Carries nothing
/// visual — those live in the `view` slice the compute layer never sees.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrontendGraphSlice {
    pub nodes: Vec<FrontendGraphNodeRecord>,
    pub edges: Vec<FrontendGraphEdgeRecord>,
}

/// A persisted vertex: id + the data the compute layer consumes. The
/// `data: { phase, vertexType }` nesting matches the TS contract exactly.
/// (`phase` was `label` in schema v1; the TS side migrates old docs.)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FrontendGraphNodeRecord {
    pub id: String,
    pub data: FrontendVertexData,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrontendVertexData {
    pub phase: String,
    pub vertex_type: VertexType,
    /// 0-indexed ordering of `Input` / `Output` boundary vertices within
    /// their own group; drives the final axis order of the contracted
    /// tensor (§5.4). Ignored for non-boundary types. `None` (absent in
    /// JSON) falls back to array position. `skip_serializing_if` keeps
    /// output byte-compatible with the frontend.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub order: Option<u32>,
}

/// The eleven vertex types: nine ZXW generators (incl. the black dot) plus
/// two boundary markers (`Input`, `Output`). Boundary types aren't tensors —
/// they declare open legs (each dimension 2), so n inputs + m outputs → 2^m ×
/// 2^n matrix; no boundaries → scalar. Serialized snake_case to match the TS
/// union. `Copy` so dispatch is borrow-free.
///
/// `rename_all = "snake_case"` is load-bearing: it serializes every variant
/// to its TS spelling — `Zbox` → `zbox`, `Xbox` → `xbox`, and crucially
/// `BlackDot` → `black_dot` (`rename_all = "lowercase"` would produce
/// `blackdot`, which the frontend never sends). For the other ten variants
/// snake_case is byte-identical to lowercase.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
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
    /// A filled black dot: a phaseless Z spider (`z_spider(arity, 0)`).
    BlackDot,
}

/// A persisted edge: endpoints plus optional handle indices. Handles are
/// `None` when JSON omits the field (meaning "use the role default");
/// `skip_serializing_if` keeps re-serialized output byte-compatible with
/// the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrontendGraphEdgeRecord {
    pub id: String,
    pub source: String,
    pub target: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_handle: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_handle: Option<u32>,
}
