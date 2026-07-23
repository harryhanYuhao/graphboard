// src/lib/compute/errors.test.ts
//
// Pins the error-message → `ComputeErrorKind` classification. The matched
// substrings mirror the leading tokens of each Rust `#[error("…")]` string
// in `crates/zxw/src/error.rs` plus the loader failure modes. If the Rust
// side rewords a variant, this test surfaces the drift instead of silently
// degrading the UI's remediation hint to `"unknown"`.

import { describe, expect, it } from "vitest";

import { classifyComputeError, ComputeError } from "./errors";

describe("classifyComputeError", () => {
  it("matches the Rust VertexNotFound message", () => {
    // Mirrors crates/zxw/src/error.rs:61.
    expect(
      classifyComputeError(
        "vertex 'v3' not found (referenced by edge 'e7')",
      ),
    ).toBe("vertex-not-found");
  });

  it("matches the Rust HBoxArity message", () => {
    // Mirrors crates/zxw/src/error.rs:70.
    expect(
      classifyComputeError("H-box vertex 'h1' must have arity 2, got 3"),
    ).toBe("h-box-arity");
  });

  it("matches the Rust BoundaryDegreeViolation message", () => {
    // Mirrors crates/zxw/src/error.rs:78.
    expect(
      classifyComputeError(
        "boundary vertex 'in0' has degree 2; boundaries must have degree 0 or 1",
      ),
    ).toBe("boundary-degree");
  });

  it("matches the Rust DegreeOverflow message", () => {
    // Mirrors crates/zxw/src/error.rs:86.
    expect(
      classifyComputeError(
        "vertex 'z2' of type Z has degree 4 but only 2 legs available",
      ),
    ).toBe("degree-overflow");
  });

  it("classifies version-mismatch (wrapper-level, not Rust)", () => {
    expect(
      classifyComputeError(
        "WASM version mismatch: expected 0.3.0, got 0.2.1",
      ),
    ).toBe("version-mismatch");
  });

  it("classifies wasm load failures", () => {
    expect(classifyComputeError("Failed to fetch wasm asset")).toBe(
      "load-failed",
    );
    expect(classifyComputeError("invalid graph input")).toBe("load-failed");
  });

  it("falls back to 'unknown' for unrecognised wording", () => {
    expect(classifyComputeError("something completely unexpected")).toBe(
      "unknown",
    );
  });
});

describe("ComputeError", () => {
  it("carries the classified kind alongside the message", () => {
    const err = new ComputeError("degree-overflow", "vertex 'z2' …");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("ComputeError");
    expect(err.kind).toBe("degree-overflow");
    expect(err.message).toBe("vertex 'z2' …");
  });

  it("preserves an optional cause", () => {
    const cause = new Error("underlying");
    const err = new ComputeError("unknown", "wrapped", { cause });
    expect(err.cause).toBe(cause);
  });
});
