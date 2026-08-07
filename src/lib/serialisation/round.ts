// src/lib/serialisation/round.ts
//
// Decimal rounding helpers for export serializers (e.g. TikZ coordinates).
export function roundToDecimalPlace(input: number, place: number): number {
  const base = Math.pow(10, place);
  // Absorb binary-float drift at the rounding boundary (2.345 is stored as
  // 2.3449999…, so naive Math.round(x * base) / base rounds it down). The
  // epsilon is ~1e9× below the rounding unit, so it only nudges values that
  // are within float error of a boundary — never genuine values.
  const epsilon = Number.EPSILON;

  return Math.round(input * base + epsilon) / base;
}

export function roundToFiveDecimal(input: number): number {
  return roundToDecimalPlace(input, 5);
}
