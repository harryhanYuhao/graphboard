// crates/zxw/src/nodes.rs
//
// The eight per-vertex tensor builders, one per ZXW generator. Each
// takes the inputs the generator needs (arity, and a phase for the
// spider / box types) and returns a `Tensor` of shape `(2,) * arity`.
//
// Conventions are LOCKED in `doc/plans.md` §4.3 — do not change a
// normalization factor here without bumping `CURRENT_SCHEMA_VERSION`
// and updating the cross-tests in `tests/tensor_correctness.rs`:
//
//   - spiders (`z`, `x`): unnormalized copy-indices.
//     `(0,…,0) → 1`, `(1,…,1) → e^{i·phase}`, all mixed → 0.
//   - h_box: unitary `1/√2 · [[1,1],[1,-1]]`. The *only* v1 builder
//     with a normalization factor.
//   - w_node: unnormalized single-hot (one bit set → 1, no `√n`).
//   - and_gate: unnormalized indicator (all-1s → 1, else 0).
//   - z_box / x_box (v1): two-corner — `T[0,…,0] = 1`,
//     `T[1,…,1] = phase` (the raw phase VALUE, not `e^{i·phase}`),
//     every other entry → 0. Multi-phase deferred to Phase 6.
//   - empty: scalar `1`.
//
// X-basis builders (`x_spider`, `x_box`) are derived from their Z-basis
// counterparts by applying the Hadamard matrix to each leg via
// `Tensor::apply_2x2_to_axis`. This is the standard "basis change =
// one 2×2 matrix per leg" rule for rank-n tensors.

use crate::graph::VertexType;
use crate::tensor::{Cplx, Tensor};
use std::f64::consts::FRAC_1_SQRT_2; // 1/√2

/// The 2×2 Hadamard matrix as `[[row0], [row1]]`, used both to build
/// `h_box` directly and to derive X-basis tensors from Z-basis ones.
fn hadamard() -> [[Cplx; 2]; 2] {
    [
        [Cplx::new(FRAC_1_SQRT_2, 0.0), Cplx::new(FRAC_1_SQRT_2, 0.0)],
        [
            Cplx::new(FRAC_1_SQRT_2, 0.0),
            Cplx::new(-FRAC_1_SQRT_2, 0.0),
        ],
    ]
}

/// Z-spider of the given arity and phase. Shape `(2,)*arity`; the
/// all-0 entry is `1`, the all-1 entry is `e^{i·phase}`, everything
/// else `0`. Unnormalized.
pub fn z_spider(arity: usize, phase: f64) -> Tensor {
    let shape = vec![2usize; arity];
    let mut t = Tensor::zeros(&shape);
    let total = 1usize << arity; // 2^arity; 2^0 = 1 for the scalar case
    let phase_factor = Cplx::new(0.0, phase).exp(); // e^{i·phase}
    let value_one = Cplx::new(1.0, 0.0);

    // For each multi-index, the value is 1 if all bits 0, e^{iφ} if all
    // bits 1, else 0. Arity 0 (scalar) → the single entry is the sum of
    // both → 1 + e^{iφ}. (Scalar shape is `[]`, indexed by `&[]`.)
    if arity == 0 {
        *t.get_mut(&[]) = value_one + phase_factor;
    } else {
        *t.get_mut(&bits_to_index(0, arity)) = value_one;
        *t.get_mut(&bits_to_index(total - 1, arity)) = phase_factor;
    }

    t
}

/// X-spider: the Z-spider's basis-conjugate, obtained by applying the
/// Hadamard to each of the `arity` legs. Same shape and phase semantics.
pub fn x_spider(arity: usize, phase: f64) -> Tensor {
    let mut t = z_spider(arity, phase);
    let h = hadamard();
    for axis in 0..arity {
        t.apply_2x2_to_axis(axis, h);
    }
    t
}

/// H-box: the 2×2 Hadamard matrix as a rank-2 tensor. Fixed arity 2;
/// for larger circuits the user chains H-boxes.
pub fn h_box() -> Tensor {
    let h = hadamard();
    let mut t = Tensor::zeros(&[2, 2]);
    *t.get_mut(&[0, 0]) = h[0][0];
    *t.get_mut(&[0, 1]) = h[0][1];
    *t.get_mut(&[1, 0]) = h[1][0];
    *t.get_mut(&[1, 1]) = h[1][1];
    t
}

