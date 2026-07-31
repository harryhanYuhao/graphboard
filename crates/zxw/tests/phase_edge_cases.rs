// crates/zxw/tests/phase_edge_cases.rs
//
// Edge-case probes for the phase-expression parser. Each pins ONE
// behavior; expected results match the JS source of truth
// (`src/lib/phase/parser.ts`) — same parse results, same error messages,
// fragment-matched. Confirmed JS/Rust divergences are `#[ignore]`d.

use approx::assert_relative_eq;
use zxw::parse_phase;
use zxw::PhaseError;

const PI: f64 = std::f64::consts::PI;

// ===========================================================================
// `\pi` matching is NOT identifier-aware.
//
// `\pi` consumes 3 chars with no follower check; the orphan follower is
// reported as trailing junk, not absorbed into the token. So `\pi2` →
// `UnexpectedToken { "2", 3 }`, not `UnknownVariable("\\pi2")`.
// ===========================================================================

#[test]
fn backslash_pi_followed_by_digit_is_unexpected_token_not_unknown_var() {
    // `\pi` consumes; the `2` is trailing junk at position 3.
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
    // `\pi` consumes; `alpha` is a trailing bare word → `UnknownVariable("alpha")`.
    let err = parse_phase("\\pialpha").unwrap_err();
    match err {
        PhaseError::UnknownVariable(token) => assert_eq!(token, "alpha"),
        other => panic!("expected UnknownVariable, got {other:?}"),
    }
}

#[test]
fn backslash_pi_followed_by_paren_is_unexpected_token() {
    // Adjacent factors with no operator: `\pi` consumes, `(` is trailing junk.
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
    // Second `\pi` is trailing junk via the backslash branch →
    // `UnknownVariable("\\pi")` (keeps the leading backslash).
    let err = parse_phase("\\pi\\pi").unwrap_err();
    match err {
        PhaseError::UnknownVariable(token) => assert_eq!(token, "\\pi"),
        other => panic!("expected UnknownVariable, got {other:?}"),
    }
}

#[test]
fn backslash_p_is_unknown_variable() {
    // `\p` (backslash + non-`pi` letter) → whole token reported unknown.
    let err = parse_phase("\\p").unwrap_err();
    match err {
        PhaseError::UnknownVariable(token) => assert_eq!(token, "\\p"),
        other => panic!("expected UnknownVariable, got {other:?}"),
    }
}

#[test]
fn lone_backslash_then_space_is_unexpected_token() {
    // `\` followed by a space (not a letter) → plain UnexpectedToken.
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
    // `pi` won't match (next char `2` is alphanumeric) → whole `pi2` bare word.
    let err = parse_phase("pi2").unwrap_err();
    match err {
        PhaseError::UnknownVariable(token) => assert_eq!(token, "pi2"),
        other => panic!("expected UnknownVariable, got {other:?}"),
    }
}

#[test]
fn pi_underscore_2_is_unexpected_underscore() {
    // `pi` matches (next char `_` isn't alphanumeric), then `_` is
    // trailing junk → UnexpectedToken { "_", 2 }.
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
    // Only `PI` (exact) matches; `PI2` is a bare word.
    let err = parse_phase("PI2").unwrap_err();
    match err {
        PhaseError::UnknownVariable(token) => assert_eq!(token, "PI2"),
        other => panic!("expected UnknownVariable, got {other:?}"),
    }
}

#[test]
fn mixed_case_pi_is_unknown_variable() {
    // Only `pi` and `PI` match (case-sensitive); `Pi` is a bare word.
    let err = parse_phase("Pi").unwrap_err();
    match err {
        PhaseError::UnknownVariable(token) => assert_eq!(token, "Pi"),
        other => panic!("expected UnknownVariable, got {other:?}"),
    }
}

// ===========================================================================
// CONFIRMED DIVERGENCE: bare-word UnknownVariable message fragment.
//
// JS has two messages — "(only pi is supported in v1)" for a bare-word
// factor, "(only \pi is supported in v1)" for trailing junk. Rust has a
// single Display impl that always uses the backslash form, so the
// factor-position bare-word cases emit the wrong fragment. Token + variant
// are correct; only the message diverges. Marked #[ignore].
// ===========================================================================

#[test]
#[ignore = "JS/Rust message divergence: bare-word FACTOR message uses '(only pi is supported \
            in v1)' in JS but Rust always emits '(only \\pi is supported in v1)'."]
