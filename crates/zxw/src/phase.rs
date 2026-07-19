// crates/zxw/src/phase.rs
//
// Phase expression parser — direct, faithful port of
// `src/lib/phase/parser.ts`. Same grammar, same error messages, same
// edge-case behavior. Both parsers are kept in lock-step by the shared
// fixture at `tests/fixtures/phase_grammar.json` (loaded by
// `tests/phase_grammar.rs` and `src/lib/phase/parser.test.ts`); a change
// to one without the other fails CI. See `doc/plans.md` §4.1 for the
// full behavior checklist.
//
// Grammar (v1, numeric only):
//
//   phase   := term  (('+' | '-') term)*
//   term    := factor (('*' | '/') factor)*
//   factor  := number | '\pi' | 'π' | 'pi' | 'PI' | '(' phase ')' | unary
//   unary   := '-' factor | '+' factor
//   number  := [0-9]+ ('.' [0-9]*)?
//
// Whitespace is ignored everywhere. The Unicode minus (`−`, U+2212) and
// the multiplication sign (`×`, U+00D7) and division sign (`÷`, U+00F7)
// are accepted as synonyms for `-`, `*`, `/` so a user pasting from a
// typeset source doesn't have to retype.
//
// A leading and/or trailing `$...$` or `$$...$$` pair is stripped before
// parsing, so the *same* string can be both rendered with KaTeX and
// parsed here — labels and phase values stay in sync.
//
// JS quirks mirrored here (see plan §4.1):
//   1. Result field is `value`, not `radians`.
//   2. Unicode `×` (U+00D7), `÷` (U+00F7), `−` (U+2212) accepted; `π`
//      (U+03C0) is a fourth pi spelling alongside `\pi` / `pi` / `PI`.
//   3. Unary `+` exists; `--3` works via two stacked unary `-`.
//   4. Identifier-aware errors: `pi2` → "Unknown variable 'pi2'", not
//      "pi" + orphan "2". The word consumer refuses `pi` when followed
//      by `[A-Za-z0-9]`; same rule for `\<word>`.
//   5. Finiteness gate: a non-finite result (e.g. `1 / 0` → +inf) is a
//      `PhaseError::NonFinite`, not a silent `inf` returned to the
//      caller.

use crate::error::PhaseError;

/// Parse a phase expression into radians. Empty / whitespace-only input
/// returns `Ok(0)` — the identity phase — so blank labels on a spider
/// mean "no rotation", which is the convention users expect.
pub fn parse_phase(input: &str) -> Result<f64, PhaseError> {
    let stripped = strip_math_delimiters(input);
    if stripped.is_empty() {
        return Ok(0.0);
    }

    // Index by char (not byte) so multi-byte UTF-8 positions line up
    // with what the JS implementation sees as code-unit indices on the
    // BMP subset we accept. Our alphabet is ASCII + a handful of BMP
    // symbols (π, ×, ÷, −) — all single-code-unit in both UTF-16 and
    // char-indexed Rust, so positions match across the boundary.
    let chars: Vec<char> = stripped.chars().collect();
    let mut cursor = Cursor { pos: 0 };
    let value = parse_expr(&chars, &mut cursor)?;
    skip_ws(&chars, &mut cursor);
    if cursor.pos < chars.len() {
        return Err(trailing_junk_error(&chars, cursor.pos));
    }
    if !value.is_finite() {
        return Err(PhaseError::NonFinite(value));
    }
    Ok(value)
}

/// Build the most informative error for whatever's left in the input
/// after a successful sub-parse. A bare identifier surfaces as the whole
/// token (`hello`, not `h`); a `\<word>` surfaces as `\alpha`, not `\`.
fn trailing_junk_error(chars: &[char], pos: usize) -> PhaseError {
    let c = chars[pos];
    if c == '\\' {
        if let Some(token) = read_backslash_word(chars, pos) {
            return PhaseError::UnknownVariable(token);
        }
    }
    if c.is_ascii_alphabetic() {
        if let Some(token) = read_bare_word(chars, pos) {
            return PhaseError::UnknownVariable(token);
        }
    }
    PhaseError::UnexpectedToken {
        found: c.to_string(),
        position: pos,
    }
}

// ---- internals --------------------------------------------------------------

struct Cursor {
    pos: usize,
}

