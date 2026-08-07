// Pins the decimal-rounding helpers. The tricky cases are binary-float
// artifacts: values like 2.345 or 1.005 are stored slightly *below* their
// decimal form, so naive `Math.round(x * 10^p) / 10^p` rounds them down.

import { describe, expect, it } from "vitest";
import { roundToDecimalPlace, roundToFiveDecimal } from "./round";

describe("roundToDecimalPlace", () => {
  it("rounds to the requested decimal place", () => {
    expect(roundToDecimalPlace(2.34567, 2)).toBe(2.35);
    expect(roundToDecimalPlace(2.344, 2)).toBe(2.34);
    expect(roundToDecimalPlace(2.6, 0)).toBe(3);
  });

  it("does not drift exact values", () => {
    expect(roundToDecimalPlace(0.5, 5)).toBe(0.5);
    expect(roundToDecimalPlace(0.25, 5)).toBe(0.25);
    expect(roundToDecimalPlace(0, 5)).toBe(0);
  });

  it("rounds repeating decimals (the TikZ /48 case)", () => {
    expect(roundToDecimalPlace(2.0833333333333335, 5)).toBe(2.08333);
    expect(roundToDecimalPlace(-2.0833333333333335, 5)).toBe(-2.08333);
  });

  it("absorbs binary-float drift at the .5 boundary", () => {
    // 2.345 and 1.005 are stored as 2.34499… / 1.00499… in binary.
    expect(roundToDecimalPlace(2.345, 2)).toBe(2.35);
    expect(roundToDecimalPlace(1.005, 2)).toBe(1.01);
  });
});

describe("roundToFiveDecimal", () => {
  it("rounds to 5 decimal places", () => {
    expect(roundToFiveDecimal(2.0833333333333335)).toBe(2.08333);
    expect(roundToFiveDecimal(1.23456)).toBe(1.23456);
    expect(roundToFiveDecimal(1.234567)).toBe(1.23457);
    expect(roundToFiveDecimal(0.5)).toBe(0.5);
  });
});
