// src/lib/label/renderLabel.ts
//
// Render a vertex `label` as HTML, with optional KaTeX support. 
// The convention is:
//
//   - A label that *is* a single math expression — i.e. its trimmed
//     form is exactly `$...$` (inline) or `$$...$$` (display) — is
//     rendered with KaTeX
//   - All other labels are rendered as plain text (HTML-escaped).
//
// Mixed inline math embedded in prose (e.g. `when $a = 0$ the value
// is`) is intentionally *not* supported in v1 — a vertex body is
// small enough that one math expression per label
//
// Applies to every vertex type as decoration. Whether the *parsed
// value* is meaningful for the vertex's compute role (e.g. as a
// phase on a Z/X spider) is a separate concern — see
// `src/lib/phase/parser.ts`.

import katex from "katex";

/**
 * True if `label` is a single math expression — i.e. the entire
 * trimmed label is `$...$` or `$$...$$`. Anything else is plain text.
 *
 * Note: this intentionally does not match embedded `$...$` substrings.
 * A label like `$5` is *not* LaTeX.
 */
export function isLatexLabel(label: string): boolean {
  return extractMathBlock(label) !== null;
}

type MathBlock = {
  /** The math expression body, with `$` / `$$` delimiters stripped. */
  math: string;
  /** `true` ⇒ render as a centered display block; `false` ⇒ inline. */
  displayMode: boolean;
};

function extractMathBlock(label: string): MathBlock | null {
  const t = label.trim();
  if (t.length >= 4 && t.startsWith("$$") && t.endsWith("$$")) {
    return { math: t.slice(2, -2), displayMode: true };
  }
  if (t.length >= 2 && t.startsWith("$") && t.endsWith("$")) {
    return { math: t.slice(1, -1), displayMode: false };
  }
  return null;
}

// HTML-escape for the plain-text path. We don't reach for a library
// because the four entities we care about (amp/lt/gt/quote) cover every
// realistic label and keep the dep surface tiny.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type RenderedLabel = {
  /** Safe-to-inject HTML string. */
  html: string;
  /** True if `html` came from KaTeX; false if it's escaped plain text. */
  isLatex: boolean;
};

/**
 * Render a vertex label as HTML. Returns `{ html, isLatex }` so callers
 * can show a different style / hint for math vs. text.
 *
 * KaTeX is called with `throwOnError: true`. On any parse error we
 * fall back to escaped plain text 
 *
 * `trust: false`, which blocks `\href`, `\url`, `\includegraphics`
 */
export function renderLabel(label: string): RenderedLabel {
  if (!label) return { html: "", isLatex: false };

  const block = extractMathBlock(label);
  if (!block) {
    return { html: escapeHtml(label), isLatex: false };
  }

  try {
    const html = katex.renderToString(block.math, {
      throwOnError: true,
      displayMode: block.displayMode,
      // Strict mode: refuses \href, \url, etc. so a user-typed LaTeX
      // can't smuggle links into the canvas.
      trust: false,
      // Keep the output compact — we render inside small vertex bodies
      // (≈ 32px) and the default KaTeX sizing is too tall.
      output: "html",
    });
    return { html, isLatex: true };
  } catch {
    return { html: escapeHtml(label), isLatex: false };
  }
}
