// crates/zxw/src/wasm.rs
//
// WASM entry points. Feature-gated so the same crate builds for native
// (`cargo test`) and for wasm-pack (`--features wasm`).
//
// Three exports beyond the Phase 2 `ping()` smoke test (plan §6.1):
//   - `init_panic_hook` — installs `console_error_panic_hook` so a Rust
//     panic surfaces as a JS `console.error` with a backtrace instead
//     of silently abortting the worker. Auto-runs on module
//     instantiation via `#[wasm_bindgen(start)]`.
//   - `compute_api_version` — returns the crate version, so the
//     frontend can refuse to call into a stale cached `.wasm`.
//   - `compute_tensor` — the real entry point: hops `GraphSlice` in
//     and `TensorResult` out through `serde_wasm_bindgen`, with an
//     optional JS progress callback.

use wasm_bindgen::prelude::*;

/// Trivial round-trip smoke test.
/// Used by `scripts/ping-wasm.mts` to confirm the wasm pipeline is
/// healthy end-to-end.
#[wasm_bindgen]
pub fn ping() -> String {
    "pong".to_string()
}

/// Install the panic hook on module instantiation. `#[wasm_bindgen(start)]`
/// makes the JS glue call this automatically when the `.wasm` instantiates,
/// so callers never have to remember it. Without the hook a panic (e.g. an
/// ndarray bounds error mid-contraction) silently aborts the worker
#[wasm_bindgen(start)]
pub fn init_panic_hook() {
    console_error_panic_hook::set_once();
}

/// Return the crate version string. The frontend asserts it matches the
/// expected value (read from the built wasm's `package.json`) before
/// calling any compute function
#[wasm_bindgen]
pub fn compute_api_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Compute the tensor represented by a ZXW graph.
///
/// `input` is a JS object matching the `GraphSlice` shape (camelCase,
/// nested `data` wrapper — see `src/graph.rs`). `on_progress`, if
/// supplied, is called after each edge contraction with
/// `(contracted_so_far, total_edges)`.
///
/// Returns a JS object matching `TensorResult` (camelCase fields). On a
/// structural `ComputeError` (corrupt graph, boundary degree > 1, …)
/// the result is thrown as a JS `Error` with the message from the
/// Rust-side `Display` impl.
///
/// Per-spider phase-parse failures are NOT errors here — they're caught
/// inside `zxw::compute_tensor` and surface as `warnings` on the
/// returned `TensorResult` (plan §5.5).
#[wasm_bindgen]
pub fn compute_tensor(
    input: JsValue,
    on_progress: Option<js_sys::Function>,
) -> Result<JsValue, JsValue> {
    // Deserialize the JS object into the Rust `GraphSlice`. Any shape
    // mismatch (missing field, wrong type, unknown vertex type) fails
    // here as a serde error.
    let graph: crate::GraphSlice = serde_wasm_bindgen::from_value(input)
        .map_err(|e| JsValue::from_str(&format!("invalid graph input: {e}")))?;

    // Wrap the optional JS callback in a Rust closure. When `None`,
    // the contraction loop skips the progress call with zero overhead
    // (the `Option<&dyn Fn>` is checked once per edge, not per
    // iteration of the inner GEMM).
    let progress: Option<Box<dyn Fn(usize, usize)>> = on_progress.map(|f| {
        Box::new(move |current: usize, total: usize| {
            // `call2` invokes the JS function with two positional
            // args. Errors inside the callback (e.g. a JS exception
            // thrown from `onProgress`) are silently swallowed — the
            // contraction must not be derailed by a UI-side bug.
            let _ = f.call2(
                &JsValue::NULL,
                &JsValue::from_f64(current as f64),
                &JsValue::from_f64(total as f64),
            );
        }) as Box<dyn Fn(usize, usize)>
    });

    let result = crate::compute_tensor(&graph, progress.as_deref())
        .map_err(|e| JsValue::from_str(&e.to_string()))?;

    serde_wasm_bindgen::to_value(&result)
        .map_err(|e| JsValue::from_str(&format!("failed to serialize result: {e}")))
}
