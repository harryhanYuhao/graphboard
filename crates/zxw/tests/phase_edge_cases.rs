// crates/zxw/tests/phase_edge_cases.rs
//
// Edge-case probes for the phase-expression parser. Each test pins ONE
// behavior, with the EXPECTED result derived from the JS source of
// truth at `src/lib/phase/parser.ts` (the parser this Rust port must
// match — same parse results, same error messages, fragment-matched).
//
// Tests for confirmed JS/Rust divergences are marked `#[ignore]` with
// a comment citing the JS source line(s) and the suspected Rust line.
// The parent agent keeps diff control for the fix phase, so this file
// asserts the JS-correct behavior even where Rust currently diverges.

use approx::assert_relative_eq;
use zxw::parse_phase;
use zxw::PhaseError;

const PI: f64 = std::f64::consts::PI;

// ===========================================================================
// Prime suspect: identifier-aware `\pi` matching.
//
// The plan §4.1 quirk #4 claims identifier-aware matching applies to
// `\<word>` too. The JS parser does NOT implement that — it consumes
// `\pi` via `tryConsumeLiteral` (parser.ts:192-196) which has NO
// follower check, then the orphan `2` is reported as trailing junk.
// The Rust port faithfully mirrors this. So `\pi2` is NOT an
// `UnknownVariable("\\pi2")` in either implementation — it's an
// `UnexpectedToken { found: "2", position: 3 }`. Pinning that here.
// ===========================================================================

#[test]
fn backslash_pi_followed_by_digit_is_unexpected_token_not_unknown_var() {
    // JS: parser.ts:192 `tryConsumeLiteral(input, c, "\\pi")` consumes
    // `\pi` with no follower check; then the `2` is trailing junk at
    // position 3 → `Unexpected '2' at position 3`.
    // Rust: phase.rs:193 `try_consume_literal(chars, c, "\\pi")`
    // likewise succeeds; phase.rs:60-62 surfaces the `2` via
    // `trailing_junk_error` → `UnexpectedToken { found: "2", pos: 3 }`.
    let err = parse_phase("\\pi2").unwrap_err();
    match err {
        PhaseError::UnexpectedToken { found, position } => {
            assert_eq!(found, "2");
            assert_eq!(position, 3);
        }
        other => panic!("expected UnexpectedToken, got {other:?}"),
    }
}

#[test]
fn backslash_pialpha_reports_alpha_without_backslash() {
    // JS: `\pi` consumes 3 chars; `alpha` is trailing bare word →
    // trailingJunkError bare-word branch → `Unknown variable 'alpha'`
    // (note: NO backslash — parser.ts:79-86).
    // Rust: phase.rs:72-83 reads bare word at the orphan position →
    // `UnknownVariable("alpha")`.
    let err = parse_phase("\\pialpha").unwrap_err();
    match err {
        PhaseError::UnknownVariable(token) => assert_eq!(token, "alpha"),
        other => panic!("expected UnknownVariable, got {other:?}"),
    }
}

#[test]
fn backslash_pi_followed_by_paren_is_unexpected_token() {
    // Two adjacent factors (`\pi` then `(1+1)`) with no operator.
    // JS: `\pi` consumed, then `(` is trailing junk at position 3 →
    // `Unexpected '(' at position 3` (parser.ts:87-89).
    // Rust: phase.rs:60-62 / 84-88 → `UnexpectedToken { "(" , 3 }`.
    let err = parse_phase("\\pi(1+1)").unwrap_err();
    match err {
        PhaseError::UnexpectedToken { found, position } => {
            assert_eq!(found, "(");
            assert_eq!(position, 3);
        }
        other => panic!("expected UnexpectedToken, got {other:?}"),
    }
}

#[test]
fn backslash_pi_backslash_pi_reports_unknown_variable_with_backslash() {
    // `\pi\pi`: first `\pi` consumes; second `\pi` is trailing junk
    // via the BACKSLASH branch → `Unknown variable '\pi'` (WITH the
    // leading backslash). JS parser.ts:71-78; Rust phase.rs:74-78.
    let err = parse_phase("\\pi\\pi").unwrap_err();
    match err {
        PhaseError::UnknownVariable(token) => assert_eq!(token, "\\pi"),
        other => panic!("expected UnknownVariable, got {other:?}"),
    }
}

