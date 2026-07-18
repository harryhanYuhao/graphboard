// crates/zxw/src/lib.rs
//
// ZXW compute layer — ZXW calculus tensor evaluation, ported from the
// JS frontend to Rust and exposed to the browser via WASM.
//
// Phase 2 ships an empty crate + a `ping()` wasm entry point. The
// module map below is the eventual shape; per-module bodies land in
// Phase 3 (parser + tensor model + per-vertex builders), Phase 4
// (contraction algorithm), Phase 5 (full WASM bindings + frontend
// wrapper).
//
// See `doc/plans.md` for the full plan.

pub mod contraction;
pub mod error;
pub mod graph;
pub mod nodes;
pub mod phase;
pub mod tensor;

#[cfg(feature = "wasm")]
pub mod wasm;

