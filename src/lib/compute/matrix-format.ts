// Pure matrix-presentation math shared by `ComputeResultDialog.tsx` and
// its tests. The compute layer returns a flat row-major array over shape
// `[in_1, ..., in_n, out_1, ..., out_m]` (all dims 2); this reshapes it
// into a matrix:
//   M(row, col) = data[col * (1 << outputCount) + row]
//   row label   = |big-endian output bits>
//   col label   = |big-endian input bits>

/** A complex number as the compute layer returns it: `[real, imag]`. */
export type ComplexPair = [number, number];

/**
 * Format one complex entry as a short, scan-friendly string.
 *
 * Negligible (< eps) parts render as `"0"` (real) or empty (imag);
 * imaginary parts use `±N i` with Unicode minus `−` (U+2212).
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
 * Basis label for a multi-qubit index in **big-endian** bit order
 * (e.g. `bitsToLabel(3, 2)` -> `|11>`, `bitsToLabel(2, 2)` -> `|10>`).
 * `nQubits === 0` returns `"•"` (no boundary of this kind).
 */
export function bitsToLabel(index: number, nQubits: number): string {
  if (nQubits === 0) return "•";
  const bits = Array.from({ length: nQubits }, (_, k) =>
    // High-order bit first: k=0 is the leftmost qubit.
    ((index >> (nQubits - 1 - k)) & 1) === 1 ? "1" : "0",
  ).join("");
  return `|${bits}⟩`;
}

/**
 * Matrix entry from the flat row-major `data`. With shape
 * `[in_1, …, in_n, out_1, …, out_m]` (all dim 2), the flattened index
 * is `col * (1 << outputCount) + row`.
 */
export function matrixEntry(
  data: ComplexPair[],
  row: number,
  col: number,
  outputCount: number,
): ComplexPair {
  return data[col * (1 << outputCount) + row];
}
