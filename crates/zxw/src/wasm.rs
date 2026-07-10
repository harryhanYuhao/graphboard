// crates/zxw/src/wasm.rs
//
// WASM entry points. Feature-gated so the same crate builds for
// native (`cargo test`) and for wasm-pack (`--features wasm`).
//
// Phase 2 only ships `ping()` so we can verify the build pipeline.
// Phase 5 adds `compute_tensor(input: JsValue) -> Result<JsValue,
// JsValue>` that hops the `GraphSlice` through serde_wasm_bindgen.

use wasm_bindgen::prelude::*;

/// Trivial round-trip smoke test. Returns the literal `"pong"`.
/// Used by `scripts/ping-wasm.mts` to confirm the wasm pipeline is
/// healthy end-to-end.
///
/// Note: returns `String` rather than `&'static str` because
/// `#[wasm_bindgen]` cannot expose borrowed references — Rust's
/// lifetimes don't carry through to the JS boundary. The cost is one
/// tiny allocation per call, which is fine for a smoke test.
#[wasm_bindgen]
pub fn ping() -> String {
    "pong".to_string()
}