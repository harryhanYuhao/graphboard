// LaTeX label renderer coverage. KaTeX output is HTML, so we assert on
// `isLatexLabel` (the routing predicate), `renderLabel`'s `isLatex` flag
// (so callers style math vs. plain text differently), the escape contract,
// and KaTeX-generated spans in the math path. Full KaTeX HTML is not
// snapshotted — its internals aren't our contract.

import { describe, expect, it } from "vitest";
import { isLatexLabel, renderLabel } from "./renderLabel";
import { whenKatexReady } from "./katex-loader";

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
    // Only whole-label `$...$` / `$$...$$` counts; embedded math in prose
    // falls through to plain text.
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
    // `&` must be escaped first or the others get re-escaped.
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
  // KaTeX is a lazy-loaded chunk; wait for it so the LaTeX tests don't
  // race the load. Plain-text cases above stay synchronous.
  it("inline math renders with katex wrapper span", async () => {
    await whenKatexReady();
    const r = renderLabel("$\\alpha$");
    expect(r.isLatex).toBe(true);
    expect(r.html).toContain("katex");
  });

  it("display math sets displayMode (katex-display class)", async () => {
    await whenKatexReady();
    const r = renderLabel("$$\\frac{\\pi}{4}$$");
    expect(r.isLatex).toBe(true);
    expect(r.html).toContain("katex-display");
  });

  it("unparseable math falls back to escaped plain text", async () => {
    await whenKatexReady();
    // KaTeX rejects `\notacommand`; we wrap it so a typo doesn't render a
    // red `katex-error` span inside a vertex body.
    const r = renderLabel("$\\notacommand$");
    expect(r.isLatex).toBe(false);
    expect(r.html).toContain("\\notacommand");
  });
});