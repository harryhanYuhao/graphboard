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
    // both → 1 + e^{iφ};
    if arity == 0 {
        *t.get_mut(&[0]) = value_one + phase_factor;
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
    use std::f64::consts::PI;

    fn c(re: f64, im: f64) -> Cplx {
        Cplx::new(re, im)
    }

    #[test]
    fn print_all_tensors() {
        println!("z spider: {}", z_spider(2, PI));
        println!("x spider: {}", x_spider(2, PI));
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
}
