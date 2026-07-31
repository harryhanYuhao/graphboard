// Structured error classification across the WASM boundary. wasm-bindgen
// flattens errors to a JS `Error` whose `.message` is the human-readable
// text; rather than substring-sniff that wording everywhere (brittle to a
// Rust rephrase), classify once into `ComputeErrorKind` and thread the kind
// to the UI. Unrecognised messages fall through to `"unknown"`.

import type { ComputeErrorKind } from "./result-types";

/**
 * Classify a raw error message into a `ComputeErrorKind`.
 *
 * Matched substrings are the leading tokens of each Rust `#[error("…")]`
 * string in `crates/zxw/src/error.rs` — keep in sync if those change.
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
