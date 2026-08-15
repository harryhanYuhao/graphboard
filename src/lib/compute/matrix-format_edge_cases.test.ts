// Edge-case coverage for the compute layer's pure helpers and error
// classification. The sibling suites cover the happy paths; this file fills
// the gaps — especially `formatComplex`. Surprising-but-actual output is
// pinned with a "formatting quirk" comment and asserted exactly, so a fix
// surfaces as a failing test. Only NaN/throw cases are `it.skip`d.

import { describe, expect, it } from "vitest";

import { bitsToLabel, formatComplex, matrixEntry } from "./matrix-format";
import { classifyComputeError, ComputeError } from "./errors";
import type { ComputeErrorKind, TensorResult } from "./result-types";

// The negative-imaginary branch uses Unicode minus U+2212 (−), not ASCII '-'.
// Asserting the exact code point keeps a refactor from swapping them.
const MINUS = "\u2212";

// ============================================================================
// formatComplex — the prime focus.
//
// Contract (matrix-format.ts):
//   reStr = |re| < eps ? "0" : re.toFixed(decimals)
//   imStr = |im| < eps ? "" : (im>=0 ? "+" : MINUS) + |im|.toFixed(decimals) + "i"
//   return reStr + imStr
// Defaults: eps = 1e-10, decimals = 3.
// ============================================================================

describe("formatComplex — pure real", () => {
  it("positive real → fixed to 3 decimals (default)", () => {
    expect(formatComplex([3.14, 0])).toBe("3.140");
  });

  it("negative real → keeps the ASCII minus sign on the real part", () => {
    // The real branch uses toFixed (ASCII '-'); only the imaginary branch
    // swaps in U+2212.
    expect(formatComplex([-2.5, 0])).toBe("-2.500");
  });

  it("integer-valued real → still renders 3 trailing decimals (no integer short-form)", () => {
    expect(formatComplex([5, 0])).toBe("5.000");
  });

  it("exactly zero → '0' (single-character, no decimals)", () => {
    expect(formatComplex([0, 0])).toBe("0");
  });

  it("large real → full fixed-point, no exponent shortening", () => {
    expect(formatComplex([1e6, 0])).toBe("1000000.000");
  });

  it("pi to 4 decimals → rounds the last digit", () => {
    expect(formatComplex([3.14159265358979, 0], { decimals: 4 })).toBe(
      "3.1416",
    );
  });
});

describe("formatComplex — imaginary", () => {
  it("positive imaginary only → real renders '0', then '+1.000i'", () => {
    // Not bare 'i'/'1i': real zero is always emitted, and the magnitude is
    // fixed to 3 decimals with a leading '+'.
    expect(formatComplex([0, 1])).toBe("0+1.000i");
  });

  it("negative imaginary only → uses Unicode minus U+2212, not ASCII '-'", () => {
    expect(formatComplex([0, -1])).toBe(`0${MINUS}1.000i`);
  });

  it("both positive → '1.000+1.000i'", () => {
    expect(formatComplex([1, 1])).toBe("1.000+1.000i");
  });

  it("positive real, negative imaginary → Unicode minus on the imaginary part", () => {
    expect(formatComplex([1, -1])).toBe(`1.000${MINUS}1.000i`);
  });
});

describe("formatComplex — eps threshold", () => {
  it("real below default eps (1e-10) → treated as zero ('0')", () => {
    expect(formatComplex([1e-11, 0])).toBe("0");
  });

  it("imaginary below default eps → imaginary part dropped entirely", () => {
    expect(formatComplex([0, 1e-11])).toBe("0");
  });

  it("real just above eps (1e-9) → renders '0.000', NOT '0' (formatting quirk)", () => {
    // |1e-9| > eps → toFixed rounds it to "0.000", unlike the sub-eps "0".
    expect(formatComplex([1e-9, 0])).toBe("0.000");
  });

  it("negative real just above eps (-1e-9) → renders '-0.000' (formatting quirk)", () => {
    // A tiny negative keeps its sign through toFixed, giving the ugly "-0.000".
    expect(formatComplex([-1e-9, 0])).toBe("-0.000");
  });

  it("0.0001 (above eps, rounds to zero visually) → '0.000' (formatting quirk)", () => {
    // Above eps but rounds to "0.000" at 3 decimals.
    expect(formatComplex([0.0001, 0])).toBe("0.000");
  });

  it("custom eps suppresses a real that the default eps would render", () => {
    // 0.005 > default eps; eps=0.01 swallows it → "0".
    expect(formatComplex([0.005, 0], { eps: 0.01 })).toBe("0");
  });

  it("custom eps suppresses an imaginary that the default eps would render", () => {
    expect(formatComplex([0, 0.005], { eps: 0.01 })).toBe("0");
  });
});

describe("formatComplex — custom decimals", () => {
  it("decimals: 2 → two trailing digits, no padding beyond that", () => {
    expect(formatComplex([3.14159, 0], { decimals: 2 })).toBe("3.14");
  });

  it("decimals: 2 applies to the imaginary magnitude too", () => {
    expect(formatComplex([0, 1], { decimals: 2 })).toBe("0+1.00i");
  });
});

