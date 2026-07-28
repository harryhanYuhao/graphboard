// src/lib/compute/matrix-format_edge_cases.test.ts
//
// Edge-case coverage for the compute-wrapper layer's pure helpers and
// error-classification surface. The existing test files
// (`matrix.test.ts`, `errors.test.ts`, `index.test.ts`) cover the happy
// paths; this file fills the gaps — especially `formatComplex`, which
// had ZERO coverage before.
//
// Conventions (matched to the sibling test files):
//   - One behaviour per `it`.
//   - Expected strings are derived from the source, not guessed.
//   - Surprising/ugly output that the source actually produces is
//     pinned with a "formatting quirk" comment and asserted exactly —
//     so a future fix shows up as a failing test rather than a silent
//     change. Only cases that emit "NaN" or throw are `it.skip`d.

import { describe, expect, it } from "vitest";

import { bitsToLabel, formatComplex, matrixEntry } from "./matrix-format";
import { classifyComputeError, ComputeError } from "./errors";
import type { ComputeErrorKind, TensorResult } from "./result-types";

// The negative-imaginary branch in `formatComplex` uses the Unicode
// minus sign U+2212 (−), not the ASCII hyphen-minus (-). Asserting the
// exact code point keeps a refactor from silently swapping them.
const MINUS = "\u2212";

// ============================================================================
// formatComplex — the PRIME FOCUS (zero prior coverage).
//
// Source contract (matrix-format.ts:28-39):
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
    // The real branch uses re.toFixed(), which emits ASCII '-' for
    // negatives. Only the imaginary branch swaps in U+2212.
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
    // Not bare 'i' or '1i' — the real zero is always emitted when im is
    // the only non-zero part, and the imaginary magnitude is fixed to
    // 3 decimals with a leading '+'.
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
    // formatting quirk: |1e-9| > eps so it takes the toFixed branch,
    // which rounds 0.000000001 to "0.000". This differs from the
    // sub-eps case ("0") and from the exactly-zero case ("0").
    expect(formatComplex([1e-9, 0])).toBe("0.000");
  });

  it("negative real just above eps (-1e-9) → renders '-0.000' (formatting quirk)", () => {
    // formatting quirk / suspected bug: a tiny negative real above eps
    // keeps its sign through toFixed, producing the ugly "-0.000".
    // Pinned so a fix shows up as a failing test.
    expect(formatComplex([-1e-9, 0])).toBe("-0.000");
  });

  it("0.0001 (above eps, rounds to zero visually) → '0.000' (formatting quirk)", () => {
    // formatting quirk: 0.0001 is well above eps but rounds to "0.000"
    // at 3 decimals — visually indistinguishable from the sub-eps case.
    expect(formatComplex([0.0001, 0])).toBe("0.000");
  });

  it("custom eps suppresses a real that the default eps would render", () => {
    // 0.005 > 1e-10, so default eps would render "0.005" (→ "0.005" at
    // 3 decimals). With eps=0.01 the threshold swallows it → "0".
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
    // formatting quirk: |Infinity| < eps is false, so it takes the
    // toFixed branch, and (Infinity).toFixed(3) === "Infinity".
    expect(formatComplex([Infinity, 0])).toBe("Infinity");
  });

  // NaN handling is genuinely broken-looking (the string "NaN" leaks
  // into the output, and the imaginary branch flips to the minus sign
  // because NaN >= 0 is false). Skip rather than pin: the task brief
  // says only to assert exact output for finite inputs; NaN output is
  // not a contract anyone should rely on.
  it.skip("NaN real → currently emits 'NaN' (skipped: non-finite, not a contract)", () => {
    expect(formatComplex([NaN, 0])).toBe("NaN");
  });

  it.skip("both NaN → currently emits 'NaN−NaNi' (skipped: non-finite, not a contract)", () => {
    expect(formatComplex([NaN, NaN])).toBe(`NaN${MINUS}NaNi`);
  });
});

// ============================================================================
// bitsToLabel — extend the existing matrix.test.ts coverage with
// out-of-range / boundary cases.
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
    // bitsToLabel(4, 1): index 4 = 0b100, but only 1 bit is read, so
    // the low bit (0) is returned → "|0⟩". The overflow is silently
    // dropped — pinned so a future bounds check surfaces as a failure.
    expect(bitsToLabel(4, 1)).toBe("|0⟩");
    // bitsToLabel(99, 1): 99 = 0b1100011, low bit is 1 → "|1⟩".
    expect(bitsToLabel(99, 1)).toBe("|1⟩");
  });
});

// ============================================================================
// matrixEntry — extend coverage with out-of-bounds behaviour.
// ============================================================================

describe("matrixEntry — out of bounds", () => {
  // 2×2 identity, data row-major over [in, out].
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
    // The function indexes data[col*(1<<outputCount)+row] with no
    // bounds check; an OOB access returns undefined rather than
    // throwing. Pinned so a future guard surfaces as a test change.
    expect(matrixEntry(id2x2, 99, 99, 1)).toBeUndefined();
  });
});

describe("matrixEntry — 4×4 big-endian flat-index formula", () => {
  // 2 inputs + 2 outputs → 4×4 matrix, 16 entries. Put a distinct
  // sentinel value in every slot so we can verify the exact
  // row/col → flat-index mapping (col * (1<<outputCount) + row).
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
// classifyComputeError — boundary cases beyond the per-kind happy paths
// already covered in errors.test.ts.
// ============================================================================

describe("classifyComputeError — boundary cases", () => {
  it("empty message → 'unknown' (no substring matches)", () => {
    expect(classifyComputeError("")).toBe("unknown");
  });

  it("unrecognised wording → 'unknown'", () => {
    expect(classifyComputeError("something totally new")).toBe("unknown");
  });

  it("is case-sensitive: 'VERTEX NOT FOUND' (uppercase) → 'unknown'", () => {
    // The classifier lowercases the *input* but matches against the
    // exact lowercase tokens of the Rust messages. "VERTEX NOT FOUND"
    // lowercases to "vertex not found", which does NOT contain the
    // required token "not found (referenced by edge" → unknown.
    // Pinned: a Rust reword to bare "vertex not found" would NOT be
    // classified, and this test documents that.
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

describe("classifyComputeError — every ComputeErrorKind is reachable", () => {
  // Exhaustiveness guard: each variant of the ComputeErrorKind union
  // must be produced by SOME input. If a new variant is added to the
  // union without a classifier branch, this table is where it shows up.
  const cases: Array<[string, ComputeErrorKind]> = [
    ["WASM version mismatch: expected 0.3.0, got 0.2.1", "version-mismatch"],
    ["Failed to fetch wasm asset", "load-failed"],
    ["vertex 'v3' not found (referenced by edge 'e7')", "vertex-not-found"],
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
  // The task brief passes args as ("msg", "VertexNotFound"); the actual
  // source signature is (kind, message, options?). These tests follow
  // the source signature and assert the four observable properties.
  const kinds: ComputeErrorKind[] = [
    "version-mismatch",
    "load-failed",
    "vertex-not-found",
    "h-box-arity",
    "boundary-degree",
    "degree-overflow",
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
// result-types — TensorResult shape & union exhaustiveness.
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
