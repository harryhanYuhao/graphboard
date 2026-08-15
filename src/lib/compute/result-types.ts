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
 *   tensor is shown as a `2^m x 2^n` matrix (rows = outputs, cols =
 *   inputs) — see `matrix-format.ts` and ComputeResultDialog. Both
 *   zero -> scalar.
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
 *
 * The union must stay a superset of `ValidationErrorKind`
 * (`src/lib/graph/validate.ts`): `useCompute` rejects the compute
 * promise with the frontend validator's first error, so
 * frontend-only kinds (`boundary-order`) are valid members even
 * though `classifyComputeError` never emits them.
 */
export type ComputeErrorKind =
  | "version-mismatch"
  | "load-failed"
  | "vertex-not-found"
  | "h-box-arity"
  | "boundary-degree"
  | "boundary-order"
  | "degree-overflow"
  | "duplicate-node-id"
  | "w-input-count"
  | "w-output-count"
  | "w-self-loop"
  | "unknown";
