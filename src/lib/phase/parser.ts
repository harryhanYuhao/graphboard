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
// Whitespace is ignored. `−` (U+2212), `×` (U+00D7), `÷` (U+00F7) are
// accepted as synonyms for `-`, `*`, `/` for pasted typeset input.
//
// Surrounding `$...$` / `$$...$$` is stripped first, so one string can
// be both KaTeX-rendered and parsed here. Returns a discriminated
// `{ ok, value } | { ok: false, error }` so callers surface a readable
// message rather than throwing.

const PI_VARIANTS = ["\\pi", "π"] as const;
const PI_WORD_VARIANTS = ["pi", "PI"] as const;

export type PhaseResult =
  | { ok: true; value: number }
  | { ok: false; error: string };

/**
 * Parse a phase expression into radians. Empty input returns `Ok(0)` —
 * the identity phase, so a blank spider label means "no rotation".
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
 * Build an error for leftover input after a successful parse. Names a
 * bare identifier wholesale (`hello`, not just `h`).
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
 * Strip a surrounding `$...$` / `$$...$$` pair. Only acts when both
 * delimiters are present at the matching ends, so `price: $5` is
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

  // Unary prefix (ASCII and Unicode).
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

  // π variants: `\\pi`, the Unicode character, and the bare ASCII words.
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

  // Numeric literal: `\d+\.?\d*` matches `3.5` and `3.` (→ 3 via
  // parseFloat). Bare `.5` is not supported in v1.
  const numMatch = input.slice(c.pos).match(/^\d+\.?\d*/);
  if (numMatch) {
    c.pos += numMatch[0].length;
    return { value: parseFloat(numMatch[0]), pos: c.pos };
  }

  // `\<word>`: only `\pi` is supported. Report the whole token (incl.
  // trailing digits, e.g. `\alpha2`) so the error names the full input.
  if (ch === "\\") {
    const m = input.slice(c.pos).match(/^\\[A-Za-z][A-Za-z0-9]*/);
    if (m) {
      throw new ParseError(
        `Unknown variable '${m[0]}' (only \\pi is supported in v1)`,
      );
    }
  }

  // Bare identifier: unknown variable in v1. Same trailing-digits rule
  // as the backslash branch.
  if (ch !== undefined && /[A-Za-z]/.test(ch)) {
    const m = input.slice(c.pos).match(/^[A-Za-z][A-Za-z0-9]*/);
    if (m) {
      throw new ParseError(
        `Unknown variable '${m[0]}' (only pi is supported in v1)`,
      );
    }
  }

  // End of input is normally caught by the outer check, so reaching
  // here means an unexpected character.
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
 * Consume an ASCII word only when not followed by another ASCII
 * alphanumeric: `pi` matches in `pi/2` but not in `pi2` (which falls
 * through to a clear "Unknown variable 'pi2'" error).
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