// src/lib/compute/matrix.test.ts
//
// Pure-function tests for the matrix-presentation math used in
// ComputeResultDialog.tsx. The compute layer returns data as a flat
// array in row-major order over shape [in_1, ..., in_n, out_1, ..., out_m]
// (all dims = 2). The frontend reshapes this into a matrix display
// via two operations:
//
//   M(row, col) = data[col * (1 << outputCount) + row]
//   row label = |big-endian output bits⟩
//   col label = |big-endian input bits⟩
//
// These are pure functions with no React, Web Worker, or WASM deps —
// just the math contract.

import { describe, expect, it } from "vitest";

// ---- bitsToLabel -----------------------------------------------------------
// (Copied from ComputeResultDialog.tsx — factored here for independent
// testing; keep both copies in sync when changing the convention.)

function bitsToLabel(index: number, nQubits: number): string {
  if (nQubits === 0) return "•";
  const bits = Array.from({ length: nQubits }, (_, k) =>
    ((index >> (nQubits - 1 - k)) & 1) === 1 ? "1" : "0",
  ).join("");
  return `|${bits}⟩`;
}

// ---- matrixEntry -----------------------------------------------------------
// Maps matrix-coordinates (row = output bits big-endian, col = input bits
// big-endian) into the flat data array.

function matrixEntry(
  data: [number, number][],
  row: number,
  col: number,
  outputCount: number,
): [number, number] {
  return data[col * (1 << outputCount) + row];
}

// ---- Tests -----------------------------------------------------------------

describe("bitsToLabel", () => {
  it("0 qubits → '•' (no basis)", () => {
    expect(bitsToLabel(0, 0)).toBe("•");
  });

  it("1 qubit: 0 → |0⟩, 1 → |1⟩", () => {
    expect(bitsToLabel(0, 1)).toBe("|0⟩");
    expect(bitsToLabel(1, 1)).toBe("|1⟩");
  });

  it("2 qubits big-endian: index 0 → |00⟩, 3 → |11⟩", () => {
    expect(bitsToLabel(0, 2)).toBe("|00⟩");
    expect(bitsToLabel(3, 2)).toBe("|11⟩");
  });

  it("2 qubits big-endian: 2 (0b10) → |10⟩ (high bit first)", () => {
    // With 2 qubits, bit 0 is the leftmost (high-order). Index 2 =
    // binary 10, so the leftmost bit is 1, rightmost is 0 → |10⟩.
    expect(bitsToLabel(2, 2)).toBe("|10⟩");
  });

  it("2 qubits big-endian: 1 (0b01) → |01⟩", () => {
    expect(bitsToLabel(1, 2)).toBe("|01⟩");
  });

  it("3 qubits: 5 (0b101) → |101⟩", () => {
    expect(bitsToLabel(5, 3)).toBe("|101⟩");
  });
});

describe("matrix reshape — M(row, col) = data[col * nRows + row]", () => {
  // 1 input + 1 output → 2×2 identity matrix.
  // Data layout row-major over [in, out]:
  //   data[0] = (in=0, out=0) = M(0,0)
  //   data[1] = (in=0, out=1) = M(1,0)
  //   data[2] = (in=1, out=0) = M(0,1)
  //   data[3] = (in=1, out=1) = M(1,1)
  const id2x2: [number, number][] = [[1, 0], [0, 0], [0, 0], [1, 0]];

  it("M(0,0) → 1 in a 2×2 identity", () => {
    const [re, im] = matrixEntry(id2x2, 0, 0, 1);
    expect(re).toBeCloseTo(1, 10);
    expect(im).toBeCloseTo(0, 10);
  });

  it("M(1,1) → 1 in a 2×2 identity", () => {
    const [re, im] = matrixEntry(id2x2, 1, 1, 1);
    expect(re).toBeCloseTo(1, 10);
    expect(im).toBeCloseTo(0, 10);
  });

  it("M(0,1) → 0 (off-diagonal)", () => {
    const [re, im] = matrixEntry(id2x2, 0, 1, 1);
    expect(re).toBeCloseTo(0, 10);
    expect(im).toBeCloseTo(0, 10);
  });

  it("M(1,0) → 0", () => {
    const [re, im] = matrixEntry(id2x2, 1, 0, 1);
    expect(re).toBeCloseTo(0, 10);
    expect(im).toBeCloseTo(0, 10);
  });

  // 2 inputs + 2 outputs → 4×4 matrix.
  // Data layout over [in1, in2, out1, out2], all dim=2.
  // Identity-like: only the all-0 corner (data[0]) and all-1 corner
  // (data[15]) are 1; everything else 0.
  // This matches the Rust test `two_inputs_two_outputs_basis_order_is_big_endian`.
  const bigEndianId4x4: [number, number][] = Array.from(
    { length: 16 },
    (_, i) =>
      i === 0 || i === 15
        ? ([1, 0] as [number, number])
        : ([0, 0] as [number, number]),
  );

  it("4×4 matrix: all-0 corner (row=0, col=0) → 1", () => {
    const [re, im] = matrixEntry(bigEndianId4x4, 0, 0, 2);
    expect(re).toBeCloseTo(1, 10);
    expect(im).toBeCloseTo(0, 10);
  });

  it("4×4 matrix: all-1 corner (row=3, col=3) → 1", () => {
    // row=3 = binary 11, col=3 = binary 11. index = 3*4 + 3 = 15.
    const [re, im] = matrixEntry(bigEndianId4x4, 3, 3, 2);
    expect(re).toBeCloseTo(1, 10);
    expect(im).toBeCloseTo(0, 10);
  });

  it("4×4 matrix: (row=2, col=2) with mixed bits → 0", () => {
    // row=2 = out bits (1,0), col=2 = in bits (1,0).
    // index = 2*4 + 2 = 10. All 4 bits = {1,0,1,0} — mixed, should be 0.
    const [re, im] = matrixEntry(bigEndianId4x4, 2, 2, 2);
    expect(re).toBeCloseTo(0, 10);
    expect(im).toBeCloseTo(0, 10);
  });

  it("4×4 matrix: (row=1, col=0) → data[0*4 + 1] = data[1] → 0", () => {
    const [re, im] = matrixEntry(bigEndianId4x4, 1, 0, 2);
    expect(re).toBeCloseTo(0, 10);
    expect(im).toBeCloseTo(0, 10);
  });

  it("4×4 matrix: (row=0, col=1) → data[1*4 + 0] = data[4] → 0", () => {
    const [re, im] = matrixEntry(bigEndianId4x4, 0, 1, 2);
    expect(re).toBeCloseTo(0, 10);
    expect(im).toBeCloseTo(0, 10);
  });
});
