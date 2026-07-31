// Phase parser coverage, driven from the shared fixture at
// `crates/zxw/tests/fixtures/phase_grammar.json`. The Rust port loads
// the same fixture, so the two parsers stay in lock-step — add a JSON
// case and both sides pick it up.

import { describe, expect, it } from "vitest";
import { parsePhase } from "./parser";
// resolveJsonModule is on; path is relative to src/lib/phase/.
import fixture from "../../../crates/zxw/tests/fixtures/phase_grammar.json";

const PI = Math.PI;

type FixtureCase = {
  group: string;
  name: string;
  input: string;
  ok: boolean;
  value?: number;
  valuePi?: boolean;
  valuePiMul?: number;
  fragment?: string;
};

function expectedValue(c: FixtureCase): number {
  if (c.value !== undefined) return c.value;
  if (c.valuePi === true) return PI;
  if (c.valuePiMul !== undefined) return PI * c.valuePiMul;
  throw new Error(`Ok case '${c.name}' missing value/valuePi/valuePiMul`);
}

describe("parsePhase (shared fixture)", () => {
  // One `it()` per case so a failure names the exact input.
  for (const c of fixture.cases as FixtureCase[]) {
    it(`[${c.group}] ${c.name}`, () => {
      const r = parsePhase(c.input);
      if (c.ok) {
        expect(r.ok).toBe(true);
        if (r.ok) {
          expect(r.value).toBeCloseTo(expectedValue(c), 10);
        }
      } else {
        expect(r.ok).toBe(false);
        if (!r.ok && c.fragment !== undefined) {
          expect(r.error.toLowerCase()).toContain(c.fragment.toLowerCase());
        }
      }
    });
  }
});

describe("parsePhase — surface API shape", () => {
  // These assert the JS Result object's field names, which don't belong
  // in the language-agnostic fixture.

  it("ok result carries `value`, no error", () => {
    const r = parsePhase("\\pi");
    expect(r).toEqual({ ok: true, value: PI });
  });

  it("err result carries `error`, no value", () => {
    const r = parsePhase("\\alpha");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(typeof r.error).toBe("string");
      expect(r.error.length).toBeGreaterThan(0);
    }
  });
});
