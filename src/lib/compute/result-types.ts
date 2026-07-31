// TypeScript mirror of the Rust `TensorResult` struct
// (`crates/zxw/src/contraction.rs`); the wire shape is set by
// `#[serde(rename_all = "camelCase")]` and matches field-for-field.
// Keep in sync with the Rust struct — `index.test.ts` asserts names.

/**
 * Output of a tensor-contraction compute call.
 *
 * - `shape`: tensor shape (`[2, 2]` for a 2x2 matrix, `[]` for scalar).
 * - `data`: flat complex values in row-major order, each as `(re, im)`.
 * - `warnings`: per-spider phase-parse failures; computation still
 *   succeeds and the UI surfaces them in a "Warnings (N)" block.
 * - `inputCount` / `outputCount`: number of input / output boundary
 *   nodes. With `n = inputCount`, `m = outputCount`, the rank-(n+m)
 *   tensor is shown as a `2^n x 2^m` matrix (rows = inputs, cols =
 *   outputs). Both zero -> scalar.
 */
export type TensorResult = {
  shape: number[];
  data: [number, number][];
  warnings: string[];
  inputCount: number;
  outputCount: number;
};

/**
 * Discriminated kind for compute errors. Mirrors the Rust
 * `ComputeError` enum plus non-Rust failure modes (version handshake,
 * wasm load); classified in `errors.ts`.
 */
export type ComputeErrorKind =
  | "version-mismatch"
  | "load-failed"
  | "vertex-not-found"
  | "h-box-arity"
  | "boundary-degree"
  | "degree-overflow"
  | "unknown";