#[test]
fn backslash_p_is_unknown_variable() {
    // `\p`: backslash + single letter, not `\pi`. Both parsers report
    // the whole `\p` token as unknown. JS parser.ts:216-223;
    // Rust phase.rs:218-222 + read_backslash_word (phase.rs:316-331).
    let err = parse_phase("\\p").unwrap_err();
    match err {
        PhaseError::UnknownVariable(token) => assert_eq!(token, "\\p"),
        other => panic!("expected UnknownVariable, got {other:?}"),
    }
}

#[test]
fn lone_backslash_then_space_is_unexpected_token() {
    // `1 \ 2`: the `\` is followed by a space, not a letter, so
    // read_backslash_word returns None and it surfaces as a plain
    // UnexpectedToken. JS parser.ts:87-89; Rust phase.rs:84-88.
    let err = parse_phase("1 \\ 2").unwrap_err();
    match err {
        PhaseError::UnexpectedToken { found, position } => {
            assert_eq!(found, "\\");
            assert_eq!(position, 2);
        }
        other => panic!("expected UnexpectedToken, got {other:?}"),
    }
}

// ===========================================================================
// Bare-word identifier matching (pi/PI identifier-aware consumer).
// ===========================================================================

#[test]
fn pi2_is_unknown_variable_pi2() {
    // `pi2`: try_consume_word("pi") refuses (next char `2` is
    // alphanumeric) → falls through to read_bare_word → whole `pi2`
    // token reported. JS parser.ts:262-269 + 228-235.
    let err = parse_phase("pi2").unwrap_err();
    match err {
        PhaseError::UnknownVariable(token) => assert_eq!(token, "pi2"),
        other => panic!("expected UnknownVariable, got {other:?}"),
    }
}

#[test]
fn pi_underscore_2_is_unexpected_underscore() {
    // `pi_2`: `pi` would match (next char `_` is NOT alphanumeric so
    // try_consume_word SUCCEEDS), then `_2` is trailing junk where `_`
    // is neither backslash nor alphabetic → `UnexpectedToken { "_" }`.
    // JS: same — `pi` consumes, `_` at position 2 →
    // `Unexpected '_' at position 2`.
    let err = parse_phase("pi_2").unwrap_err();
    match err {
        PhaseError::UnexpectedToken { found, position } => {
            assert_eq!(found, "_");
            assert_eq!(position, 2);
        }
        other => panic!("expected UnexpectedToken, got {other:?}"),
    }
}

#[test]
fn pizarro_is_unknown_variable_pizarro() {
    let err = parse_phase("pizarro").unwrap_err();
    match err {
        PhaseError::UnknownVariable(token) => assert_eq!(token, "pizarro"),
        other => panic!("expected UnknownVariable, got {other:?}"),
    }
}

#[test]
fn p_i2_is_unknown_variable_pi2() {
    // `PI2` — only `PI` (exact) is matched; `PI2` is a bare word.
    let err = parse_phase("PI2").unwrap_err();
    match err {
        PhaseError::UnknownVariable(token) => assert_eq!(token, "PI2"),
        other => panic!("expected UnknownVariable, got {other:?}"),
    }
}

#[test]
fn mixed_case_pi_is_unknown_variable() {
    // Only `pi` and `PI` are matched (case-sensitive). `Pi` falls
    // through to read_bare_word. JS parser.ts:197-201.
    let err = parse_phase("Pi").unwrap_err();
    match err {
        PhaseError::UnknownVariable(token) => assert_eq!(token, "Pi"),
        other => panic!("expected UnknownVariable, got {other:?}"),
    }
}

// ===========================================================================
// CONFIRMED DIVERGENCE: bare-word error MESSAGE fragment.
//
// JS has TWO separate messages for UnknownVariable:
//   - parseFactor inline throw (parser.ts:231-234):
//       "Unknown variable '<tok>' (only pi is supported in v1)"   <-- no `\`
//     used when the bare word is the WHOLE expression / a factor.
//   - trailingJunkError (parser.ts:79-86):
//       "Unknown variable '<tok>' (only \pi is supported in v1)"   <-- WITH `\`
//     used when the bare word is TRAILING junk after a successful parse.
//
// Rust's error.rs:26 has a SINGLE Display impl that always emits
// `(only \pi is supported in v1)` — for both bare and backslash, both
// factor-position and trailing-junk. So the factor-position bare-word
// cases (`pi2`, `pizarro`, `PI2`, `Pi`, `alpha`) emit the WRONG
// fragment in Rust.
//
// These are marked #[ignore]; destructure + check the token still
// works (the variant + token are correct), only the message diverges.
// ===========================================================================

