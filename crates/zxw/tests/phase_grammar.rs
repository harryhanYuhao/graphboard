// crates/zxw/tests/phase_grammar.rs
//
// Fixture-driven cross-language parser tests. The same JSON at
// `tests/fixtures/phase_grammar.json` is loaded here and by
// `src/lib/phase/parser.test.ts`, so a change to either parser without
// the other fails CI. Adding a case is a one-file edit.
//
// Each Ok case carries exactly one of:
//   - `value`      → the expected literal number
//   - `valuePi: true` → expected value is π
//   - `valuePiMul` → expected value is π × the given multiplier
// (No second expression evaluator — keeps the fixture self-describing
// and the test logic trivial.)

use approx::assert_relative_eq;
use serde::Deserialize;
use zxw::parse_phase;

const FIXTURE: &str = include_str!("fixtures/phase_grammar.json");
const PI: f64 = std::f64::consts::PI;

#[derive(Debug, Deserialize)]
struct Fixture {
    cases: Vec<Case>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Case {
    #[allow(dead_code)]
    group: String,
    #[allow(dead_code)]
    name: String,
    input: String,
    ok: bool,
    #[serde(default)]
    value: Option<f64>,
    #[serde(default)]
    value_pi: Option<bool>,
    #[serde(default)]
    value_pi_mul: Option<f64>,
    #[serde(default)]
    fragment: Option<String>,
}

impl Case {
    /// Resolve the expected numeric value for an Ok case.
    fn expected(&self) -> f64 {
        if let Some(v) = self.value {
            return v;
        }
        if self.value_pi == Some(true) {
            return PI;
        }
        if let Some(mul) = self.value_pi_mul {
            return PI * mul;
        }
        panic!(
            "Ok case '{}' has none of value/valuePi/valuePiMul",
            self.name
        );
    }
}

#[test]
fn fixture_cases_pass() {
    let fixture: Fixture =
        serde_json::from_str(FIXTURE).expect("phase_grammar.json must deserialize");
    let mut failures: Vec<String> = Vec::new();

    for case in &fixture.cases {
        let result = parse_phase(&case.input);
        let label = format!("[{}] {}", case.group, case.name);

        if case.ok {
            match result {
                Ok(v) => {
                    let expected = case.expected();
                    // Tolerate f64 rounding: phase values like π/7 have no
                    // exact representation, so relative-equality is right.
                    let abs_diff = (v - expected).abs();
                    let rel_diff = abs_diff / expected.abs().max(1.0);
                    if rel_diff > 1e-10 && abs_diff > 1e-12 {
                        failures.push(format!(
                            "{label}: expected ≈ {expected}, got {v}"
                        ));
                    }
                }
                Err(e) => failures.push(format!(
                    "{label}: expected Ok, got Err({e:?})"
                )),
            }
        } else {
            match result {
                Ok(v) => {
                    failures.push(format!("{label}: expected Err, got Ok({v})"))
                }
                Err(e) => {
                    if let Some(fragment) = &case.fragment {
                        let msg = e.to_string().to_lowercase();
                        if !msg.contains(&fragment.to_lowercase()) {
                            failures.push(format!(
                                "{label}: error '{msg}' missing fragment '{fragment}'"
                            ));
                        }
                    }
                    // No fragment = just assert that parsing failed.
                }
            }
        }
    }

    assert!(
        failures.is_empty(),
        "{} fixture case(s) failed:\n  - {}",
        failures.len(),
        failures.join("\n  - ")
    );
}

/// Direct sanity check for the most-checked identity (π in every
/// spelling), so a fixture-load regression is caught with a clear name
/// rather than buried in the table.
#[test]
fn pi_spellings_all_equal_math_pi() {
    assert_relative_eq!(parse_phase("\\pi").unwrap(), PI);
    assert_relative_eq!(parse_phase("π").unwrap(), PI);
    assert_relative_eq!(parse_phase("pi").unwrap(), PI);
    assert_relative_eq!(parse_phase("PI").unwrap(), PI);
}
