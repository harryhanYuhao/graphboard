// crates/zxw/src/wasm.rs
//
// WASM entry points. Feature-gated so the same crate builds for native
// (`cargo test`) and for wasm-pack (`--features wasm`).

use wasm_bindgen::prelude::*;

/// Round-trip smoke test used by `scripts/ping-wasm.mts` to confirm the
/// wasm pipeline is healthy end-to-end.
#[wasm_bindgen]
pub fn ping() -> String {
    "pong".to_string()
}

/// Install the panic hook on instantiation. `#[wasm_bindgen(start)]` runs
/// this automatically, so panics surface to the console instead of
/// silently aborting the worker.
#[wasm_bindgen(start)]
pub fn init_panic_hook() {
    console_error_panic_hook::set_once();
}

/// Crate version string. The frontend checks this against the expected
/// value before calling any compute function.
#[wasm_bindgen]
pub fn compute_api_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Compute the tensor represented by a ZXW graph.
///
/// `input` matches the `GraphSlice` shape (camelCase, nested `data`). If
/// supplied, `on_progress` is called per edge contraction with
/// `(contracted_so_far, total_edges)`. Returns `TensorResult` (camelCase),
/// or throws a JS `Error` on a structural `ComputeError`.
///
/// Per-spider phase-parse failures are not errors here — they surface as
/// `warnings` on the `TensorResult`.
#[wasm_bindgen]
pub fn compute_tensor(
    input: JsValue,
    on_progress: Option<js_sys::Function>,
) -> Result<JsValue, JsValue> {
    let graph: crate::FrontendGraphSlice = serde_wasm_bindgen::from_value(input)
        .map_err(|e| JsValue::from_str(&format!("invalid graph input: {e}")))?;

    // When `None`, the loop skips the progress call with zero overhead
    // (checked once per edge, not per inner GEMM iteration). Callback
    // errors are swallowed so a UI-side bug can't derail the contraction.
    let progress: Option<Box<dyn Fn(usize, usize)>> = on_progress.map(|f| {
        Box::new(move |current: usize, total: usize| {
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