#[test]
#[ignore = "JS/Rust message divergence: JS parser.ts:233 emits '(only pi is supported in v1)' \
            for a bare-word FACTOR (no backslash); Rust error.rs:26 always emits \
            '(only \\pi is supported in v1)'. Token + variant are correct, only the fragment differs."]
fn bare_word_factor_message_has_no_backslash_around_pi_js_divergence() {
    // `pi2` as a whole-expression factor: JS message contains
    // "(only pi is supported" — the literal `pi`, no backslash.
    let err = parse_phase("pi2").unwrap_err();
    let msg = format!("{err}");
    assert!(
        msg.contains("(only pi is supported"),
        "expected JS message fragment '(only pi is supported', got: {msg}"
    );
}

#[test]
#[ignore = "JS/Rust message divergence (same as above): JS parser.ts:233 for bare-word factor \
            uses '(only pi is supported in v1)'; Rust error.rs:26 uses '(only \\pi is supported in v1)'. \
            Affects alpha/pizarro/PI2/Pi as whole-expression factors too."]
fn alpha_as_factor_message_has_no_backslash_js_divergence() {
    let err = parse_phase("alpha").unwrap_err();
    let msg = format!("{err}");
    assert!(
        msg.contains("(only pi is supported"),
        "expected JS fragment '(only pi is supported', got: {msg}"
    );
}

// Sanity check (NOT ignored): the trailing-junk bare-word path in BOTH
// implementations DOES keep the backslash form. So `1 + 2 hello` →
// "Unknown variable 'hello' (only \pi is supported in v1)" matches.
#[test]
fn trailing_junk_bare_word_message_keeps_backslash_form_in_both() {
    // JS trailingJunkError (parser.ts:79-86) and Rust trailing_junk_error
    // (phase.rs:79-83) both emit "(only \pi is supported in v1)" for a
    // bare word that is TRAILING junk. This is consistent.
    let err = parse_phase("1 + 2 hello").unwrap_err();
    match &err {
        PhaseError::UnknownVariable(token) => {
            assert_eq!(token, "hello");
            let msg = format!("{err}");
            assert!(msg.contains("(only \\pi is supported"));
        }
        other => panic!("expected UnknownVariable, got {other:?}"),
    }
}

// ===========================================================================
// Number grammar.
// ===========================================================================

#[test]
fn bare_dot5_no_leading_digit_is_unexpected_dot() {
    // `.5` (no leading digit) is NOT in the v1 grammar — JS's number
    // regex is `/^\d+\.?\d*/` (`parser.ts:206`), which requires a leading
    // digit. Rust's `read_number` now matches that contract: the
    // `end == start` guard fires *before* the dot branch, so the stray
    // `.` surfaces as `UnexpectedToken { found: ".", position: 0 }` on
    // both sides of the WASM boundary.
    let err = parse_phase(".5").unwrap_err();
    match err {
        PhaseError::UnexpectedToken { found, position } => {
            assert_eq!(found, ".");
            assert_eq!(position, 0);
        }
        other => panic!("expected UnexpectedToken, got {other:?}"),
    }
}

#[test]
fn trailing_dot_3_parses_to_3() {
    // `3.` → `3` (the `.?\d*` allows a dot with no fraction).
    assert_eq!(parse_phase("3.").unwrap(), 3.0);
}

#[test]
fn two_dots_3_5_6_is_unexpected_second_dot() {
    // `3.5.6`: number match consumes `3.5`, then `.` at position 3 is
    // trailing junk → UnexpectedToken. JS parser.ts:87-89;
    // Rust phase.rs:60-62.
    let err = parse_phase("3.5.6").unwrap_err();
    match err {
        PhaseError::UnexpectedToken { found, position } => {
            assert_eq!(found, ".");
            assert_eq!(position, 3);
        }
        other => panic!("expected UnexpectedToken, got {other:?}"),
    }
}

#[test]
fn double_unary_minus_is_positive_3() {
    // `--3` → `-(-(3))` = 3. JS parser.ts:169-172; Rust phase.rs:166-170.
    assert_eq!(parse_phase("--3").unwrap(), 3.0);
}

