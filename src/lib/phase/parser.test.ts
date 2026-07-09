// src/lib/phase/parser.test.ts
//
// Behavioural coverage for the JS phase parser. The Rust port (in
// `crates/zxw/src/phase.rs`, Phase 3) loads the same fixture-driven
// cases to keep the two parsers in lock-step — but for now the JS
// parser gets all its coverage here.
//
// Cases are grouped by grammar rule. Approximate equality on floating
// point results, not exact — phase values like π/7 don't have an exact
// f64 representation and the test would be flaky if we insisted on
// bit-for-bit equality.

import { describe, expect, it } from "vitest";
import { parsePhase } from "./parser";

const PI = Math.PI;

function expectOk(input: string, expected: number) {
  const r = parsePhase(input);
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.value).toBeCloseTo(expected, 10);
  }
}

function expectErr(input: string, fragment?: string) {
  const r = parsePhase(input);
  expect(r.ok).toBe(false);
  if (!r.ok && fragment) {
    expect(r.error.toLowerCase()).toContain(fragment.toLowerCase());
  }
}

describe("parsePhase — empty / whitespace", () => {
  it("empty string is phase 0", () => {
    expectOk("", 0);
  });

  it("whitespace-only is phase 0", () => {
    expectOk("   ", 0);
  });

  it("only delimiters is phase 0", () => {
    expectOk("$   $", 0);
    expectOk("$$\n$$", 0);
  });
});

describe("parsePhase — numbers", () => {
  it("integer", () => expectOk("0", 0));
  it("positive integer", () => expectOk("3", 3));
  it("negative integer", () => expectOk("-7", -7));
  it("decimal", () => expectOk("0.5", 0.5));
  it("negative decimal", () => expectOk("-2.25", -2.25));
  it("integer followed by .", () => expectOk("3.", 3));
});

describe("parsePhase — π variants", () => {
  it("LaTeX \\pi", () => expectOk("\\pi", PI));
  it("Unicode π", () => expectOk("π", PI));
  it("ASCII pi", () => expectOk("pi", PI));
  it("ASCII PI", () => expectOk("PI", PI));
  it("π with whitespace", () => expectOk("  π  ", PI));
});

describe("parsePhase — arithmetic", () => {
  it("addition", () => expectOk("1 + 2", 3));
  it("subtraction", () => expectOk("5 - 8", -3));
  it("multiplication", () => expectOk("3 * 4", 12));
  it("division", () => expectOk("10 / 4", 2.5));
  it("precedence: multiplication over addition", () => expectOk("1 + 2 * 3", 7));
  it("left-to-right for same-precedence", () => expectOk("10 - 3 - 2", 5));
  it("parentheses override precedence", () => expectOk("(1 + 2) * 3", 9));
  it("nested parentheses", () => expectOk("((1 + 2) * (3 + 4))", 21));
  it("unary minus", () => expectOk("-3", -3));
  it("unary minus inside expression", () => expectOk("5 + -3", 2));
  it("unary plus", () => expectOk("+5", 5));
  it("double operator: 1 + + 2 is valid via unary +", () => expectOk("1 + + 2", 3));
  it("division by zero is finite — produces Infinity, surfaced as error", () => {
    expectErr("1 / 0", "not finite");
  });
});

describe("parsePhase — π in expressions", () => {
  it("π/2", () => expectOk("\\pi/2", PI / 2));
  it("π/4 in unicode form", () => expectOk("π / 4", PI / 4));
  it("2π", () => expectOk("2 * \\pi", 2 * PI));
  it("pi/3", () => expectOk("pi/3", PI / 3));
  it("π + 1", () => expectOk("\\pi + 1", PI + 1));
  it("1 - π", () => expectOk("1 - \\pi", 1 - PI));
  it("(π+π)/4", () => expectOk("(\\pi + \\pi)/4", PI / 2));
});

describe("parsePhase — math delimiter stripping", () => {
  it("inline $...$", () => expectOk("$\\pi/4$", PI / 4));
  it("display $$...$$", () => expectOk("$$\\pi/4$$", PI / 4));
  it("inline with whitespace around the body", () =>
    expectOk("$  \\pi/4  $", PI / 4));
  it("plain text without delimiters", () => expectOk("\\pi/4", PI / 4));
});

describe("parsePhase — unicode operator synonyms", () => {
  it("unicode minus", () => expectOk("5 − 3", 2));
  it("unicode multiplication ×", () => expectOk("2 × 3", 6));
  it("unicode division ÷", () => expectOk("6 ÷ 4", 1.5));
});

describe("parsePhase — errors", () => {
  it("trailing junk surfaces the full identifier, not just one char", () =>
    expectErr("1 + 2 hello", "hello"));
  it("missing right paren", () => expectErr("(1 + 2", ")"));
  it("unknown variable (single word)", () => expectErr("alpha", "alpha"));
  it("unknown LaTeX variable", () => expectErr("\\alpha + \\pi/4", "alpha"));
  it("lone backslash", () => expectErr("1 \\ 2", ""));
  it("non-numeric single char", () => expectErr("1 # 2", "#"));
  it("only an operator", () => expectErr("+", ""));
  it("empty parens", () => expectErr("()", ""));
});

describe("parsePhase — `pi2` is not the variable `pi`", () => {
  // Regression guard: tryConsumeWord must not consume `pi` from `pi2`
  // and leave `2` dangling. The whole thing should be rejected as an
  // unknown variable instead.
  it("pi2 is unknown", () => expectErr("pi2", "pi2"));
});

describe("parsePhase — surface API shape", () => {
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