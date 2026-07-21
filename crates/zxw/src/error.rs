// crates/zxw/src/error.rs
//
// Error types for the compute layer. `PhaseError` covers the phase
// parser (Phase 3); `ComputeError` covers the top-level contraction
// entry point (Phase 4). Per plan §5.5, phase-parse failures inside
// `compute_tensor` are NOT `ComputeError`s — they're caught per-spider
// and downgraded to warnings on the `TensorResult`.
//
// `PhaseError` messages are crafted to *contain* the same fragments the
// JS parser tests assert on (the Rust port + the JS original load the
// shared fixture at `tests/fixtures/phase_grammar.json`, and several
// cases match `error.toLowerCase().includes(fragment)`). Keep the wording
// in sync with `src/lib/phase/parser.ts` when editing.

use crate::graph::VertexType;
use thiserror::Error;

/// Errors raised by `parse_phase`. Mirrors the JS `ParseError` surface
/// in `src/lib/phase/parser.ts` — same fragments, same cases.
#[derive(Debug, Clone, PartialEq, Error)]
pub enum PhaseError {
    /// A bare identifier (`alpha`, `pi2`) or a `\word` (`\alpha`) that
    /// isn't `\pi`. The whole token is reported, not just the leading
    /// letters — `pi2` surfaces as `"pi2"`, not `"pi"`, so the user can
    /// tell what they typed wrong.
    #[error("Unknown variable '{0}' (only \\pi is supported in v1)")]
    UnknownVariable(String),

    /// A character that has no business here, e.g. `#` in `1 # 2`.
    /// `found` is the offending char (or empty for end-of-input);
    /// `position` is the 0-based index into the *stripped* input.
    #[error("Unexpected '{found}' at position {position}")]
    UnexpectedToken { found: String, position: usize },

    /// Input ended mid-expression, e.g. `(1 + 2` with no close paren
    /// consumed anything yet, or a lone `+`.
    #[error("Unexpected end of input")]
    UnexpectedEndOfInput,

    /// A `(` had no matching `)` before end-of-input.
    #[error("Expected ')' at position {0}")]
    MissingCloseParen(usize),

    /// A successful arithmetic result that isn't finite (e.g. `1 / 0`
    /// produced `±inf` or `NaN`). Surfacing this here prevents the
    /// corruption from propagating into the tensor builder.
    #[error("Phase is not finite ({0})")]
    NonFinite(f64),
}

/// Errors raised by `compute_tensor`. These are *structural* problems
/// the contraction layer can't recover from — a malformed graph, an
/// arity mismatch, a boundary wired up wrong. Per-spider phase-parse
/// failures are NOT here; those are downgraded to warnings on the
/// `TensorResult` (plan §5.5).
#[derive(Debug, Clone, PartialEq, Error)]
pub enum ComputeError {
    /// An edge referenced a vertex id that doesn't appear in `nodes`.
    /// This is a corrupt-graph error — the frontend shouldn't emit such
    /// a payload, but the compute layer still has to defend against it.
    #[error("vertex '{vertex_id}' not found (referenced by edge '{edge_id}')")]
    VertexNotFound {
        vertex_id: String,
        edge_id: String,
    },

    /// An H-box has degree ≠ 2. The H-box builder is fixed-arity 2 per
    /// plan §4.3 (for larger circuits the user chains H-boxes), so any
    /// other degree is a wiring error.
    #[error("H-box vertex '{vertex_id}' must have arity 2, got {arity}")]
    HBoxArity { vertex_id: String, arity: usize },

    /// A boundary vertex (`input` / `output`) has degree > 1. Boundaries
    /// declare exactly one open leg of the result; they can be degree 0
    /// (a dangling open leg) or degree 1 (the normal case), but can't
    /// fan out. Plan §5.6.
    #[error(
        "boundary vertex '{vertex_id}' has degree {degree}; boundaries must have degree 0 or 1"
    )]
    BoundaryDegreeViolation { vertex_id: String, degree: usize },

    /// A vertex has more edges than it has tensor legs. Arity = degree
    /// for all builders (they take `arity: usize`), so this only fires
    /// for multi-edges that exceed the vertex's free-leg count. Plan §5.6.
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

