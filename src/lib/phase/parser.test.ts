// src/lib/phase/parser.test.ts
//
// Behavioural coverage for the JS phase parser, driven from the shared
// fixture at `crates/zxw/tests/fixtures/phase_grammar.json`. The Rust
// port (`crates/zxw/src/phase.rs`) loads the *same* fixture via
// `tests/phase_grammar.rs`, so the two parsers stay in lock-step — add
// a case to the JSON and both sides pick it up; change one parser
// without the other and CI fails on the divergent side.
//
// The two "surface API shape" cases (the `Result` object's field names)
// stay inline here because they assert the *JS-specific* object shape,
// not parse behavior, and so don't belong in the language-agnostic
// fixture.

import { describe, expect, it } from "vitest";
import { parsePhase } from "./parser";
// Static import works because tsconfig has `resolveJsonModule: true`.
// Path is relative to this file: src/lib/phase/ → crates/zxw/tests/.
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
  // One `it()` per case so a failure points straight at the input. The
  // name carries the group + case name for readability.
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
  // Inline: these assert the JS Result object's field names, which are
  // not language-agnostic and so don't belong in the shared fixture.

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