/// W-node of the given arity. Shape `(2,)*arity`; any index with
/// exactly one bit set → 1, else 0. **Unnormalized** (no `√n`).
/// Directionality is a renderer concern only; all legs are equivalent
/// for the tensor.
pub fn w_node(arity: usize) -> Tensor {
    let shape = vec![2usize; arity];
    let mut t = Tensor::zeros(&shape);
    if arity == 0 {
        // No legs → no single-hot index exists. Leave as 0. The compute
        // layer will reject this combination in Phase 4 (W needs ≥ 1
        // leg); builders don't validate, they just construct.
        return t;
    }
    let one = Cplx::new(1.0, 0.0);
    for bit in 0..arity {
        let bits = 1usize << bit;
        let idx = bits_to_index(bits, arity);
        *t.get_mut(&idx) = one;
    }
    t
}

/// AND-gate of the given arity. Shape `(2,)*arity`; the all-1 index →
/// 1, everything else → 0. Unnormalized indicator.
pub fn and_gate(arity: usize) -> Tensor {
    let shape = vec![2usize; arity];
    let mut t = Tensor::zeros(&shape);
    if arity == 0 {
        // No inputs → vacuously true → scalar 1. (Mathematical edge
        // case; renderer disallows arity-0 AND.)
        *t.get_mut(&[]) = Cplx::new(1.0, 0.0);
        return t;
    }
    let all_ones = (1usize << arity) - 1;
    let idx = bits_to_index(all_ones, arity);
    *t.get_mut(&idx) = Cplx::new(1.0, 0.0);
    t
}

/// Z-box of the given arity with a single phase value `a`. Shape
/// `(2,)*arity`. **Convention (locked):** only the two opposite corners
/// are non-zero — `T[0,…,0] = 1` and `T[1,…,1] = a` (the phase *value*,
/// **not** `e^{ia}` — this is the particularity of the box vs the
/// spider, where the spider's all-1s entry is `e^{i·phase}`). Every
/// other entry is `0`.
///
/// Multi-phase boxes (2^arity independent phase values, one per
/// diagonal corner) are Phase 6.
pub fn z_box(arity: usize, phase: f64) -> Tensor {
    two_corner_box(arity, phase)
}

/// X-box: the Z-box's basis-conjugate (Hadamard applied per leg).
pub fn x_box(arity: usize, phase: f64) -> Tensor {
    let mut t = two_corner_box(arity, phase);
    let h = hadamard();
    for axis in 0..arity {
        t.apply_2x2_to_axis(axis, h);
    }
    t
}

/// The empty node: a scalar `1`. Represents a 0-leg identity weight;
/// contributes nothing when contracted (the multiplicative identity).
pub fn empty() -> Tensor {
    Tensor::scalar(Cplx::new(1.0, 0.0))
}

/// Dispatch a `VertexType` to its builder, returning the initial tensor
/// for a vertex of that type at the given `arity` (degree) and `phase`.
/// Returns `None` for boundary types (`Input` / `Output`) — boundaries
/// have no tensor; the contraction layer treats them as tagged open
/// legs of the result instead (plan §4.3, §5.1).
///
/// `phase` is only read for spider/box types (`z`, `x`, `zbox`, `xbox`);
/// for `w`, `h`, `and`, `empty` it's ignored. H-box ignores `arity` too
/// (fixed at 2); the caller validates that the degree is 2 separately
/// and surfaces `ComputeError::HBoxArity` if not.
///
/// The builders themselves do no validation — this dispatcher only
/// routes, so all arity / degree checks belong to the caller
/// (`compute_tensor`).
pub fn build_vertex_tensor(
    vertex_type: VertexType,
    arity: usize,
    phase: f64,
) -> Option<Tensor> {
    use VertexType::*;
    match vertex_type {
        Z => Some(z_spider(arity, phase)),
        X => Some(x_spider(arity, phase)),
        Zbox => Some(z_box(arity, phase)),
        Xbox => Some(x_box(arity, phase)),
        W => Some(w_node(arity)),
        H => Some(h_box()),
        And => Some(and_gate(arity)),
        Empty => Some(empty()),
        Input | Output => None,
    }
}

// ---- internals --------------------------------------------------------------

