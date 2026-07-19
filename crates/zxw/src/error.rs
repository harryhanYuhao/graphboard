// crates/zxw/src/error.rs
//
// Error types for the compute layer. Phase 3 ships `PhaseError` (the
// phase-parser error surface). Phase 4 adds `GraphError` and
// `ComputeError` for malformed-input / contraction failures; those live
// here too once they're needed.
//
// `PhaseError` messages are crafted to *contain* the same fragments the
// JS parser tests assert on (the Rust port + the JS original load the
// shared fixture at `tests/fixtures/phase_grammar.json`, and several
// cases match `error.toLowerCase().includes(fragment)`). Keep the wording
// in sync with `src/lib/phase/parser.ts` when editing.

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