fn skip_ws(chars: &[char], c: &mut Cursor) {
    while c.pos < chars.len() && chars[c.pos].is_whitespace() {
        c.pos += 1;
    }
}

/// Strip a leading / trailing `$...$` or `$$...$$` pair so the parser
/// sees the raw expression. Only acts when *both* delimiters are present
/// at the matching positions, so a label like `price: $5` is left alone.
fn strip_math_delimiters(input: &str) -> &str {
    let t = input.trim();
    let bytes = t.as_bytes();
    let len = bytes.len();
    if len >= 4 && t.starts_with("$$") && t.ends_with("$$") {
        return t[2..len - 2].trim();
    }
    if len >= 2 && t.starts_with('$') && t.ends_with('$') {
        return t[1..len - 1].trim();
    }
    t
}

fn parse_expr(chars: &[char], c: &mut Cursor) -> Result<f64, PhaseError> {
    let mut left = parse_term(chars, c)?;
    loop {
        skip_ws(chars, c);
        let Some(ch) = chars.get(c.pos).copied() else {
            break;
        };
        if ch == '+' || ch == '-' || is_unicode_minus(ch) {
            c.pos += 1;
            let right = parse_term(chars, c)?;
            left = if ch == '+' { left + right } else { left - right };
        } else {
            break;
        }
    }
    Ok(left)
}

fn parse_term(chars: &[char], c: &mut Cursor) -> Result<f64, PhaseError> {
    let mut left = parse_factor(chars, c)?;
    loop {
        skip_ws(chars, c);
        let Some(ch) = chars.get(c.pos).copied() else {
            break;
        };
        if ch == '*' || ch == '/' || ch == '×' || ch == '÷' {
            c.pos += 1;
            let right = parse_factor(chars, c)?;
            left = if ch == '*' || ch == '×' {
                left * right
            } else {
                left / right
            };
        } else {
            break;
        }
    }
    Ok(left)
}

fn parse_factor(chars: &[char], c: &mut Cursor) -> Result<f64, PhaseError> {
    skip_ws(chars, c);

    let Some(ch) = chars.get(c.pos).copied() else {
        return Err(PhaseError::UnexpectedEndOfInput);
    };

    // Unary prefix — both ASCII and Unicode minus.
    if ch == '-' || is_unicode_minus(ch) {
        c.pos += 1;
        let inner = parse_factor(chars, c)?;
        return Ok(-inner);
    }
    if ch == '+' {
        c.pos += 1;
        return parse_factor(chars, c);
    }

    // Parenthesised sub-expression.
    if ch == '(' {
        c.pos += 1;
        let inner = parse_expr(chars, c)?;
        skip_ws(chars, c);
        match chars.get(c.pos).copied() {
            Some(')') => {
                c.pos += 1;
                return Ok(inner);
            }
            Some(_) | None => {
                return Err(PhaseError::MissingCloseParen(c.pos));
            }
        }
    }

    // π variants — `\pi`, the unicode character, and the bare ASCII words.
    if try_consume_literal(chars, c, "\\pi") {
        return Ok(std::f64::consts::PI);
    }
    if try_consume_literal(chars, c, "π") {
        return Ok(std::f64::consts::PI);
    }
    if try_consume_word(chars, c, "pi") {
        return Ok(std::f64::consts::PI);
    }
    if try_consume_word(chars, c, "PI") {
        return Ok(std::f64::consts::PI);
    }

    // Numeric literal. The trailing `.?\d*` allows both `3.5` and `3.`
    // (the latter parses to 3). Bare `.5` (no leading digit) is *not*
    // supported in v1 — we can revisit if it matters.
    if let Some((text, len)) = read_number(chars, c.pos) {
        c.pos += len;
        return Ok(text.parse::<f64>().unwrap());
    }

    // `\<word>` — only `\pi` is supported; anything else is a clear error.
    // Identifiers may contain digits (e.g. `\alpha2`) so we report the
    // whole token, not just the leading letters — otherwise a user
    // typing `\alpha2` gets the confusing "Unknown variable '\alpha'".
    if ch == '\\' {
        if let Some(token) = read_backslash_word(chars, c.pos) {
            return Err(PhaseError::UnknownVariable(token));
        }
    }

    // Bare identifier — treat as a free variable name. In v1 we error
    // here; Phase 6 introduces symbolic arithmetic for these. Same
    // "include trailing digits" rule as the backslash branch.
    if ch.is_ascii_alphabetic() {
        if let Some(token) = read_bare_word(chars, c.pos) {
            return Err(PhaseError::UnknownVariable(token));
        }
    }

    // End of input is handled by the caller's outer check; reaching here
    // means an unexpected character.
    Err(PhaseError::UnexpectedToken {
        found: ch.to_string(),
        position: c.pos,
    })
}