#[test]
fn triple_unary_minus_is_negative_3() {
    // `---3` → -(-(-(3))) = -3.
    assert_eq!(parse_phase("---3").unwrap(), -3.0);
}

#[test]
fn unary_plus_then_unary_minus_is_negative_3() {
    // `+-3` → `+(−3)` = -3. JS parser.ts:174-177; Rust phase.rs:171-174.
    assert_eq!(parse_phase("+-3").unwrap(), -3.0);
}

// ===========================================================================
// Non-finite results.
// ===========================================================================

#[test]
fn one_over_zero_is_non_finite_positive_infinity() {
    let err = parse_phase("1 / 0").unwrap_err();
    match err {
        PhaseError::NonFinite(v) => {
            assert!(v.is_infinite() && v.is_sign_positive(), "got {v}");
        }
        other => panic!("expected NonFinite, got {other:?}"),
    }
}

#[test]
fn zero_over_zero_is_non_finite_nan() {
    let err = parse_phase("0 / 0").unwrap_err();
    match err {
        PhaseError::NonFinite(v) => assert!(v.is_nan(), "got {v}"),
        other => panic!("expected NonFinite, got {other:?}"),
    }
}

#[test]
fn one_over_zero_times_five_is_non_finite_inf_left_to_right() {
    // Left-assoc: `(1/0)*5` = inf*5 = inf → NonFinite(+inf).
    let err = parse_phase("1 / 0 * 5").unwrap_err();
    match err {
        PhaseError::NonFinite(v) => {
            assert!(v.is_infinite() && v.is_sign_positive(), "got {v}");
        }
        other => panic!("expected NonFinite, got {other:?}"),
    }
}

#[test]
fn negative_zero_parses_to_negative_zero() {
    // `-0` → `-0.0` (finite, is_zero, sign negative). JS returns value 0
    // (JS has no signed zero distinction at the API level but Number
    // preserves -0 internally; here we pin Rust's signed-zero result).
    let v = parse_phase("-0").unwrap();
    assert!(v == 0.0);
    assert!(v.is_sign_negative(), "expected -0.0, got {v}");
    assert!(v.is_finite());
}

#[test]
fn very_large_digit_string_parses_finite() {
    // A 30-digit `9...9` fits in f64 (≈1e30, finite). JS returns 1e30.
    let v = parse_phase("999999999999999999999999999999").unwrap();
    assert!(v.is_finite());
    assert_relative_eq!(v, 1e30, max_relative = 1e-15, epsilon = 1e-15);
}

#[test]
fn overflow_digit_string_is_non_finite_inf() {
    // A 400-digit `9...9` overflows f64 → parse() yields inf →
    // NonFinite(inf). JS parseFloat likewise yields Infinity → error.
    let big = "9".repeat(400);
    let err = parse_phase(&big).unwrap_err();
    match err {
        PhaseError::NonFinite(v) => {
            assert!(v.is_infinite() && v.is_sign_positive(), "got {v}");
        }
        other => panic!("expected NonFinite, got {other:?}"),
    }
}

// ===========================================================================
// Unicode operators and π spellings.
// ===========================================================================

#[test]
fn two_times_unicode_pi_with_space() {
    // `2 * π` = 2π. The unicode π is matched via try_consume_literal.
    assert_relative_eq!(parse_phase("2 * π").unwrap(), 2.0 * PI);
}

#[test]
fn two_pi_no_space_is_unexpected_pi() {
    // `2π`: after parsing `2` as a factor, `π` is adjacent with no
    // operator → trailing junk → UnexpectedToken { "π", 1 }.
    // JS parser.ts:87-89; Rust phase.rs:60-62, 84-88.
    let err = parse_phase("2π").unwrap_err();
    match err {
        PhaseError::UnexpectedToken { found, position } => {
            assert_eq!(found, "π");
            assert_eq!(position, 1);
        }
        other => panic!("expected UnexpectedToken, got {other:?}"),
    }
}

#[test]
fn unicode_times_2_x_3_is_6() {
    assert_eq!(parse_phase("2 × 3").unwrap(), 6.0);
}

#[test]
fn unicode_divide_6_div_2_is_3() {
    assert_eq!(parse_phase("6 ÷ 2").unwrap(), 3.0);
}

