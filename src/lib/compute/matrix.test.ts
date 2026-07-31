// Matrix-presentation math for ComputeResultDialog.tsx. Data is row-major
// over [in_1,…,in_n,out_1,…,out_m] (all dims 2); the reshape is
// `M(row, col) = data[col * (1 << outputCount) + row]`.

import { describe, expect, it } from "vitest";

import { bitsToLabel, matrixEntry } from "./matrix-format";

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
    // Bit 0 is the leftmost (high-order): index 2 = 0b10 → |10⟩.
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
  // 2×2 identity, row-major over [in, out].
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

  // 4×4 over [in1, in2, out1, out2]; only the all-0 (data[0]) and all-1
  // (data[15]) corners are 1. Matches the Rust test
  // `two_inputs_two_outputs_basis_order_is_big_endian`.
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
    // index = 3*4 + 3 = 15.
    const [re, im] = matrixEntry(bigEndianId4x4, 3, 3, 2);
    expect(re).toBeCloseTo(1, 10);
    expect(im).toBeCloseTo(0, 10);
  });

  it("4×4 matrix: (row=2, col=2) with mixed bits → 0", () => {
    // index = 2*4 + 2 = 10; bits {1,0,1,0} are mixed → 0.
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
