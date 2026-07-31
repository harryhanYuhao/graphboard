// crates/zxw/src/error.rs
//
// Error types for the compute layer. `PhaseError` covers the phase parser;
// `ComputeError` covers `compute_tensor`. Per-spider phase-parse failures
// inside `compute_tensor` are NOT `ComputeError`s — they're downgraded to
// warnings on the `TensorResult` (plan §5.5).
//
// `PhaseError` messages contain the same fragments the JS parser tests
// assert on (shared fixture: `tests/fixtures/phase_grammar.json`, matched
// via `error.toLowerCase().includes(fragment)`). Keep wording in sync
// with `src/lib/phase/parser.ts` when editing.

use crate::graph::VertexType;
use thiserror::Error;

/// Errors raised by `parse_phase`. Mirrors the JS `ParseError` surface
/// in `src/lib/phase/parser.ts`.
#[derive(Debug, Clone, PartialEq, Error)]
pub enum PhaseError {
    /// A bare identifier (`alpha`, `pi2`) or `\word` (`\alpha`) that isn't
    /// `\pi`. The whole token is reported, not just the leading letters
    /// (`pi2` surfaces as `"pi2"`, not `"pi"`).
    ///
    /// Divergence from JS: JS reports `(only pi is supported)` for a
    /// bare-word factor but `(only \pi is supported)` for a `\word`;
    /// Rust emits the `\pi` form uniformly. The fixture only asserts on
    /// the token fragment, so the cross-test still passes. Two ignored
    /// tests in `tests/phase_edge_cases.rs` pin the full byte-for-byte
    /// divergence.
    #[error("Unknown variable '{0}' (only \\pi is supported in v1)")]
    UnknownVariable(String),

    /// An unexpected character, e.g. `#` in `1 # 2`. `found` is empty for
    /// end-of-input; `position` is the 0-based index into the stripped input.
    #[error("Unexpected '{found}' at position {position}")]
    UnexpectedToken { found: String, position: usize },

    /// Input ended mid-expression, e.g. `(1 + 2` or a lone `+`.
    #[error("Unexpected end of input")]
    UnexpectedEndOfInput,

    /// A `(` with no matching `)` before end-of-input.
    #[error("Expected ')' at position {0}")]
    MissingCloseParen(usize),

    /// A non-finite arithmetic result (e.g. `1 / 0` → `±inf`, or `NaN`),
    /// surfaced before it can corrupt the tensor builder.
    #[error("Phase is not finite ({0})")]
    NonFinite(f64),
}

/// Errors raised by `compute_tensor` — structural problems the contraction
/// layer can't recover from (malformed graph, arity mismatch, bad
/// boundary wiring). Per-spider phase-parse failures are not here; they
/// downgrade to warnings on the `TensorResult` (plan §5.5).
#[derive(Debug, Clone, PartialEq, Error)]
pub enum ComputeError {
    /// An edge referenced a vertex id not in `nodes` — corrupt graph.
    #[error("vertex '{vertex_id}' not found (referenced by edge '{edge_id}')")]
    VertexNotFound {
        vertex_id: String,
        edge_id: String,
    },

    /// An H-box with degree ≠ 2. H-boxes are fixed-arity 2 (plan §4.3);
    /// chain them for larger circuits.
    #[error("H-box vertex '{vertex_id}' must have arity 2, got {arity}")]
    HBoxArity { vertex_id: String, arity: usize },

    /// A W node without exactly one input leg. The W generator maps one
    /// input qubit (the top/target leg) to N outputs; an edge targeting
    /// the W counts as an input edge.
    #[error("W node '{vertex_id}' must have exactly 1 input leg, got {actual}")]
    WInputCount { vertex_id: String, actual: usize },

    /// A W node with fewer than 2 output legs — only meaningful as a
    /// 1-to-many map. An edge with the W as its source counts as an
    /// output edge.
    #[error("W node '{vertex_id}' must have at least 2 output legs, got {actual}")]
    WOutputCount { vertex_id: String, actual: usize },

    /// A boundary (`input`/`output`) with degree > 1. Boundaries declare
    /// exactly one open leg (or none, if dangling). Plan §5.6.
    #[error(
        "boundary vertex '{vertex_id}' has degree {degree}; boundaries must have degree 0 or 1"
    )]
    BoundaryDegreeViolation { vertex_id: String, degree: usize },

    /// A vertex with more edges than tensor legs. Only fires for
    /// multi-edges exceeding the free-leg count. Plan §5.6.
    #[error(
        "vertex '{vertex_id}' of type {vertex_type:?} has degree {degree} but only {max} legs available"
    )]
    DegreeOverflow {
        vertex_id: String,
        vertex_type: VertexType,
        degree: usize,
        max: usize,
    },

    /// Two nodes share the same `id` — the graph's identity contract, so a
    /// duplicate silently clobbers the earlier node. The frontend uses
    /// `nanoid`, so this shouldn't happen on real payloads; the compute
    /// layer still defends against corrupt input rather than returning `Ok`.
    #[error("duplicate node id '{vertex_id}'")]
    DuplicateNodeId { vertex_id: String },

    /// An edge directly connecting two boundary vertices (e.g.
    /// `input → output`). They have no tensor to contract, so the edge's
    /// semantics are undefined — surfaced as an error rather than guessed.
    ///
    /// Note: the endpoints are `from`/`to`, not `source`/`target`, because
    /// `source` is reserved in `thiserror`'s `#[error]` (it maps to
    /// `std::error::Error::source`).
    #[error(
        "edge '{edge_id}' connects two boundary vertices ('{from}' -> '{to}'); \
         a boundary must connect to a tensor vertex"
    )]
    BoundaryToBoundaryEdge {
        edge_id: String,
        from: String,
        to: String,
    },
}
