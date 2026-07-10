// crates/zxw/tests/contraction.rs
//
// Phase 4: end-to-end contraction tests on small graphs:
//   - single Z spider (3 legs, no edges) → shape (2,2,2), 2 non-zero entries
//   - Z–H–Z chain → matches the hand-derived H Z(α) H = X(α)
//   - Bell-state prep → matches the expected 4×1 dense column
//   - fully-contracted graph → scalar ≈ 1 (trivial) / ≈ 0 (cancelling)