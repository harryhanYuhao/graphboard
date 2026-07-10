// crates/zxw/tests/phase_grammar.rs
//
// Phase 3: cross-language parser tests. Both `phase_grammar.rs` and
// `src/lib/phase/parser.test.ts` load the shared fixture at
// `tests/fixtures/phase_grammar.json` and assert equality — that way a
// change to one parser without the other fails CI.
//
// The fixture is built by lifting the 52 cases from the current
// `parser.test.ts` into JSON.