// src/lib/serialisation/round.ts
//
// Decimal rounding helpers for export serializers (e.g. TikZ coordinates).
export function roundToDecimalPlace(input: number, place: number): number {
  const base = Math.pow(10, place);
  // Absorb binary-float drift at the rounding boundary (2.345 is stored as
  // 2.3449999…, so naive Math.round(x * base) / base rounds it down). The
  // nudge must be applied *after* scaling: Number.EPSILON added to the
  // unscaled input is below one ulp there, so the addition is a no-op for
  // any value ≥ 1. A fixed 1e-10 in scaled space is far below the rounding
  // unit, so it only touches values already within float error of a
  // boundary — never genuine values.
  const epsilon = 1e-10;

  return Math.round(input * base + epsilon) / base;
}

export function roundToFiveDecimal(input: number): number {
  return roundToDecimalPlace(input, 5);
}
