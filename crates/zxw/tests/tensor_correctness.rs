// crates/zxw/tests/tensor_correctness.rs
//
// Phase 3: property-style tensor identity tests using
// `approx::assert_relative_eq`:
//   - z_spider(2, 0) ≡ identity (up to global phase)
//   - h_box() · h_box() ≡ identity
//   - z_spider(2, π) ≡ Pauli-Z matrix
//   - w_node(2) sanity (four non-zero entries, valid density)
//   - round-trip JSON ⇄ builder (element-wise equality)