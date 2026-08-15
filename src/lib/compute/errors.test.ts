// Pins error-message → `ComputeErrorKind` classification. Matched
// substrings mirror the Rust `#[error("…")]` tokens and the loader
// failure modes, so a Rust reword surfaces here instead of silently
// degrading the UI's hint to `"unknown"`. `h-box-arity` /
// `boundary-degree` match retired Rust wording (frontend-validated now)
// kept for forward-compat.

import { describe, expect, it } from "vitest";

import { classifyComputeError, ComputeError } from "./errors";

describe("classifyComputeError", () => {
  it("matches the Rust VertexNotFound message", () => {
    expect(
      classifyComputeError(
        "vertex 'v3' not found (referenced by edge 'e7')",
      ),
    ).toBe("vertex-not-found");
  });

  it("matches the Rust DuplicateNodeId message", () => {
    expect(
      classifyComputeError("duplicate node id 'a' in graph"),
    ).toBe("duplicate-node-id");
  });

  it("matches the Rust WInputCount message", () => {
    expect(
      classifyComputeError("w node 'w1' must have exactly 1 input leg, got 2"),
    ).toBe("w-input-count");
  });

  it("matches the Rust WOutputCount message", () => {
    expect(
      classifyComputeError(
        "w node 'w1' must have at least 2 output legs, got 1",
      ),
    ).toBe("w-output-count");
  });

  it("matches the Rust WSelfLoop message", () => {
    expect(
      classifyComputeError(
        "w node 'w1' has a self-loop; self-loops are ill-defined for a directional W",
      ),
    ).toBe("w-self-loop");
  });

  it("matches the retired Rust HBoxArity wording (frontend-validated now)", () => {
    expect(
      classifyComputeError("H-box vertex 'h1' must have arity 2, got 3"),
    ).toBe("h-box-arity");
  });

  it("matches the retired Rust BoundaryDegreeViolation wording (frontend-validated now)", () => {
    expect(
      classifyComputeError(
        "boundary vertex 'in0' has degree 2; boundaries must have degree 0 or 1",
      ),
    ).toBe("boundary-degree");
  });

  it("matches the Rust DegreeOverflow message", () => {
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
