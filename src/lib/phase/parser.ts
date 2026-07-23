// src/lib/phase/parser.ts
//
// Phase expression parser for ZXW spider / box labels.
//
// Grammar (v1, numeric only):
//
//   phase   := term  (('+' | '-') term)*
//   term    := factor (('*' | '/') factor)*
//   factor  := number | '\pi' | 'π' | 'pi' | 'PI' | '(' phase ')' | unary
//   unary   := '-' factor | '+' factor
//   number  := [0-9]+ ('.' [0-9]+)?
//
// Whitespace is ignored everywhere. The Unicode minus (`−`, U+2212)
// and the multiplication sign (`×`, U+00D7) and division sign
// (`÷`, U+00F7) are accepted as synonyms for `-`, `*`, `/` so a user
// pasting from a typeset source doesn't have to retype.
//
// A leading and/or trailing `$...$` or `$$...$$` pair is stripped
// before parsing, so the *same* string can be both rendered with
// KaTeX and parsed here — labels and phase values stay in sync.
//
// Returns a discriminated `{ ok: true, value } | { ok: false, error }`
// so callers (the property panel live preview, the Rust compute
// entry point) can surface a user-readable message instead of
// throwing.

const PI_VARIANTS = ["\\pi", "π"] as const;
const PI_WORD_VARIANTS = ["pi", "PI"] as const;

export type PhaseResult =
  | { ok: true; value: number }
  | { ok: false; error: string };

/**
 * Parse a phase expression into radians. Empty / whitespace-only input
 * returns `Ok(0)` — the identity phase — so blank labels on a spider
 * mean "no rotation", which is the convention users expect.
 */
export function parsePhase(input: string): PhaseResult {
  const stripped = stripMathDelimiters(input);
  if (stripped === "") {
    return { ok: true, value: 0 };
  }

  const cursor = { pos: 0 };
  try {
    const { value } = parseExpr(stripped, cursor);
    skipWs(stripped, cursor);
    if (cursor.pos < stripped.length) {
      throw trailingJunkError(stripped, cursor.pos);
    }
    if (!Number.isFinite(value)) {
      throw new ParseError(`Phase is not finite (${value})`);
    }
    return { ok: true, value };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof ParseError ? e.message : String(e),
    };
  }
}

/**
 * Surface a clean error for whatever's left in the input after a
 * successful parse. If it's a bare identifier, name it — the user
 * typed `hello` and wants to be told `hello` is the problem, not
 * just `h`.
 */
function trailingJunkError(input: string, pos: number): ParseError {
  if (input[pos] === "\\") {
    const m = input.slice(pos).match(/^\\[A-Za-z][A-Za-z0-9]*/);
    if (m) {
      return new ParseError(
        `Unknown variable '${m[0]}' (only \\pi is supported in v1)`,
      );
    }
  }
  if (/[A-Za-z]/.test(input[pos] ?? "")) {
    const m = input.slice(pos).match(/^[A-Za-z][A-Za-z0-9]*/);
    if (m) {
      return new ParseError(
        `Unknown variable '${m[0]}' (only \\pi is supported in v1)`,
      );
    }
  }
  return new ParseError(
    `Unexpected '${input[pos]}' at position ${pos}`,
  );
}

// ---- internals --------------------------------------------------------------

class ParseError extends Error {
  constructor(message: string) {
    super(message);
  }
}

type Cursor = { pos: number };

function skipWs(input: string, c: Cursor): void {
  while (c.pos < input.length && /\s/.test(input[c.pos] ?? "")) c.pos++;
}

/**
 * Strip a leading / trailing `$...$` or `$$...$$` pair so the parser
 * sees the raw expression. Only acts when *both* delimiters are
 * present at the matching positions, so a label like `price: $5` is
 * left alone.
 */
function stripMathDelimiters(input: string): string {
  const t = input.trim();
  if (t.length >= 4 && t.startsWith("$$") && t.endsWith("$$")) {
    return t.slice(2, -2).trim();
  }
  if (t.length >= 2 && t.startsWith("$") && t.endsWith("$")) {
    return t.slice(1, -1).trim();
  }
  return t;
}

function parseExpr(input: string, c: Cursor): { value: number; pos: number } {
  let left = parseTerm(input, c);
  for (;;) {
    skipWs(input, c);
    const ch = input[c.pos];
    if (ch === "+" || ch === "-" || isUnicodeMinus(ch)) {
      c.pos++;
      const right = parseTerm(input, c);
      left = {
        value: ch === "+" ? left.value + right.value : left.value - right.value,
        pos: right.pos,
      };
    } else {
      break;
    }
  }
  return left;
}

