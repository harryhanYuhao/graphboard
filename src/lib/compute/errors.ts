// src/lib/compute/errors.ts
//
// Structured error classification across the WASM compute boundary.
//
// The Rust crate exposes errors as their `Display` string (wasm-bindgen
// flattens `ComputeError` / load failures to a JS `Error` whose `.message`
// is the formatted text). Rather than let every consumer sniff that
// human-readable wording by substring (brittle — a Rust rephrase silently
// breaks remediation hints), we classify *once* here into a discriminated
// `ComputeErrorKind`, and thread the kind alongside the message to the UI.
//
// The classification is intentionally best-effort: an unrecognised message
// falls through to `kind: "unknown"`, which the UI renders with the generic
// remediation hint. Add new branches when the Rust side grows a new
// `ComputeError` variant and you want a targeted hint.

import type { ComputeErrorKind } from "./result-types";

/**
 * Classify a raw error message (from the worker, ultimately from the Rust
 * crate or the wasm loader) into a `ComputeErrorKind`.
 *
 * The matched substrings are the stable leading tokens of each Rust
 * `#[error("…")]` string in `crates/zxw/src/error.rs` — keep them in sync
 * if you reword the Rust messages. Unrecognised → `"unknown"`.
 */
export function classifyComputeError(rawMessage: string): ComputeErrorKind {
  const msg = rawMessage.toLowerCase();

  // Version handshake (main-thread wrapper) — not from the Rust crate,
  // but the wrapper reuses this classification for its own rejects.
  if (msg.includes("version mismatch")) return "version-mismatch";

  // Worker init / wasm fetch failures (browser loader, not Rust).
  if (msg.includes("failed to fetch") || msg.includes("invalid graph input")) {
    return "load-failed";
  }

  // Structural `ComputeError` variants — match on their leading tokens.
  if (msg.includes("not found (referenced by edge")) return "vertex-not-found";
  if (msg.includes("must have arity 2")) return "h-box-arity";
  if (msg.includes("boundaries must have degree 0 or 1")) {
    return "boundary-degree";
  }
  if (msg.includes("legs available")) return "degree-overflow";

  return "unknown";
}

/**
 * A JS `Error` that carries the classified `ComputeErrorKind` alongside the
 * raw message. Thrown by `computeTensor` so the UI can switch on `kind`
 * instead of substring-matching `message`.
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