#[test]
fn unicode_minus_5_minus_2_is_3() {
    // U+2212 minus. JS parser.ts:271-273; Rust phase.rs:333-335.
    assert_eq!(parse_phase("5 − 2").unwrap(), 3.0);
}

// ===========================================================================
// Parentheses.
// ===========================================================================

#[test]
fn paren_then_multiply_is_9() {
    assert_eq!(parse_phase("(1 + 2) * 3").unwrap(), 9.0);
}

#[test]
fn nested_parens_then_multiply_is_9() {
    assert_eq!(parse_phase("((1 + 2)) * 3").unwrap(), 9.0);
}

#[test]
fn unclosed_paren_is_missing_close_paren_at_6() {
    // `(1 + 2`: parse_expr inside parens reaches end-of-input before
    // seeing `)` → MissingCloseParen(position past last consumed char).
    // JS parser.ts:184-186; Rust phase.rs:181-189. Position 6 = end.
    let err = parse_phase("(1 + 2").unwrap_err();
    match err {
        PhaseError::MissingCloseParen(pos) => assert_eq!(pos, 6),
        other => panic!("expected MissingCloseParen, got {other:?}"),
    }
}

#[test]
fn empty_parens_is_unexpected_close_paren_at_1() {
    // `()`: parse_expr → parse_term → parse_factor at `)` → nothing
    // matches, `)` is not a valid factor start → UnexpectedToken.
    // JS parser.ts:242; Rust phase.rs:235-238.
    let err = parse_phase("()").unwrap_err();
    match err {
        PhaseError::UnexpectedToken { found, position } => {
            assert_eq!(found, ")");
            assert_eq!(position, 1);
        }
        other => panic!("expected UnexpectedToken, got {other:?}"),
    }
}

#[test]
fn whitespace_only_empty_parens_is_unexpected_close_at_3() {
    // `(  )`: skip_ws skips the inner spaces; `)` at char index 3.
    let err = parse_phase("(  )").unwrap_err();
    match err {
        PhaseError::UnexpectedToken { found, position } => {
            assert_eq!(found, ")");
            assert_eq!(position, 3);
        }
        other => panic!("expected UnexpectedToken, got {other:?}"),
    }
}

// ===========================================================================
// Trailing / leading junk.
// ===========================================================================

#[test]
fn trailing_operator_is_unexpected_end_of_input() {
    // `1 + `: `+` consumes, then parse_term → parse_factor hits
    // end-of-input → UnexpectedEndOfInput. JS parser.ts:239-241;
    // Rust phase.rs:161-163.
    let err = parse_phase("1 + ").unwrap_err();
    assert!(matches!(err, PhaseError::UnexpectedEndOfInput));
}

#[test]
fn leading_operator_is_unexpected_token_star() {
    // `* 3`: `*` at position 0 is not a valid factor start.
    let err = parse_phase("* 3").unwrap_err();
    match err {
        PhaseError::UnexpectedToken { found, position } => {
            assert_eq!(found, "*");
            assert_eq!(position, 0);
        }
        other => panic!("expected UnexpectedToken, got {other:?}"),
    }
}

#[test]
fn hash_is_unexpected_token_at_2() {
    // `1 # 2`: `1` parses, `#` at position 2 is trailing junk.
    let err = parse_phase("1 # 2").unwrap_err();
    match err {
        PhaseError::UnexpectedToken { found, position } => {
            assert_eq!(found, "#");
            assert_eq!(position, 2);
        }
        other => panic!("expected UnexpectedToken, got {other:?}"),
    }
}

// ===========================================================================
// Position encoding: char index, not byte index.
// ===========================================================================

#[test]
fn unexpected_token_position_is_char_index_not_byte_index() {
    // `π # `: π is 1 char (3 bytes). The `#` is at CHAR index 2 but
    // BYTE index 3. JS uses UTF-16 code-unit index (1 unit for π on
    // the BMP) → position 2. Rust uses `Vec<char>` index → position 2.
    // Asserting char index keeps the two in lock-step.
    let err = parse_phase("π # ").unwrap_err();
    match err {
        PhaseError::UnexpectedToken { found, position } => {
            assert_eq!(found, "#");
            assert_eq!(position, 2, "position must be char index, not byte index");
        }
        other => panic!("expected UnexpectedToken, got {other:?}"),
    }
}