describe("formatComplex — non-finite", () => {
  it("Infinity real → propagates as the literal string 'Infinity'", () => {
    // |Infinity| < eps is false → toFixed, and (Infinity).toFixed(3) === "Infinity".
    expect(formatComplex([Infinity, 0])).toBe("Infinity");
  });

  // NaN output is broken-looking and not a contract; skipped, not pinned.
  it.skip("NaN real → currently emits 'NaN' (skipped: non-finite, not a contract)", () => {
    expect(formatComplex([NaN, 0])).toBe("NaN");
  });

  it.skip("both NaN → currently emits 'NaN−NaNi' (skipped: non-finite, not a contract)", () => {
    expect(formatComplex([NaN, NaN])).toBe(`NaN${MINUS}NaNi`);
  });
});

// ============================================================================
// bitsToLabel — out-of-range / boundary cases.
// ============================================================================

describe("bitsToLabel — boundary & overflow", () => {
  it("0 qubits → '•' (already covered; pinned here too for the gap file)", () => {
    expect(bitsToLabel(0, 0)).toBe("•");
  });

  it("1 qubit: index 0 → |0⟩, index 1 → |1⟩", () => {
    expect(bitsToLabel(0, 1)).toBe("|0⟩");
    expect(bitsToLabel(1, 1)).toBe("|1⟩");
  });

  it("2 qubits big-endian: 0→|00⟩, 1→|01⟩, 2→|10⟩, 3→|11⟩", () => {
    expect(bitsToLabel(0, 2)).toBe("|00⟩");
    expect(bitsToLabel(1, 2)).toBe("|01⟩");
    expect(bitsToLabel(2, 2)).toBe("|10⟩");
    expect(bitsToLabel(3, 2)).toBe("|11⟩");
  });

  it("3 qubits: 0→|000⟩, 7→|111⟩", () => {
    expect(bitsToLabel(0, 3)).toBe("|000⟩");
    expect(bitsToLabel(7, 3)).toBe("|111⟩");
  });

  it("out-of-range index silently masks overflow bits (no error, no ellipsis)", () => {
    // Only the low `qubits` bits are read; overflow is silently dropped.
    expect(bitsToLabel(4, 1)).toBe("|0⟩");
    expect(bitsToLabel(99, 1)).toBe("|1⟩");
  });
});

// ============================================================================
// matrixEntry — out-of-bounds behaviour.
// ============================================================================

describe("matrixEntry — out of bounds", () => {
  // 2×2 identity, row-major over [in, out].
  const id2x2: [number, number][] = [
    [1, 0],
    [0, 0],
    [0, 0],
    [1, 0],
  ];

  it("all four entries of a 2×2 identity are correct", () => {
    expect(matrixEntry(id2x2, 0, 0, 1)).toEqual([1, 0]);
    expect(matrixEntry(id2x2, 1, 1, 1)).toEqual([1, 0]);
    expect(matrixEntry(id2x2, 0, 1, 1)).toEqual([0, 0]);
    expect(matrixEntry(id2x2, 1, 0, 1)).toEqual([0, 0]);
  });

  it("out-of-bounds (row=99, col=99) → undefined (silent, no throw)", () => {
    // No bounds check; an OOB access returns undefined rather than throwing.
    expect(matrixEntry(id2x2, 99, 99, 1)).toBeUndefined();
  });
});

describe("matrixEntry — row stride at large outputCount", () => {
  it("outputCount 31: stride is 2**31 (positive), not int32-negative 1<<31", () => {
    // `1 << 31` wraps to -2147483648, so col*stride+row indexed nowhere.
    // ComputeResultDialog uses 2 ** outputCount; the stride must match.
    // Probe via a sparse (dictionary-backed) array — no 2 GB allocation.
    const data: [number, number][] = [];
    data[2 ** 31] = [7, 0];
    expect(matrixEntry(data, 0, 1, 31)).toEqual([7, 0]);
  });
});

describe("matrixEntry — 4×4 big-endian flat-index formula", () => {
  // 2 inputs + 2 outputs → 4×4. A distinct sentinel per slot verifies the
  // exact row/col → flat-index mapping: col * (1<<outputCount) + row.
  const data: [number, number][] = Array.from({ length: 16 }, (_, i) => [
    i,
    0,
  ]);

  it("M(0,0) → data[0*4+0] = data[0]", () => {
    expect(matrixEntry(data, 0, 0, 2)).toEqual([0, 0]);
  });

  it("M(3,3) → data[3*4+3] = data[15]", () => {
    expect(matrixEntry(data, 3, 3, 2)).toEqual([15, 0]);
  });

  it("M(2,2) → data[2*4+2] = data[10]", () => {
    expect(matrixEntry(data, 2, 2, 2)).toEqual([10, 0]);
  });

  it("M(1,0) → data[0*4+1] = data[1] (column-major over rows within a column)", () => {
    expect(matrixEntry(data, 1, 0, 2)).toEqual([1, 0]);
  });

  it("M(0,1) → data[1*4+0] = data[4]", () => {
    expect(matrixEntry(data, 0, 1, 2)).toEqual([4, 0]);
  });
});

