// Structured error classification across the WASM boundary. wasm-bindgen
// flattens errors to a JS `Error` whose `.message` is the human-readable
// text; rather than substring-sniff that wording everywhere (brittle to a
// Rust rephrase), classify once into `ComputeErrorKind` and thread the kind
// to the UI. Unrecognised messages fall through to `"unknown"`.
//
// Rust emits `DegreeOverflow` plus a structural pre-pass (`VertexNotFound`,
// `DuplicateNodeId`, `WInputCount`, `WOutputCount`, `WSelfLoop`) at the
// `compute_tensor` entry. `h-box-arity` and `boundary-degree` are caught
// pre-compute by `src/lib/graph/validate.ts` — their classifier branches
// match retired Rust wording kept for forward-compat.

import type { ComputeErrorKind } from "./result-types";

/**
 * Classify a raw error message into a `ComputeErrorKind`.
 *
 * Structural branches match the leading tokens of the Rust `#[error("…")]`
 * strings in `crates/zxw/src/error.rs` — keep in sync if those change.
 * Unrecognised -> `"unknown"`.
 */
export function classifyComputeError(rawMessage: string): ComputeErrorKind {
  const msg = rawMessage.toLowerCase();

  // Version handshake (main-thread wrapper) and wasm-load failures.
  if (msg.includes("version mismatch")) return "version-mismatch";
  if (msg.includes("failed to fetch") || msg.includes("invalid graph input")) {
    return "load-failed";
  }

  // Structural `ComputeError` variants.
  if (msg.includes("not found (referenced by edge")) return "vertex-not-found";
  if (msg.includes("duplicate node id")) return "duplicate-node-id";
  if (msg.includes("must have exactly 1 input leg")) return "w-input-count";
  if (msg.includes("must have at least 2 output legs")) {
    return "w-output-count";
  }
  if (msg.includes("has a self-loop")) return "w-self-loop";
  if (msg.includes("must have arity 2")) return "h-box-arity";
  if (msg.includes("boundaries must have degree 0 or 1")) {
    return "boundary-degree";
  }
  if (msg.includes("legs available")) return "degree-overflow";

  return "unknown";
}

/**
 * JS `Error` carrying the classified `ComputeErrorKind` alongside the
 * message, so the UI can switch on `kind` instead of matching text.
 */
export class ComputeError extends Error {
  readonly kind: ComputeErrorKind;

  constructor(
    kind: ComputeErrorKind,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "ComputeError";
    this.kind = kind;
  }
}