fn bare_word_factor_message_has_no_backslash_around_pi_js_divergence() {
    // `pi2` as a whole-expression factor: JS message has "(only pi is supported".
    let err = parse_phase("pi2").unwrap_err();
    let msg = format!("{err}");
    assert!(
        msg.contains("(only pi is supported"),
        "expected JS message fragment '(only pi is supported', got: {msg}"
    );
}

#[test]
#[ignore = "JS/Rust message divergence (same as above): bare-word factor uses '(only pi is \
            supported in v1)' in JS; Rust uses the backslash form. Affects alpha/pizarro/PI2/Pi too."]
fn alpha_as_factor_message_has_no_backslash_js_divergence() {
    let err = parse_phase("alpha").unwrap_err();
    let msg = format!("{err}");
    assert!(
        msg.contains("(only pi is supported"),
        "expected JS fragment '(only pi is supported', got: {msg}"
    );
}

// Sanity check (NOT ignored): the trailing-junk bare-word path keeps the
// backslash form in both implementations → `1 + 2 hello` matches.
#[test]
fn trailing_junk_bare_word_message_keeps_backslash_form_in_both() {
    // Trailing-junk bare word → "(only \pi is supported in v1)" in both.
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
    // `.5` (no leading digit) isn't in the grammar (number regex requires a
    // leading digit); the stray `.` → UnexpectedToken { ".", 0 }.
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
    // Number match consumes `3.5`; the second `.` at position 3 is trailing junk.
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
    // `--3` → -(-(3)) = 3.
    assert_eq!(parse_phase("--3").unwrap(), 3.0);
}

#[test]
fn triple_unary_minus_is_negative_3() {
    // `---3` → -(-(-(3))) = -3.
    assert_eq!(parse_phase("---3").unwrap(), -3.0);
}

#[test]
fn unary_plus_then_unary_minus_is_negative_3() {
    // `+-3` → +(−3) = -3.
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
    // `-0` → -0.0 (finite, sign negative). Pinning Rust's signed-zero result.
    let v = parse_phase("-0").unwrap();
    assert!(v == 0.0);
    assert!(v.is_sign_negative(), "expected -0.0, got {v}");
    assert!(v.is_finite());
}

#[test]
fn very_large_digit_string_parses_finite() {
    // A 30-digit `9...9` fits in f64 (≈1e30, finite).
    let v = parse_phase("999999999999999999999999999999").unwrap();
    assert!(v.is_finite());
    assert_relative_eq!(v, 1e30, max_relative = 1e-15, epsilon = 1e-15);
}

#[test]
fn overflow_digit_string_is_non_finite_inf() {
    // A 400-digit `9...9` overflows f64 → inf → NonFinite(inf).
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
    // `2π`: `2` parses, adjacent `π` with no operator → trailing junk.
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
    // U+2212 minus.
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
    // `(1 + 2`: end-of-input before `)` → MissingCloseParen (position 6 = end).
    let err = parse_phase("(1 + 2").unwrap_err();
    match err {
        PhaseError::MissingCloseParen(pos) => assert_eq!(pos, 6),
        other => panic!("expected MissingCloseParen, got {other:?}"),
    }
}

#[test]
fn empty_parens_is_unexpected_close_paren_at_1() {
    // `()`: `)` isn't a valid factor start → UnexpectedToken.
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
    // `1 + `: `+` consumes, then a factor hits end-of-input.
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
    // π is 1 char (3 bytes). `#` is at char index 2 but byte index 3;
    // asserting char index keeps JS (UTF-16) and Rust (`Vec<char>`) in lock-step.
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
    // `π#`: `#` at char index 1, byte index 3.
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
    // `$$$3.5$$$`: the `$$...$$` strip needs exact `$$` at both ends;
    // a 3-`$` prefix leaves a stray `$` that the strip won't absorb.
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
    // `$3.5`: a single `$` → no strip → `$` at position 0 is junk.
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
    // `3.5$`: a single `$` → no strip; `3.5` parses, trailing `$` is junk.
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
    // `1e3`: number match consumes `1`; `e3` is a trailing bare word.
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
    // `pi pi`: first `pi` matches, second is trailing junk (bare-word
    // trailing branch, backslash form in the message in both parsers).
    let err = parse_phase("pi pi").unwrap_err();
    match err {
        PhaseError::UnknownVariable(token) => assert_eq!(token, "pi"),
        other => panic!("expected UnknownVariable, got {other:?}"),
    }
}
