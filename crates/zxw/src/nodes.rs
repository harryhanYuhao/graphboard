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
//   - z_box / x_box (v1): single-phase diagonal — all-1s index →
//     `e^{i·phase}`, all others → 1. Multi-phase deferred to Phase 6.
//   - empty: scalar `1`.
//
// X-basis builders (`x_spider`, `x_box`) are derived from their Z-basis
// counterparts by applying the Hadamard matrix to each leg via
// `Tensor::apply_2x2_to_axis`. This is the standard "basis change =
// one 2×2 matrix per leg" rule for rank-n tensors.

use crate::tensor::{Cplx, Tensor};

const SQRT2_INV: f64 = std::f64::consts::FRAC_1_SQRT_2; // 1/√2

/// The 2×2 Hadamard matrix as `[[row0], [row1]]`, used both to build
/// `h_box` directly and to derive X-basis tensors from Z-basis ones.
fn hadamard() -> [[Cplx; 2]; 2] {
    [
        [Cplx::new(SQRT2_INV, 0.0), Cplx::new(SQRT2_INV, 0.0)],
        [Cplx::new(SQRT2_INV, 0.0), Cplx::new(-SQRT2_INV, 0.0)],
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

    // For each multi-index, the value is 1 if all bits 0, e^{iφ} if all
    // bits 1, else 0. Arity 0 (scalar) → the single entry is the sum of
    // both → 1 + e^{iφ}; but arity-0 spiders don't appear in practice
    // (no legs means no connections). Keep the formula honest anyway.
    for bits in 0..total {
        let idx = bits_to_index(bits, arity);
        let ones = bits.count_ones() as usize;
        let val = if ones == 0 {
            Cplx::new(1.0, 0.0)
        } else if ones == arity {
            phase_factor
        } else {
            Cplx::new(0.0, 0.0)
        };
        *t.get_mut(&idx) = val;
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

/// Z-box of the given arity, single-phase diagonal (v1). Shape
/// `(2,)*arity`; the all-1 index → `e^{i·phase}`, every other index →
/// `1`. Multi-phase boxes (2^arity independent phases) are Phase 6.
pub fn z_box(arity: usize, phase: f64) -> Tensor {
    diagonal_box(arity, phase)
}

/// X-box: the Z-box's basis-conjugate (Hadamard applied per leg).
pub fn x_box(arity: usize, phase: f64) -> Tensor {
    let mut t = diagonal_box(arity, phase);
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

/// Shared core of `z_box`/`x_box` before the X basis change: diagonal
/// tensor, all-1s → `e^{i·phase}`, else 1.
fn diagonal_box(arity: usize, phase: f64) -> Tensor {
    let shape = vec![2usize; arity];
    let mut t = Tensor::zeros(&shape);
    let total = 1usize << arity;
    let phase_factor = Cplx::new(0.0, phase).exp();
    let one = Cplx::new(1.0, 0.0);
    let all_ones = if arity == 0 { 0 } else { total - 1 };

    for bits in 0..total {
        let idx = bits_to_index(bits, arity);
        *t.get_mut(&idx) = if bits == all_ones { phase_factor } else { one };
    }
    t
}

/// Convert a flat bit-pattern `bits` (with `arity` low bits significant)
/// into the multi-index `[bit0, bit1, …]`. Bit `i` is leg `i`.
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
        let inv = SQRT2_INV;
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
    fn z_box_2_puts_phase_on_all_ones_else_one() {
        let t = z_box(2, std::f64::consts::PI);
        assert_eq!(t.get(&[0, 0]), c(1.0, 0.0));
        assert_eq!(t.get(&[0, 1]), c(1.0, 0.0));
        assert_eq!(t.get(&[1, 0]), c(1.0, 0.0));
        // all-ones → e^{iπ} = -1
        assert!((t.get(&[1, 1]).re - (-1.0)).abs() < 1e-12);
    }

    #[test]
    fn empty_is_scalar_one() {
        let e = empty();
        assert_eq!(e.rank(), 0);
        assert_eq!(e.get(&[]), c(1.0, 0.0));
    }
}
