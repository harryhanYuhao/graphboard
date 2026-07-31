// crates/zxw/src/lib.rs
//
// ZXW compute layer — ZXW calculus tensor evaluation, exposed to the
// browser via WASM. See `doc/plans.md` for the full design.

pub mod contraction;
pub mod error;
pub mod graph;
pub mod nodes;
pub mod phase;
pub mod tensor;

mod utils;

// Convenience re-exports so external callers don't spell the full path.
pub use contraction::{compute_tensor, TensorResult};
pub use error::{ComputeError, PhaseError};
pub use graph::{
    FrontendGraphEdgeRecord, FrontendGraphNodeRecord, FrontendGraphSlice, FrontendVertexData,
    VertexType,
};
pub use nodes::{
    and_gate, build_vertex_tensor, empty, h_box, w_node, x_box, x_spider, z_box, z_spider,
};
pub use phase::parse_phase;
pub use tensor::{Cplx, Tensor};

#[cfg(feature = "wasm")]
pub mod wasm;
