// src/lib/compute/matrix-format.ts
//
// Pure functions for the matrix-presentation math shared by
// `ComputeResultDialog.tsx` and its tests. The compute layer returns data
// as a flat array in row-major order over shape
//   [in_1, ..., in_n, out_1, ..., out_m]   (all dims = 2).
// The frontend reshapes this into a matrix display via two operations:
//
//   M(row, col) = data[col * (1 << outputCount) + row]
//   row label   = |big-endian output bits⟩
//   col label   = |big-endian input bits⟩
//
// Keeping these here (not inside the component) makes the axis-ordering
// contract unit-testable without React Flow, and gives it a single source
// of truth — previously the test file carried a divergent copy.

/** A complex number as the compute layer returns it: `[real, imag]`. */
export type ComplexPair = [number, number];

/**
 * Format one complex entry as a short, scan-friendly string.
 *
 * - Real parts below `EPS` render as `"0"` so the matrix stays scannable.
 * - Imaginary parts use `±N i` (with the Unicode minus `−`, U+2212, for
 *   negatives). A negligible imaginary part renders as the empty string.
 * - Otherwise each numeric part is fixed to 3 decimals.
 */
export function formatComplex(
  v: ComplexPair,
  { eps = 1e-10, decimals = 3 }: { eps?: number; decimals?: number } = {},
): string {
  const [re, im] = v;
  const reStr = Math.abs(re) < eps ? "0" : re.toFixed(decimals);
  const imStr =
    Math.abs(im) < eps
      ? ""
      : `${im >= 0 ? "+" : "−"}${Math.abs(im).toFixed(decimals)}i`;
  return `${reStr}${imStr}`;
}

/**
 * Basis label for a multi-qubit index in **big-endian** bit order.
 *
 *   bitsToLabel(0, 1) → "|0⟩"
 *   bitsToLabel(0, 2) → "|00⟩"
 *   bitsToLabel(3, 2) → "|11⟩"   (3 = 0b11)
 *   bitsToLabel(2, 2) → "|10⟩"   (2 = 0b10; high bit first)
 *
 * `nQubits` = number of edges whose bits make up this index. `0` returns
 * the bullet `"•"` (no boundary of this kind).
 */
export function bitsToLabel(index: number, nQubits: number): string {
  if (nQubits === 0) return "•"; // no boundary of this kind
  const bits = Array.from({ length: nQubits }, (_, k) =>
    // High-order bit first: shift down so k=0 is the leftmost qubit.
    ((index >> (nQubits - 1 - k)) & 1) === 1 ? "1" : "0",
  ).join("");
  return `|${bits}⟩`;
}

/**
 * Look up a matrix entry from the flat row-major `data` array.
 *
 * Maps matrix coordinates (row = output bits big-endian, col = input bits
 * big-endian) into the flat tensor. With shape `[in_1, …, in_n, out_1, …,
 * out_m]` (all dim 2) in row-major order, the flattened index is
 * `col * (1 << outputCount) + row`.
 */
export function matrixEntry(
  data: ComplexPair[],
  row: number,
  col: number,
  outputCount: number,
): ComplexPair {
  return data[col * (1 << outputCount) + row];
}