function parseTerm(input: string, c: Cursor): { value: number; pos: number } {
  let left = parseFactor(input, c);
  for (;;) {
    skipWs(input, c);
    const ch = input[c.pos];
    if (ch === "*" || ch === "/" || ch === "×" || ch === "÷") {
      c.pos++;
      const right = parseFactor(input, c);
      left = {
        value:
          ch === "*" || ch === "×"
            ? left.value * right.value
            : left.value / right.value,
        pos: right.pos,
      };
    } else {
      break;
    }
  }
  return left;
}

function parseFactor(input: string, c: Cursor): { value: number; pos: number } {
  skipWs(input, c);

  // Unary prefix — both ASCII and Unicode forms.
  const ch = input[c.pos];
  if (ch === "-" || isUnicodeMinus(ch)) {
    c.pos++;
    const inner = parseFactor(input, c);
    return { value: -inner.value, pos: inner.pos };
  }
  if (ch === "+") {
    c.pos++;
    return parseFactor(input, c);
  }

  // Parenthesised sub-expression.
  if (ch === "(") {
    c.pos++;
    const inner = parseExpr(input, c);
    skipWs(input, c);
    if (input[c.pos] !== ")") {
      throw new ParseError(`Expected ')' at position ${c.pos}`);
    }
    c.pos++;
    return inner;
  }

  // π variants — `\\pi`, the unicode character, and the bare ASCII words.
  for (const variant of PI_VARIANTS) {
    if (tryConsumeLiteral(input, c, variant)) {
      return { value: Math.PI, pos: c.pos };
    }
  }
  for (const variant of PI_WORD_VARIANTS) {
    if (tryConsumeWord(input, c, variant)) {
      return { value: Math.PI, pos: c.pos };
    }
  }

  // Numeric literal. The trailing `\.?\d*` allows both `3.5` and `3.`
  // (the latter parses to 3 via `parseFloat`). Bare `.5` (no leading
  // digit) is *not* supported in v1 — we can revisit if it matters.
  const numMatch = input.slice(c.pos).match(/^\d+\.?\d*/);
  if (numMatch) {
    c.pos += numMatch[0].length;
    return { value: parseFloat(numMatch[0]), pos: c.pos };
  }

  // `\<word>` — only `\pi` is supported; anything else is a clear error.
  // Identifiers may contain digits (e.g. `\alpha2`) so we report the
  // whole token, not just the leading letters — otherwise a user
  // typing `\alpha2` gets the confusing "Unknown variable '\alpha'".
  if (ch === "\\") {
    const m = input.slice(c.pos).match(/^\\[A-Za-z][A-Za-z0-9]*/);
    if (m) {
      throw new ParseError(
        `Unknown variable '${m[0]}' (only \\pi is supported in v1)`,
      );
    }
  }

  // Bare identifier — treat as a free variable name. In v1 we error
  // here; Phase 6 introduces symbolic arithmetic for these. Same
  // "include trailing digits" rule as the backslash branch.
  if (ch !== undefined && /[A-Za-z]/.test(ch)) {
    const m = input.slice(c.pos).match(/^[A-Za-z][A-Za-z0-9]*/);
    if (m) {
      throw new ParseError(
        `Unknown variable '${m[0]}' (only pi is supported in v1)`,
      );
    }
  }

  // End of input or stray character — caller's outer check catches
  // end-of-input, so reaching here means an unexpected character.
  if (c.pos >= input.length) {
    throw new ParseError("Unexpected end of input");
  }
  throw new ParseError(`Unexpected '${input[c.pos]}' at position ${c.pos}`);
}

function tryConsumeLiteral(input: string, c: Cursor, literal: string): boolean {
  skipWs(input, c);
  if (input.startsWith(literal, c.pos)) {
    c.pos += literal.length;
    return true;
  }
  return false;
}

/**
 * Consume an ASCII word *only* when not followed by any ASCII
 * alphanumeric. So `pi` matches in `pi/2` and `pi+1`, but `pi2`
 * doesn't consume `pi` and leave `2` dangling — instead we fall
 * through to the unknown-variable branch and produce a useful error
 * ("Unknown variable 'pi2'") rather than silently parsing `pi`
 * followed by an orphan `2`.
 */
function tryConsumeWord(input: string, c: Cursor, word: string): boolean {
  skipWs(input, c);
  if (!input.startsWith(word, c.pos)) return false;
  const next = input[c.pos + word.length];
  if (next !== undefined && /[A-Za-z0-9]/.test(next)) return false;
  c.pos += word.length;
  return true;
}

function isUnicodeMinus(ch: string | undefined): boolean {
  return ch === "−"; // U+2212
}