/// Shared core of `z_box`/`x_box` before the X basis change: a rank-n
/// tensor with non-zero entries only at the two opposite corners.
///
/// `T[0,…,0] = 1` and `T[1,…,1] = a` (the phase *value*, not `e^{ia}` —
/// see `z_box` doc). Every other entry is `0`.
///
/// Name rationale: "diagonal" was the original (wrong) name — a true
/// diagonal tensor would have non-zero entries at *every*
/// all-equal-index position, not just the two endpoints. This builder
/// populates only the two corners, hence `two_corner_box`.
fn two_corner_box(arity: usize, phase: f64) -> Tensor {
    let shape = vec![2usize; arity];
    let mut t = Tensor::zeros(&shape);

    // Arity 0 → scalar. The single entry sits at the intersection of
    // both corners (0…0 and 1…1 coincide), so it picks up the phase
    // value `a` rather than 1. Matches the limit of the arity-≥1 case
    // where the two corners collapse.
    if arity == 0 {
        *t.get_mut(&[]) = Cplx::new(phase, 0.0);
        return t;
    }

    let total = 1usize << arity; // 2^arity
    let all_zeros = 0usize;
    let all_ones = total - 1;
    let phase_value = Cplx::new(phase, 0.0); // raw `a`, NOT e^{ia}

    *t.get_mut(&bits_to_index(all_zeros, arity)) = Cplx::new(1.0, 0.0);
    *t.get_mut(&bits_to_index(all_ones, arity)) = phase_value;
    // All other entries already 0 from Tensor::zeros.
    t
}