fn try_consume_literal(chars: &[char], c: &mut Cursor, literal: &str) -> bool {
    skip_ws(chars, c);
    let lit_chars: Vec<char> = literal.chars().collect();
    if c.pos + lit_chars.len() > chars.len() {
        return false;
    }
    if chars[c.pos..c.pos + lit_chars.len()] != lit_chars[..] {
        return false;
    }
    c.pos += lit_chars.len();
    true
}

/// Consume an ASCII word *only* when not followed by any ASCII
/// alphanumeric. So `pi` matches in `pi/2` and `pi+1`, but `pi2`
/// doesn't consume `pi` and leave `2` dangling — instead we fall
/// through to the unknown-variable branch and produce a useful error
/// ("Unknown variable 'pi2'") rather than silently parsing `pi`
/// followed by an orphan `2`.
fn try_consume_word(chars: &[char], c: &mut Cursor, word: &str) -> bool {
    skip_ws(chars, c);
    let word_chars: Vec<char> = word.chars().collect();
    if c.pos + word_chars.len() > chars.len() {
        return false;
    }
    if chars[c.pos..c.pos + word_chars.len()] != word_chars[..] {
        return false;
    }
    let next = chars.get(c.pos + word_chars.len()).copied();
    if matches!(next, Some(n) if n.is_ascii_alphanumeric()) {
        return false;
    }
    c.pos += word_chars.len();
    true
}

/// Read `[0-9]+ ( '.' [0-9]* )?` starting at `pos`. Returns the matched
/// text (as a String, to dodge the `char` → f64 parse dance) and its
/// length in chars.
fn read_number(chars: &[char], pos: usize) -> Option<(String, usize)> {
    let start = pos;
    let mut end = pos;
    while end < chars.len() && chars[end].is_ascii_digit() {
        end += 1;
    }
    if end < chars.len() && chars[end] == '.' {
        end += 1;
        while end < chars.len() && chars[end].is_ascii_digit() {
            end += 1;
        }
    }
    if end == start {
        return None;
    }
    let text: String = chars[start..end].iter().collect();
    Some((text, end - start))
}

/// Read a bare identifier `[A-Za-z][A-Za-z0-9]*` starting at `pos`.
fn read_bare_word(chars: &[char], pos: usize) -> Option<String> {
    let start = pos;
    let mut end = pos;
    if end >= chars.len() || !chars[end].is_ascii_alphabetic() {
        return None;
    }
    end += 1;
    while end < chars.len() && chars[end].is_ascii_alphanumeric() {
        end += 1;
    }
    Some(chars[start..end].iter().collect())
}

/// Read `\` followed by an identifier `[A-Za-z][A-Za-z0-9]*`. Returns the
/// whole token including the backslash (so `\alpha2` surfaces as
/// `\alpha2`, matching the JS parser's message exactly).
fn read_backslash_word(chars: &[char], pos: usize) -> Option<String> {
    let start = pos;
    let mut end = pos;
    if end >= chars.len() || chars[end] != '\\' {
        return None;
    }
    end += 1;
    if end >= chars.len() || !chars[end].is_ascii_alphabetic() {
        return None;
    }
    end += 1;
    while end < chars.len() && chars[end].is_ascii_alphanumeric() {
        end += 1;
    }
    Some(chars[start..end].iter().collect())
}

fn is_unicode_minus(ch: char) -> bool {
    ch == '−' // U+2212
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_is_phase_zero() {
        assert_eq!(parse_phase("").unwrap(), 0.0);
        assert_eq!(parse_phase("   ").unwrap(), 0.0);
    }

    #[test]
    fn only_delimiters_is_phase_zero() {
        assert_eq!(parse_phase("$   $").unwrap(), 0.0);
        assert_eq!(parse_phase("$$\n$$").unwrap(), 0.0);
    }
}
