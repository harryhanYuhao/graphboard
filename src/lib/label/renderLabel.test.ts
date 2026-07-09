// src/lib/label/renderLabel.test.ts
//
// Behavioural coverage for the LaTeX label renderer. KaTeX output is
// HTML, so we assert on:
//   - `isLatexLabel` truthiness (the routing predicate);
//   - `renderLabel`'s `isLatex` flag (so callers can style math vs.
//     plain text differently);
//   - the escape contract for the plain-text path;
//   - the presence of KaTeX-generated spans in the math path.
//
// We deliberately do *not* snapshot full KaTeX HTML — KaTeX's output
// is stable across patch versions but its internals are not part of
// our contract, and snapshotting would make the test brittle to
// upstream changes we don't care about.

import { describe, expect, it } from "vitest";
import { isLatexLabel, renderLabel } from "./renderLabel";

describe("isLatexLabel", () => {
  it("empty string is not LaTeX", () => {
    expect(isLatexLabel("")).toBe(false);
  });

  it("plain text is not LaTeX", () => {
    expect(isLatexLabel("hello world")).toBe(false);
    expect(isLatexLabel("alpha")).toBe(false);
    expect(isLatexLabel("α")).toBe(false);
  });

  it("lone $ is not LaTeX", () => {
    expect(isLatexLabel("$")).toBe(false);
    expect(isLatexLabel("price: $5")).toBe(false);
    expect(isLatexLabel("$5 each")).toBe(false);
  });

  it("inline $...$ is LaTeX", () => {
    expect(isLatexLabel("$\\alpha$")).toBe(true);
    expect(isLatexLabel("$x$")).toBe(true);
    expect(isLatexLabel("$E = mc^2$")).toBe(true);
  });

  it("display $$...$$ is LaTeX", () => {
    expect(isLatexLabel("$$\\frac{\\pi}{4}$$")).toBe(true);
    expect(isLatexLabel("$$x$$")).toBe(true);
  });

  it("inline math with leading / trailing whitespace inside delimiters", () => {
    expect(isLatexLabel("$ \\alpha $")).toBe(true);
  });

  it("math embedded in surrounding text is NOT treated as a math block", () => {
    // v1 only supports a *whole-label* math expression (`$...$` or
    // `$$...$$` matching the entire trimmed label). Embedded math in
    // prose falls through to plain text. Phase 6 can revisit if a
    // researcher actually wants this.
    expect(isLatexLabel("when $a = 0$ the value is")).toBe(false);
    expect(isLatexLabel("price: $5")).toBe(false);
  });
});

describe("renderLabel — plain text", () => {
  it("empty input returns empty HTML", () => {
    expect(renderLabel("")).toEqual({ html: "", isLatex: false });
  });

  it("plain text is HTML-escaped", () => {
    const r = renderLabel("hello");
    expect(r.isLatex).toBe(false);
    expect(r.html).toBe("hello");
  });

  it("special characters are escaped", () => {
    // The order matters: `&` must be escaped first or the others
    // would be re-escaped. We test the resulting entity sequences
    // rather than parsing them back.
    const r = renderLabel("<script>&\"'</script>");
    expect(r.isLatex).toBe(false);
    expect(r.html).toContain("&lt;script&gt;");
    expect(r.html).toContain("&amp;");
    expect(r.html).toContain("&quot;");
    expect(r.html).toContain("&#39;");
    // Crucially: no live <script> tag survived.
    expect(r.html).not.toMatch(/<script[^>]*>/);
  });

  it("unicode characters pass through unchanged", () => {
    expect(renderLabel("α β γ").html).toBe("α β γ");
  });
});

describe("renderLabel — KaTeX", () => {
  it("inline math renders with katex wrapper span", () => {
    const r = renderLabel("$\\alpha$");
    expect(r.isLatex).toBe(true);
    expect(r.html).toContain("katex");
  });

  it("display math sets displayMode (katex-display class)", () => {
    const r = renderLabel("$$\\frac{\\pi}{4}$$");
    expect(r.isLatex).toBe(true);
    expect(r.html).toContain("katex-display");
  });

  it("unparseable math falls back to escaped plain text", () => {
    // KaTeX with default options rejects `\foo` because `foo` is
    // not a known command; we wrap the call so a user typo doesn't
    // produce a red `katex-error` span inside a vertex body.
    const r = renderLabel("$\\notacommand$");
    expect(r.isLatex).toBe(false);
    expect(r.html).toContain("\\notacommand");
  });
});