/// Convert a flat bit-pattern `bits` (with `arity` low bits significant)
/// into the multi-index `[bit0, bit1, …]`. Bit `i` is leg `i`.
///
/// input bits in binary: 110110, arity = 3
/// output [0, 1, 1] (a arity-lengh vecto with bits in reverse order)
fn bits_to_index(bits: usize, arity: usize) -> Vec<usize> {
    (0..arity).map(|i| (bits >> i) & 1).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn c(re: f64, im: f64) -> Cplx {
        Cplx::new(re, im)
    }

    #[test]
    fn build_vertex_tensor_dispatches_every_type() {
        // Every generator variant produces a tensor; boundaries return
        // None. The exact shapes are covered by each builder's own test
        // — here we only pin the dispatch table, so a future variant
        // added to `VertexType` without a match arm fails this test
        // loudly (Rust's exhaustiveness check would also catch it, but
        // the named test makes the contract readable).
        use crate::graph::VertexType::*;
        let cases: [(VertexType, Option<usize>); 10] = [
            (Z, Some(2)),      // arity-2 z_spider → shape (2,2)
            (X, Some(2)),
            (Zbox, Some(2)),
            (Xbox, Some(2)),
            (W, Some(2)),
            (H, Some(2)),      // h_box always shape (2,2) regardless of arity
            (And, Some(2)),
            (Empty, Some(0)),  // scalar → rank 0
            (Input, None),     // boundary, no tensor
            (Output, None),
        ];
        for (vt, expected_rank) in cases {
            let built = build_vertex_tensor(vt, 2, std::f64::consts::PI);
            match (built, expected_rank) {
                (Some(t), Some(r)) => {
                    assert_eq!(
                        t.rank(), r,
                        "rank mismatch for variant {vt:?}"
                    );
                }
                (None, None) => { /* boundary as expected */ }
                (got, want) => panic!(
                    "dispatch for {vt:?}: got rank {got:?}, expected rank {want:?}"
                ),
            }
        }
    }

    #[test]
    fn two_corner_box_test() {
        // z_box(3, π): only (0,0,0)=1 and (1,1,1)=π are non-zero.
        // (Was `diagonal_box_test` — renamed to match the function and
        // the actual semantics.)
        let tmp = z_box(3, std::f64::consts::PI);
        assert_eq!(tmp.shape(), &[2, 2, 2]);
        assert_eq!(tmp.get(&[0, 0, 0]), c(1.0, 0.0));
        assert_eq!(tmp.get(&[1, 1, 1]), c(std::f64::consts::PI, 0.0));
        // Every other entry must be 0.
        for i in 0..2 {
            for j in 0..2 {
                for k in 0..2 {
                    if (i, j, k) == (0, 0, 0) || (i, j, k) == (1, 1, 1) {
                        continue;
                    }
                    assert_eq!(tmp.get(&[i, j, k]), c(0.0, 0.0), "[{i},{j},{k}]");
                }
            }
        }
    }

    #[test]
    fn z_spider_arity_2_zero_phase_is_not_identity_but_diagonal() {
        // z_spider(2, 0): (0,0)→1, (1,1)→e^0=1, mixed→0. So it's the
        // projector onto |00> + |11> — *not* the 2×2 identity (the
        // identity is a property of the contracted graph, not the bare
        // spider). We assert the diagonal values explicitly.
        let t = z_spider(2, 0.0);
        assert_eq!(t.shape(), &[2, 2]);
        assert_eq!(t.get(&[0, 0]), c(1.0, 0.0));
        assert_eq!(t.get(&[1, 1]), c(1.0, 0.0));
        assert_eq!(t.get(&[0, 1]), c(0.0, 0.0));
        assert_eq!(t.get(&[1, 0]), c(0.0, 0.0));
    }

    #[test]
    fn z_spider_phase_lands_on_all_ones_entry() {
        let t = z_spider(2, std::f64::consts::PI);
        // (1,1) → e^{iπ} = -1
        assert!((t.get(&[1, 1]).re - (-1.0)).abs() < 1e-12);
        assert!(t.get(&[1, 1]).im.abs() < 1e-12);
    }

    #[test]
    fn h_box_is_unitary_hadamard() {
        let h = h_box();
        assert_eq!(h.shape(), &[2, 2]);
        let inv = FRAC_1_SQRT_2;
        assert!((h.get(&[0, 0]).re - inv).abs() < 1e-12);
        assert!((h.get(&[0, 1]).re - inv).abs() < 1e-12);
        assert!((h.get(&[1, 0]).re - inv).abs() < 1e-12);
        assert!((h.get(&[1, 1]).re - (-inv)).abs() < 1e-12);
    }

    #[test]
    fn w_node_2_is_single_hot() {
        let w = w_node(2);
        assert_eq!(w.get(&[0, 1]), c(1.0, 0.0));
        assert_eq!(w.get(&[1, 0]), c(1.0, 0.0));
        assert_eq!(w.get(&[0, 0]), c(0.0, 0.0));
        assert_eq!(w.get(&[1, 1]), c(0.0, 0.0));
    }

    #[test]
    fn and_gate_2_is_indicator() {
        let a = and_gate(2);
        assert_eq!(a.get(&[1, 1]), c(1.0, 0.0));
        assert_eq!(a.get(&[0, 0]), c(0.0, 0.0));
        assert_eq!(a.get(&[0, 1]), c(0.0, 0.0));
        assert_eq!(a.get(&[1, 0]), c(0.0, 0.0));
    }

    #[test]
    fn z_box_2_corners_carry_phase_value_not_exp() {
        // z_box(2, π): T[0,0]=1, T[1,1]=π (the raw phase VALUE, not
        // e^{iπ}=-1), every other entry 0. This is the box
        // particularity vs the spider: the spider's all-1s entry is
        // e^{iφ}; the box's is just φ.
        let t = z_box(2, std::f64::consts::PI);
        assert_eq!(t.get(&[0, 0]), c(1.0, 0.0));
        assert_eq!(t.get(&[0, 1]), c(0.0, 0.0), "off-corner must be 0");
        assert_eq!(t.get(&[1, 0]), c(0.0, 0.0), "off-corner must be 0");
        // all-1s corner carries the raw phase value π.
        assert!((t.get(&[1, 1]).re - std::f64::consts::PI).abs() < 1e-12);
        assert!(t.get(&[1, 1]).im.abs() < 1e-12);
    }

    #[test]
    fn z_box_zero_phase_is_identity_matrix() {
        // z_box(2, 0): T[0,0]=1, T[1,1]=0 (the phase value 0, not
        // e^{i0}=1). So the result is [[1,0],[0,0]] — a rank-1
        // projector onto |0>, NOT the identity matrix. This surprises
        // intuition trained on spiders (where phase 0 lands on the
        // identity), so the test pins it explicitly.
        let t = z_box(2, 0.0);
        assert_eq!(t.get(&[0, 0]), c(1.0, 0.0));
        assert_eq!(t.get(&[1, 1]), c(0.0, 0.0));
        assert_eq!(t.get(&[0, 1]), c(0.0, 0.0));
        assert_eq!(t.get(&[1, 0]), c(0.0, 0.0));
    }

    #[test]
    fn empty_is_scalar_one() {
        let e = empty();
        assert_eq!(e.rank(), 0);
        assert_eq!(e.get(&[]), c(1.0, 0.0));
    }

    // ---- arity edge cases ----------------------------------------------------

    #[test]
    fn w_node_arity_1_is_a_qubit() {
        // Arity-1 W: exactly one bit set → 1. With arity 1, the only
        // such index is [1]. So w_node(1) = [0, 1] — a |1⟩ state.
        let w = w_node(1);
        assert_eq!(w.shape(), &[2]);
        assert_eq!(w.get(&[0]), c(0.0, 0.0));
        assert_eq!(w.get(&[1]), c(1.0, 0.0));
    }

    #[test]
    fn and_gate_arity_1_is_a_qubit_one() {
        // Arity-1 AND: all-1s index → 1, else 0. With arity 1 the
        // all-1s index is [1], so and_gate(1) = [0, 1]. (AND with a
        // single input is just identity — vacuously true.)
        let a = and_gate(1);
        assert_eq!(a.shape(), &[2]);
        assert_eq!(a.get(&[0]), c(0.0, 0.0));
        assert_eq!(a.get(&[1]), c(1.0, 0.0));
    }

    #[test]
    fn z_box_arity_1_two_corners() {
        // Arity-1 z_box: only [0] and [1] are corners (they coincide
        // with the all-0 / all-1 patterns at arity 1). T[0]=1, T[1]=φ.
        let phi = 0.7;
        let z = z_box(1, phi);
        assert_eq!(z.shape(), &[2]);
        assert_eq!(z.get(&[0]), c(1.0, 0.0));
        assert_eq!(z.get(&[1]), c(phi, 0.0));
    }

    #[test]
    fn x_box_round_trips_through_z_basis_via_hadamard() {
        // x_box is *defined* as z_box with H applied to each leg.
        // Applying H again per leg must recover z_box. (Same logic as
        // x_spider_round_trips in tests/tensor_correctness.rs.)
        let phi = std::f64::consts::FRAC_PI_3;
        let mut x = x_box(2, phi);
        let h: [[Cplx; 2]; 2] = [
            [c(std::f64::consts::FRAC_1_SQRT_2, 0.0), c(std::f64::consts::FRAC_1_SQRT_2, 0.0)],
            [c(std::f64::consts::FRAC_1_SQRT_2, 0.0), c(-std::f64::consts::FRAC_1_SQRT_2, 0.0)],
        ];
        x.apply_2x2_to_axis(0, h);
        x.apply_2x2_to_axis(1, h);
        let z = z_box(2, phi);
        for i in 0..2 {
            for j in 0..2 {
                assert!(
                    (x.get(&[i, j]) - z.get(&[i, j])).norm() < 1e-10,
                    "x_box round-trip mismatch at [{i},{j}]"
                );
            }
        }
    }

    #[test]
    fn z_spider_arity_3_has_two_nonzero_entries() {
        // Direct check of z_spider at arity 3: only (0,0,0) and
        // (1,1,1) are non-zero. (Same shape as the plan's §5.3 test
        // intent — included here because the bare-aridity path through
        // compute_tensor always reduces to scalar in v1.)
        let phi = std::f64::consts::PI;
        let z = z_spider(3, phi);
        assert_eq!(z.shape(), &[2, 2, 2]);
        let mut non_zero = 0;
        for bits in 0..8 {
            let idx: Vec<usize> = (0..3).map(|i| (bits >> i) & 1).collect();
            let v = z.get(&idx);
            if v.norm() > 0.5 {
                non_zero += 1;
            }
        }
        assert_eq!(non_zero, 2, "z_spider(3) should have exactly 2 non-zero entries");
        // (0,0,0) = 1, (1,1,1) = e^{iπ} = -1.
        assert_eq!(z.get(&[0, 0, 0]), c(1.0, 0.0));
        assert!((z.get(&[1, 1, 1]).re - (-1.0)).abs() < 1e-10);
    }
}
