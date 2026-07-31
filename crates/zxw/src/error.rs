// crates/zxw/src/error.rs
//
// `ComputeError` covers structural problems the contraction can't recover
// from. Per-spider phase-parse failures are NOT here — those downgrade to
// warnings on `TensorResult`.

use crate::graph::VertexType;
use thiserror::Error;

/// Errors raised by `parse_phase`. Mirrors the JS `ParseError` surface.
#[derive(Debug, Clone, PartialEq, Error)]
pub enum PhaseError {
    #[error("Unknown variable '{0}' (only \\pi is supported in v1)")]
    UnknownVariable(String),

    #[error("Unexpected '{found}' at position {position}")]
    UnexpectedToken { found: String, position: usize },

    #[error("Unexpected end of input")]
    UnexpectedEndOfInput,

    #[error("Expected ')' at position {0}")]
    MissingCloseParen(usize),

    #[error("Phase is not finite ({0})")]
    NonFinite(f64),
}

/// Errors raised by `compute_tensor`. Most structural validation (duplicate
/// ids, vertex-not-found, boundary degree, H-box arity, W topology) now
/// runs on the frontend before compute; this enum retains only the
/// `DegreeOverflow` runtime invariant that fires during contraction.
#[derive(Debug, Clone, PartialEq, Error)]
pub enum ComputeError {
    /// A vertex has more edges than it has tensor legs, or a self-loop /
    /// multi-edge exhausts its free legs mid-contraction. Not
    /// pre-checkable — depends on the contraction's intermediate state.
    #[error(
        "vertex '{vertex_id}' of type {vertex_type:?} has degree {degree} but only {max} legs available"
    )]
    DegreeOverflow {
        vertex_id: String,
        vertex_type: VertexType,
        degree: usize,
        max: usize,
    },
}