#[test]
fn unicode_pi_adjacent_to_hash_position_is_char_index() {
    // `π#`: `#` at char index 1, byte index 3. JS reports position 1.
    let err = parse_phase("π#").unwrap_err();
    match err {
        PhaseError::UnexpectedToken { found, position } => {
            assert_eq!(found, "#");
            assert_eq!(position, 1);
        }
        other => panic!("expected UnexpectedToken, got {other:?}"),
    }
}

// ===========================================================================
// Math-delimiter stripping.
// ===========================================================================

#[test]
fn single_dollar_wrap_strips_to_3_5() {
    assert_eq!(parse_phase("$3.5$").unwrap(), 3.5);
}

#[test]
fn double_dollar_wrap_strips_to_3_5() {
    assert_eq!(parse_phase("$$3.5$$").unwrap(), 3.5);
}

#[test]
fn triple_dollar_wrap_is_unexpected_token_at_0() {
    // `$$$3.5$$$`: starts/ends with `$$` but the `$$...$$` strip
    // requires len>=4 AND exact `$$` at both ends. After a `$$` match
    // on a 3-`$` prefix there's a leftover `$` at start; the strip
    // logic does NOT fire for the ambiguous case and the leading `$`
    // is reported. JS: parser.ts:112-121 leaves it untouched;
    // Rust phase.rs:105-116 likewise. Position 0.
    let err = parse_phase("$$$3.5$$$").unwrap_err();
    match err {
        PhaseError::UnexpectedToken { found, position } => {
            assert_eq!(found, "$");
            assert_eq!(position, 0);
        }
        other => panic!("expected UnexpectedToken, got {other:?}"),
    }
}

#[test]
fn open_dollar_only_does_not_strip_and_is_unexpected_at_0() {
    // `$3.5`: only ONE `$` → no strip. `$` at position 0 → junk.
    let err = parse_phase("$3.5").unwrap_err();
    match err {
        PhaseError::UnexpectedToken { found, position } => {
            assert_eq!(found, "$");
            assert_eq!(position, 0);
        }
        other => panic!("expected UnexpectedToken, got {other:?}"),
    }
}

#[test]
fn close_dollar_only_does_not_strip_and_is_unexpected_at_3() {
    // `3.5$`: only ONE `$` → no strip → `3.5` parses, `$` at position 3
    // is trailing junk.
    let err = parse_phase("3.5$").unwrap_err();
    match err {
        PhaseError::UnexpectedToken { found, position } => {
            assert_eq!(found, "$");
            assert_eq!(position, 3);
        }
        other => panic!("expected UnexpectedToken, got {other:?}"),
    }
}

// ===========================================================================
// Whitespace handling.
// ===========================================================================

#[test]
fn whitespace_around_backslash_pi_parses() {
    assert_relative_eq!(parse_phase("  \\pi  ").unwrap(), PI);
}

// ===========================================================================
// Non-grammar numeric forms (scientific / hex) — pin as UnknownVariable.
// ===========================================================================

#[test]
fn scientific_notation_1e3_is_unknown_variable_e3() {
    // `1e3`: number match consumes `1`; `e3` is trailing bare word →
    // UnknownVariable("e3"). JS parser.ts:206 + 228-235;
    // Rust phase.rs:280-297 + 227-231.
    let err = parse_phase("1e3").unwrap_err();
    match err {
        PhaseError::UnknownVariable(token) => assert_eq!(token, "e3"),
        other => panic!("expected UnknownVariable, got {other:?}"),
    }
}

#[test]
fn hex_0x10_is_unknown_variable_x10() {
    // `0x10`: number match consumes `0`; `x10` is trailing bare word.
    let err = parse_phase("0x10").unwrap_err();
    match err {
        PhaseError::UnknownVariable(token) => assert_eq!(token, "x10"),
        other => panic!("expected UnknownVariable, got {other:?}"),
    }
}

// ===========================================================================
// Misc identifier / trailing-junk.
// ===========================================================================

#[test]
fn pi_space_pi_reports_unknown_variable_pi() {
    // `pi pi`: first `pi` matches (next char space, ok); second `pi` is
    // trailing junk → UnknownVariable("pi") via the bare-word trailing
    // branch (with the backslash form in the message, in BOTH parsers).
    let err = parse_phase("pi pi").unwrap_err();
    match err {
        PhaseError::UnknownVariable(token) => assert_eq!(token, "pi"),
        other => panic!("expected UnknownVariable, got {other:?}"),
    }
}
