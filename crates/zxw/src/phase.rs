// crates/zxw/src/phase.rs
//
// Phase expression parser — Rust port of `src/lib/phase/parser.ts`. Same
// grammar, same error messages. Both parsers are kept in lock-step by the
// shared fixture at `tests/fixtures/phase_grammar.json`; a change to one
// without the other fails CI.
//
// Grammar (v1, numeric only):
//
//   phase   := term  (('+' | '-') term)*
//   term    := factor (('*' | '/') factor)*
//   factor  := number | '\pi' | 'π' | 'pi' | 'PI' | '(' phase ')' | unary
//   unary   := '-' factor | '+' factor
//   number  := [0-9]+ ('.' [0-9]*)?
//
// Whitespace is ignored. Unicode `−` (U+2212), `×` (U+00D7), `÷` (U+00F7)
// are accepted as `-`, `*`, `/` so pasted typeset input parses unchanged.
// A leading/trailing `$...$` or `$$...$$` pair is stripped first, so the
// same string can be both KaTeX-rendered and parsed here.
//
// Invariants the JS port shares (mirrored here, see plan §4.1):
//   - Result field is `value`, not `radians`.
//   - Unary `+` exists; `--3` works via two stacked unary `-`.
//   - Word consumer refuses `pi` / `\<word>` when followed by another
//     alphanumeric, so `pi2` → "Unknown variable 'pi2'" (not `pi` + `2`).
//   - A non-finite result (e.g. `1 / 0` → +inf) is `PhaseError::NonFinite`,
//     never silently returned.

use crate::error::PhaseError;

/// Parse a phase expression into radians. Empty/whitespace-only input
/// returns `Ok(0)` — the identity phase — so blank spider labels mean
/// "no rotation".
pub fn parse_phase(input: &str) -> Result<f64, PhaseError> {
    let stripped = strip_math_delimiters(input);
    if stripped.is_empty() {
        return Ok(0.0);
    }

    // Index by char so multi-byte UTF-8 positions line up with the JS
    // code-unit indices on our BMP subset (ASCII + π, ×, ÷, − — all
    // single-code-unit in both UTF-16 and char-indexed Rust).
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

/// Build the most informative error for trailing input: a bare identifier
/// surfaces as the whole token (`hello`, not `h`); a `\<word>` surfaces as
/// `\alpha`, not `\`.
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

/// Strip a matching leading/trailing `$...$` or `$$...$$` pair. Only acts
/// when both delimiters are present at the matching positions, so a label
/// like `price: $5` is left alone.
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

    // Unary prefix — ASCII and Unicode minus.
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

    // π variants: `\pi`, the unicode character, and the bare ASCII words.
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

    // Numeric literal `[0-9]+ ( '.' [0-9]* )?`. Requires a leading digit —
    // bare `.5` is NOT in the v1 grammar (fails to match so the caller
    // reports the stray `.` as an UnexpectedToken, mirroring the JS regex).
    if let Some((text, len)) = read_number(chars, c.pos) {
        c.pos += len;
        return Ok(text.parse::<f64>().unwrap());
    }

    // `\<word>` — only `\pi` is supported; anything else is an error.
    // Report the whole token (e.g. `\alpha2`), not just the leading letters.
    if ch == '\\' {
        if let Some(token) = read_backslash_word(chars, c.pos) {
            return Err(PhaseError::UnknownVariable(token));
        }
    }

    // Bare identifier — unsupported free variable in v1 (Phase 6 adds
    // symbolic arithmetic). Same "include trailing digits" rule as above.
    if ch.is_ascii_alphabetic() {
        if let Some(token) = read_bare_word(chars, c.pos) {
            return Err(PhaseError::UnknownVariable(token));
        }
    }

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

/// Consume an ASCII word only when not followed by another ASCII
/// alphanumeric. So `pi` matches in `pi/2` but not in `pi2` — the latter
/// falls through to the unknown-variable branch, avoiding a silent `pi`
/// match with an orphan `2` left over.
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

/// Read `[0-9]+ ( '.' [0-9]* )?` starting at `pos`, returning the matched
/// text and its length in chars.
///
/// The `end == start` guard sits before the dot branch on purpose: for
/// `.5` it must return `None` (so the caller reports the `.` as an
/// UnexpectedToken), not consume the dot and yield `Some((".5", 2))` —
/// which Rust's std `f64` parser would otherwise accept as `0.5`.
fn read_number(chars: &[char], pos: usize) -> Option<(String, usize)> {
    let start = pos;
    let mut end = pos;
    while end < chars.len() && chars[end].is_ascii_digit() {
        end += 1;
    }
    if end == start {
        return None;
    }
    if end < chars.len() && chars[end] == '.' {
        end += 1;
        while end < chars.len() && chars[end].is_ascii_digit() {
            end += 1;
        }
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

/// Read `\` followed by an identifier `[A-Za-z][A-Za-z0-9]*`, returning the
/// whole token including the backslash (so `\alpha2` surfaces intact).
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
