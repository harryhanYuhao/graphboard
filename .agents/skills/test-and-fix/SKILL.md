---
name: test-and-fix
description: Read a codebase, write tests that pin its real behavior, then fix any bugs those tests (or the reading) surface. Use whenever the user asks to "add tests", "write tests for", "find and fix bugs", "harden", "improve test coverage", "audit for bugs", or otherwise wants the code verified and repaired — even when they don't say the word "test" explicitly. Also use for targeted debugging once a failing case is identified.
---

# test-and-fix

Work in three phases — **read → test → fix** — and never skip ahead. A "fix"
without a failing test first is a guess; tests written without reading the
code first test a fiction.

Run the phases in order. Loop within a phase before moving on. Keep a short
todo list (TodoWrite) across phases — it's how the user follows the audit.

## Phase 1 — Read

Goal: understand the target's real behavior, contracts, and conventions before
writing anything. Skimming is the #1 cause of tests that pass for the wrong
reason.

1. **Pin the scope.** The user usually names a file, directory, or feature.
   If the ask is vague ("add tests for the project"), pick the module with the
   most logic and the least coverage, state the choice, and proceed — don't
   ask unless the choice genuinely changes the work.
2. **Read the target end to end**, including its types and its callers. A
   function's contract is defined as much by *who calls it* as by its body.
   Use Grep for call sites.
3. **Read the surrounding conventions** before writing a line of test code:
   - **Test runner + how to run it.** Detect from config, not memory:
     `package.json` (`"test"` script, `vitest`/`jest`/`mocha` deps),
     `pyproject.toml`/`pytest.ini`, `Cargo.toml`, `go.mod`, `Makefile`. Run
     the exact command the project uses.
     - This repo: `pnpm test` (vitest, jsdom), `cargo test -p zxw`.
   - **Test location + naming.** Colocated `foo.test.ts` vs `test/` vs
     `__tests__/`. Match existing neighbors exactly.
   - **Shared fixtures / factories.** Look in `test-utils/`, `tests/helpers/`,
     `conftest.py`, `setupTests.*`. **Always prefer repo factories over
     constructing objects inline** — a future type change should break the
     factory, not every test.
   - **Assertions/mocking style.** `expect` vs `assert` vs `should`; how the
     project mocks (e.g. `vi.mock`, `jest.mock`). Follow the house style.
4. **Note edge cases and smells while reading** — off-by-ones, unchecked
   null/undefined, swallowed errors, mutation of shared state, missing branch
   coverage, float comparisons without epsilon. These become test cases in
   Phase 2 and possible fixes in Phase 3. Don't fix anything yet.

**Phase 1 exit criteria:** you can state, in 1–2 sentences each, what the
target *does*, what its *invariants* are, and what *runner/command/location*
you'll use for tests. If you can't, keep reading.

## Phase 2 — Test

Goal: pin existing behavior and probe the edge cases noted in Phase 1. Every
test added here should either (a) pass against current code and lock in a
contract, or (b) fail and become a Phase 3 bug.

1. **Write one behavior per test.** Name tests for the *behavior*, not the
   function: `contracts an edge between two z-spiders` beats `test1`.
2. **Cover the documented behavior first** (happy path + main branches), then
   the edge cases from Phase 1. Edge cases are where bugs live — prioritize:
   - boundary / off-by-one (empty, single, max, ±1)
   - null / undefined / missing fields / wrong types
   - error paths and swallowed exceptions (assert they actually throw)
   - mutation of inputs or shared state
   - float / numeric precision (use the project's epsilon/approx helper)
3. **Run the suite after each batch**, not once at the end. The first failing
   test is the transition into Phase 3.
4. **Keep tests deterministic.** No real timers, no real network, no relying
   on `Date.now()` unless frozen. Seed any randomness.
5. **Don't mock the thing under test.** Mock its *dependencies*, test the unit
   itself against real inputs/outputs.
6. **If the project has a coverage target** (`.coveragerc`, `vitest.config`
   `coverage`), run it and let it pick the next gap.

**Phase 2 exit criteria:** the suite is green for everything that *should*
work, and red tests are listed as candidate bugs.

## Phase 3 — Fix

Goal: turn every red test green, with the *minimum* change that does so, and
without breaking any green test.

1. **One bug at a time.** Write the fix, run the failing test, confirm it goes
   green, then run the *whole* suite to catch regressions. Commit-worthy is
   one fix + its test + green suite.
2. **Fix the root cause, not the symptom.** If a fix feels like a patch over
   the real issue, re-read the caller (Phase 1 muscle) — the bug often lives
   one level up.
3. **Prefer a failing-test-first order** for *suspected* bugs (i.e. smells
   from Phase 1 you haven't reproduced yet): write the test that reproduces,
   watch it fail, *then* fix. This proves the fix does something.
4. **Don't widen the diff.** Match the surrounding code's style, naming,
   error-message voice. Don't refactor while fixing unless the fix is
   impossible without it — and if you do, call it out explicitly.
5. **Re-read before declaring done.** After the suite is green, re-read each
   changed file once. Fixes can hide follow-up bugs that only become visible
   after the first one clears.
6. **Report honestly.** Say which tests were added, which bugs were fixed
   (with `file:line`), and which suspected smells turned out *not* to be
   bugs (no fix needed — still valuable). If a fix was skipped because it was
   out of scope or risky, say so rather than silently dropping it.

## Anti-patterns

- **Fixing before testing.** Produces untestable diffs and regressions.
- **Testing what the code says instead of what the contract is.** Reads like
  a transcript of the implementation; breaks the moment the impl changes.
- **Inventing fixtures when the repo has factories.** Disconnects tests from
  type changes. Always look for shared test helpers first.
- **Snapshotting everything.** Snapshots catch *changes*, not *correctness*.
  Use them for large stable output (rendered DOM, big JSON), not for logic.
- **"It compiles / tests pass, ship it."** Green ≠ correct. Re-read changed
  files (Phase 3 step 5) before declaring done.
- **Silently dropping a suspected bug** because the fix looks hard. Surface
  it to the user instead.

## When to stop

Stop when: the targeted module has behavior-coverage of its contracts and edge
cases, all tests are green, and no suspected bug is left un-investigated. If
the user asked for a *scope* (one file/feature), resist expanding into
neighbors — finish and report, let them widen the ask.
