// crates/zxw/src/lib.rs
//
// ZXW compute layer — ZXW calculus tensor evaluation, ported from the
// JS frontend to Rust and exposed to the browser via WASM.
//
// Phase 3 (this revision) lands: the `GraphSlice` serde model (`graph`),
// the phase parser (`phase` + `PhaseError`), the tensor type (`tensor`),
// and the eight per-vertex builders (`nodes`). Phase 4 will add the
// contraction algorithm (`contraction`) + `ComputeError`/`GraphError`;
// Phase 5 adds the full WASM bindings.
//
// See `doc/plans.md` for the full plan.

pub mod contraction;
pub mod error;
pub mod graph;
pub mod nodes;
pub mod phase;
pub mod tensor;

mod utils;

// Convenience re-exports
pub use error::PhaseError;
pub use graph::{GraphEdgeRecord, GraphNodeRecord, GraphSlice, VertexData, VertexType};
pub use nodes::{and_gate, empty, h_box, w_node, x_box, x_spider, z_box, z_spider};
pub use phase::parse_phase;

#[cfg(feature = "wasm")]
pub mod wasm;
