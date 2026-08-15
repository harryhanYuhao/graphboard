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

/// Errors raised by `compute_tensor`. Structural validation (duplicate
/// ids, dangling edge refs, W topology) runs as a pre-pass at the compute
/// entry point — `compute_tensor` is a public wasm entry accepting
/// arbitrary JS objects, and a panic crossing the wasm boundary is a
/// useless JS exception. Boundary degree and H-box arity are still
/// frontend-only checks (the wasm pre-pass may grow them later).
#[derive(Debug, Clone, PartialEq, Error)]
pub enum ComputeError {
    /// An edge references a vertex id that no node carries.
    /// Display must keep the `not found (referenced by edge` substring —
    /// the TS classifier (`src/lib/compute/errors.ts`) matches it.
    #[error("vertex '{vertex_id}' not found (referenced by edge '{edge_id}')")]
    VertexNotFound {
        vertex_id: String,
        edge_id: String,
    },

    /// Two nodes share one id. Silently dropping one would compute a
    /// wrong tensor.
    #[error("duplicate node id '{vertex_id}' in graph")]
    DuplicateNodeId { vertex_id: String },

    /// A W node without exactly 1 incoming edge (mirrors the frontend's
    /// `w-input-count` check).
    #[error("w node '{vertex_id}' must have exactly 1 input leg, got {count}")]
    WInputCount { vertex_id: String, count: usize },

    /// A W node with fewer than 2 outgoing edges (mirrors the frontend's
    /// `w-output-count` check).
    #[error("w node '{vertex_id}' must have at least 2 output legs, got {count}")]
    WOutputCount { vertex_id: String, count: usize },

    /// A W node with a self-loop: connecting an output leg back to the
    /// single input is ill-defined for the directional W — contraction
    /// would trace two arbitrary free legs and produce a meaningless
    /// tensor. Display must keep the `has a self-loop` substring — the TS
    /// classifier matches it.
    #[error("w node '{vertex_id}' has a self-loop; self-loops are ill-defined for a directional W")]
    WSelfLoop { vertex_id: String },

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
