// crates/zxw/src/error.rs
//
// `thiserror` enums for the compute layer:
//   - `PhaseError` — phase parser errors (Phase 3).
//   - `GraphError` — malformed input / unsupported vertex type /
//     contraction failures (Phase 3–4).
//   - `ComputeError` — top-level wrapper that Phase 4's `compute_tensor`
//     returns and Phase 5's wasm.rs maps to a JsValue.