// ============================================================================
// classifyComputeError — boundary cases beyond errors.test.ts's happy paths.
// ============================================================================

describe("classifyComputeError — boundary cases", () => {
  it("empty message → 'unknown' (no substring matches)", () => {
    expect(classifyComputeError("")).toBe("unknown");
  });

  it("unrecognised wording → 'unknown'", () => {
    expect(classifyComputeError("something totally new")).toBe("unknown");
  });

  it("is case-sensitive: 'VERTEX NOT FOUND' (uppercase) → 'unknown'", () => {
    // The input is lowercased then matched against exact tokens. "VERTEX NOT
    // FOUND" → "vertex not found", which lacks the required
    // "not found (referenced by edge" token.
    expect(classifyComputeError("VERTEX NOT FOUND")).toBe("unknown");
  });

  it("substring match: a longer message still classifies if it contains the token", () => {
    expect(
      classifyComputeError(
        "the vertex 'x' not found (referenced by edge 'e1') in some other context",
      ),
    ).toBe("vertex-not-found");
  });
});

describe("classifyComputeError — every classifier-reachable ComputeErrorKind", () => {
  // Reachability guard: a new union variant without a classifier branch
  // shows up here. `h-box-arity` / `boundary-degree` match Rust wording
  // that error.rs no longer emits (those checks moved to frontend
  // validate.ts); the branches are kept for forward-compat, so they stay
  // "reachable" here. `boundary-order` is frontend-validator-only (never
  // crosses the worker), so it has no classifier branch and is excluded;
  // it is still constructable (see the test below) because `useCompute`
  // rejects the compute promise with validation errors.
  const cases: Array<[string, ComputeErrorKind]> = [
    ["WASM version mismatch: expected 0.3.0, got 0.2.1", "version-mismatch"],
    ["Failed to fetch wasm asset", "load-failed"],
    ["vertex 'v3' not found (referenced by edge 'e7')", "vertex-not-found"],
    ["duplicate node id 'a' in graph", "duplicate-node-id"],
    ["w node 'w1' must have exactly 1 input leg, got 2", "w-input-count"],
    ["w node 'w1' must have at least 2 output legs, got 1", "w-output-count"],
    [
      "w node 'w1' has a self-loop; self-loops are ill-defined for a directional W",
      "w-self-loop",
    ],
    ["H-box vertex 'h1' must have arity 2, got 3", "h-box-arity"],
    [
      "boundary vertex 'in0' has degree 2; boundaries must have degree 0 or 1",
      "boundary-degree",
    ],
    [
      "vertex 'z2' of type Z has degree 4 but only 2 legs available",
      "degree-overflow",
    ],
    ["something completely unexpected", "unknown"],
  ];

  for (const [msg, expected] of cases) {
    it(`classifies ${JSON.stringify(msg).slice(0, 40)}… → ${expected}`, () => {
      expect(classifyComputeError(msg)).toBe(expected);
    });
  }
});

describe("ComputeError — constructable for every kind", () => {
  // Source signature is (kind, message, options?); assert the four
  // observable properties. Includes the frontend-validated-only kinds,
  // which never cross the classifier but are still valid `kind` values.
  const kinds: ComputeErrorKind[] = [
    "version-mismatch",
    "load-failed",
    "vertex-not-found",
    "h-box-arity",
    "boundary-degree",
    "boundary-order",
    "degree-overflow",
    "duplicate-node-id",
    "w-input-count",
    "w-output-count",
    "w-self-loop",
    "unknown",
  ];

  for (const kind of kinds) {
    it(`new ComputeError('${kind}', 'msg') has .kind/.name/.message/.cause`, () => {
      const cause = new Error("underlying");
      const err = new ComputeError(kind, "boom", { cause });
      expect(err).toBeInstanceOf(Error);
      expect(err.kind).toBe(kind);
      expect(err.name).toBe("ComputeError");
      expect(err.message).toBe("boom");
      expect(err.cause).toBe(cause);
    });
  }
});

// ============================================================================
// result-types — TensorResult shape.
// ============================================================================

describe("TensorResult", () => {
  it("constructs with all five documented fields present", () => {
    const result: TensorResult = {
      shape: [2, 2],
      data: [
        [1, 0],
        [0, 0],
        [0, 0],
        [1, 0],
      ],
      warnings: ["spider 's1' phase '??'"],
      inputCount: 1,
      outputCount: 1,
    };
    expect(result.shape).toEqual([2, 2]);
    expect(result.data).toHaveLength(4);
    expect(result.warnings).toEqual(["spider 's1' phase '??'"]);
    expect(result.inputCount).toBe(1);
    expect(result.outputCount).toBe(1);
  });

  it("scalar result: empty shape + single data entry + zero boundary counts", () => {
    const result: TensorResult = {
      shape: [],
      data: [[1, 0]],
      warnings: [],
      inputCount: 0,
      outputCount: 0,
    };
    expect(result.shape).toEqual([]);
    expect(result.data).toEqual([[1, 0]]);
    expect(result.warnings).toEqual([]);
    expect(result.inputCount).toBe(0);
    expect(result.outputCount).toBe(0);
  });
});
