// src/lib/compute/result-types.ts
//
// TypeScript mirror of the Rust `TensorResult` struct
// (`crates/zxw/src/contraction.rs`). The wire shape is determined by
// `#[serde(rename_all = "camelCase")]` on the Rust side and matches
// this type exactly — `serde_wasm_bindgen` round-trips the struct
// field-for-field across the WASM boundary.
//
// Keep this file in sync with the Rust struct when adding fields.
// The `computeTensor` test in `index.test.ts` asserts the field names.

/**
 * Output of a tensor-contraction compute call.
 *
 * - `shape`: tensor shape (e.g. `[2, 2]` for a 2×2 matrix, `[]` for a
 *   scalar).
 * - `data`: flat complex values in row-major order, each as `(re, im)`.
 * - `warnings`: per-spider phase-parse failures (plan §5.5). The
 *   computation still succeeds; the UI surfaces these in a collapsible
 *   "Warnings (N)" block.
 * - `inputCount` / `outputCount`: number of `input` / `output`
 *   boundary nodes in the source graph. Drives the UI's matrix
 *   interpretation: with `n = inputCount` and `m = outputCount`, the
 *   rank-(n+m) tensor is displayed as a `2^n × 2^m` matrix (rows =
 *   inputs flattened, cols = outputs flattened). Both zero → scalar.
 *   See `doc/plans.md` §5.4 for the axis-ordering contract.
 */
export type TensorResult = {
  shape: number[];
  data: [number, number][];
  warnings: string[];
  inputCount: number;
  outputCount: number;
};

/**
 * Discriminated kind for errors raised by the compute layer. Mirrors the
 * Rust `ComputeError` enum (`crates/zxw/src/error.rs`) plus the
 * non-Rust failure modes (version handshake, wasm load). See
 * `src/lib/compute/errors.ts` for the classifier.
 *
 * - `"version-mismatch"` — the cached wasm's `compute_api_version` didn't
 *   match the expected one (stale artifact).
 * - `"load-failed"` — the wasm module failed to fetch / instantiate.
 * - `"vertex-not-found"` — an edge referenced a missing vertex id.
 * - `"h-box-arity"` — an H-box has degree ≠ 2.
 * - `"boundary-degree"` — an input/output boundary has degree > 1.
 * - `"degree-overflow"` — a vertex has more edges than tensor legs.
 * - `"unknown"` — unrecognised message; rendered with the generic hint.
 */
export type ComputeErrorKind =
  | "version-mismatch"
  | "load-failed"
  | "vertex-not-found"
  | "h-box-arity"
  | "boundary-degree"
  | "degree-overflow"
  | "unknown";
