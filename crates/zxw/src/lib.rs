// crates/zxw/src/lib.rs
//
// ZXW compute layer — ZXW calculus tensor evaluation, ported from the
// JS frontend to Rust and exposed to the browser via WASM.
//
// Phase 3 landed: the `GraphSlice` serde model (`graph`), the phase
// parser (`phase` + `PhaseError`), the tensor type (`tensor`), and the
// eight per-vertex builders (`nodes`).
// Phase 4 (this revision) lands: the contraction algorithm
// (`contraction` + `compute_tensor` + `TensorResult` + `ComputeError`).
// Phase 5 will add the full WASM bindings + Web Worker.
//
// See `doc/plans.md` for the full plan.

pub mod contraction;
pub mod error;
pub mod graph;
pub mod nodes;
pub mod phase;
pub mod tensor;

mod utils;

// Convenience re-exports so external callers (tests, the future wasm
// wrapper, downstream rlib users) don't have to spell the full path.
pub use contraction::{compute_tensor, TensorResult};
pub use error::{ComputeError, PhaseError};
pub use graph::{GraphEdgeRecord, GraphNodeRecord, GraphSlice, VertexData, VertexType};
pub use nodes::{and_gate, build_vertex_tensor, empty, h_box, w_node, x_box, x_spider, z_box, z_spider};
pub use phase::parse_phase;
pub use tensor::{Cplx, Tensor};

#[cfg(feature = "wasm")]
pub mod wasm;
