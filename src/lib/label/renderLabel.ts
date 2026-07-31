// src/lib/label/renderLabel.ts
//
// Render a vertex label as HTML. A label whose trimmed form is exactly
// `$...$` (inline) or `$$...$$` (display) is rendered with KaTeX;
// everything else is HTML-escaped plain text. Embedded inline math is
// not supported in v1.
//
// Decoration only — whether the parsed value is a compute input (e.g.
// a spider phase) is handled in `src/lib/phase/parser.ts`.
//
// KaTeX is lazy-loaded (see `katex-loader.ts`); `renderLabel` reads the
// cached module synchronously. A LaTeX label painted before the chunk
// loads falls back to escaped text for one frame, then re-renders once
// KaTeX is ready (see `useKatexReady`).

import { getKatex } from "./katex-loader";

/**
 * True if the entire trimmed label is a single `$...$` / `$$...$$`
 * math expression. Embedded `$...$` substrings (e.g. `$5`) are not
 * LaTeX.
 */
export function isLatexLabel(label: string): boolean {
  return extractMathBlock(label) !== null;
}

type MathBlock = {
  /** Math body with `$` / `$$` delimiters stripped. */
  math: string;
  /** `true` ⇒ centered display block; `false` ⇒ inline. */
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

// HTML-escape for the plain-text path. The five entities below cover
// every realistic label without pulling in a dependency.
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
  /** True if `html` came from KaTeX; false if escaped plain text. */
  isLatex: boolean;
};

/**
 * Render a vertex label as HTML. Returns `{ html, isLatex }` so callers
 * can style math vs. text differently. KaTeX parse errors fall back to
 * escaped plain text; `trust: false` blocks `\href`, `\url`, etc.
 */
export function renderLabel(label: string): RenderedLabel {
  if (!label) return { html: "", isLatex: false };

  const block = extractMathBlock(label);
  if (!block) {
    return { html: escapeHtml(label), isLatex: false };
  }

  // KaTeX chunk not yet loaded — fall back to escaped text for this
  // one paint; the consumer re-renders once it's ready.
  const katex = getKatex();
  if (!katex) {
    return { html: escapeHtml(label), isLatex: false };
  }

  try {
    const html = katex.renderToString(block.math, {
      throwOnError: true,
      displayMode: block.displayMode,
      // Refuse \href, \url, etc. so user-typed LaTeX can't add links.
      trust: false,
      // Compact output for small (~32px) vertex bodies.
      output: "html",
    });
    return { html, isLatex: true };
  } catch {
    return { html: escapeHtml(label), isLatex: false };
  }
}
