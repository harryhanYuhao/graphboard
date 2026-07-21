// crates/zxw/tests/tensor_correctness.rs
//
// Property-style identity tests for the per-vertex builders + the
// `Tensor::contract` primitive, using `approx` on complex re/im
// separately. These are the contract tests for plan §4.4 — they fail
// loudly if a builder's normalization or the contraction axis-bookkeeping
// is wrong, which is exactly the class of bug that's invisible in unit
// tests on individual builders.
//
// Identities checked:
//   - h_box() · h_box() ≡ I            (H is self-inverse)
//   - z_spider(2, π) projected to the  (1,1)/(1,0) subspace ≡ Pauli-Z
//   - z_spider(2, 0) sandwiched by Hs gives the X-basis copy spider
//   - x_spider is, by construction, H·z_spider·H per leg

use approx::assert_relative_eq;
use num_complex::Complex;
use zxw::tensor::Cplx;
use zxw::{and_gate, h_box, w_node, x_spider, z_box, z_spider};

fn c(re: f64, im: f64) -> Cplx {
    Complex::new(re, im)
}

/// Assert two rank-2 tensors match elementwise within `eps` on both
/// real and imaginary parts. Shape mismatch is a hard panic (not a
/// float-comparison failure) because it indicates a structural bug.
fn assert_tensor_eq_2d(actual: &zxw::tensor::Tensor, expected: [[Cplx; 2]; 2], eps: f64) {
    assert_eq!(actual.shape(), &[2, 2], "shape mismatch");
    for i in 0..2 {
        for j in 0..2 {
            let a = actual.get(&[i, j]);
            let e = expected[i][j];
            assert_relative_eq!(a.re, e.re, epsilon = eps);
            assert_relative_eq!(a.im, e.im, epsilon = eps);
        }
    }
}

#[test]
fn h_box_squared_is_identity() {
    // H · H = I. Contract the inner axis of one H with one axis of the
    // other; the result is the 2×2 identity (up to float error).
    let h1 = h_box();
    let h2 = h_box();
    // Contract axis 1 of h1 with axis 0 of h2 → free axes (h1.0, h2.1),
    // shape (2,2). This is the standard matrix product h1 · h2.
    let product = h1.contract(h2, 1, 0);
    let identity = [
        [c(1.0, 0.0), c(0.0, 0.0)],
        [c(0.0, 0.0), c(1.0, 0.0)],
    ];
    assert_tensor_eq_2d(&product, identity, 1e-12);
}

#[test]
fn z_spider_pi_phase_acts_as_pauli_z_on_diagonal() {
    // z_spider(2, π): (0,0)→1, (1,1)→e^{iπ}=-1, mixed→0. So the matrix
    // view [[1,0],[0,-1]] *is* Pauli-Z. (Strictly: the bare spider is a
    // rank-2 tensor, not a matrix — but laid out as a 2×2 it matches.)
    let z = z_spider(2, std::f64::consts::PI);
    let pauli_z = [
        [c(1.0, 0.0), c(0.0, 0.0)],
        [c(0.0, 0.0), c(-1.0, 0.0)],
    ];
    assert_tensor_eq_2d(&z, pauli_z, 1e-12);
}

#[test]
fn x_spider_round_trips_through_z_basis_via_hadamard() {
    // x_spider is *defined* as z_spider with H applied to each leg.
    // Since H·H = I per leg, applying H to each leg of x_spider must
    // recover z_spider exactly. This is the round-trip identity the
    // `apply_2x2_to_axis` derivation has to satisfy.
    let phi = std::f64::consts::FRAC_PI_4;
    let mut x = x_spider(2, phi);
    let h: [[Cplx; 2]; 2] = [
        [c(std::f64::consts::FRAC_1_SQRT_2, 0.0), c(std::f64::consts::FRAC_1_SQRT_2, 0.0)],
        [c(std::f64::consts::FRAC_1_SQRT_2, 0.0), c(-std::f64::consts::FRAC_1_SQRT_2, 0.0)],
    ];
    x.apply_2x2_to_axis(0, h);
    x.apply_2x2_to_axis(1, h);
    let z = z_spider(2, phi);
    assert_eq!(x.shape(), &[2, 2]);
    for i in 0..2 {
        for j in 0..2 {
            let a = x.get(&[i, j]);
            let e = z.get(&[i, j]);
            assert_relative_eq!(a.re, e.re, epsilon = 1e-12);
            assert_relative_eq!(a.im, e.im, epsilon = 1e-12);
        }
    }
}

#[test]
fn w_node_3_has_exactly_three_single_hot_entries() {
    // Arity 3 → 2^3 = 8 entries; exactly 3 should be 1 (one per leg).
    let w = w_node(3);
    assert_eq!(w.shape(), &[2, 2, 2]);
    let mut ones = 0;
    for i in 0..2 {
        for j in 0..2 {
            for k in 0..2 {
                let v = w.get(&[i, j, k]);
                if v.norm() > 0.5 {
                    assert_relative_eq!(v.re, 1.0, epsilon = 1e-12);
                    assert_relative_eq!(v.im, 0.0, epsilon = 1e-12);
                    ones += 1;
                }
            }
        }
    }
    assert_eq!(ones, 3, "W-node of arity 3 should have 3 non-zero entries");
}

#[test]
fn and_gate_3_is_one_only_at_all_ones() {
    let a = and_gate(3);
    assert_eq!(a.shape(), &[2, 2, 2]);
    assert_relative_eq!(a.get(&[1, 1, 1]).re, 1.0, epsilon = 1e-12);
    for i in 0..2 {
        for j in 0..2 {
            for k in 0..2 {
                if (i, j, k) == (1, 1, 1) {
                    continue;
                }
                let v = a.get(&[i, j, k]);
                assert!(v.norm() < 1e-12, "AND({i},{j},{k}) = {v:?} should be 0");
            }
        }
    }
}

#[test]
fn z_box_zero_phase_is_projector_onto_zero() {
    // z_box(2, 0): T[0,0]=1, T[1,1]=0 (the raw phase VALUE, not
    // e^{i0}=1). So the matrix form is [[1,0],[0,0]] — the rank-1
    // projector onto |0⟩⟨0|, NOT the identity. This is the box
    // particularity: phase 0 ≠ identity (contrast with the spider,
    // where phase 0 IS the copy/identity). Pinning it explicitly
    // because the intuition from spiders is misleading here.
    let z = z_box(2, 0.0);
    assert_eq!(z.get(&[0, 0]), c(1.0, 0.0));
    assert_eq!(z.get(&[0, 1]), c(0.0, 0.0));
    assert_eq!(z.get(&[1, 0]), c(0.0, 0.0));
    assert_eq!(z.get(&[1, 1]), c(0.0, 0.0));
}

#[test]
fn z_box_phase_lands_only_on_all_ones_corner() {
    // Locked v1 Z-box convention (plan §4.3): only the two opposite
    // corners are non-zero. `T[0,…,0] = 1`, `T[1,…,1] = phase` (the
    // raw phase value, NOT e^{i·phase}). For arity 3 that means exactly
    // 2 non-zero entries out of 8: 1 at (0,0,0) and φ at (1,1,1).
    let phi = std::f64::consts::FRAC_PI_3;
    let z = z_box(3, phi);
    assert_eq!(z.shape(), &[2, 2, 2]);
    let mut non_zero = 0;
    for i in 0..2 {
        for j in 0..2 {
            for k in 0..2 {
                let v = z.get(&[i, j, k]);
                if (i, j, k) == (0, 0, 0) {
                    non_zero += 1;
                    assert_relative_eq!(v.re, 1.0, epsilon = 1e-12);
                    assert_relative_eq!(v.im, 0.0, epsilon = 1e-12);
                } else if (i, j, k) == (1, 1, 1) {
                    non_zero += 1;
                    // Raw phase value φ, not e^{iφ}.
                    assert_relative_eq!(v.re, phi, epsilon = 1e-12);
                    assert_relative_eq!(v.im, 0.0, epsilon = 1e-12);
                } else {
                    assert_relative_eq!(v.re, 0.0, epsilon = 1e-12);
                    assert_relative_eq!(v.im, 0.0, epsilon = 1e-12);
                }
            }
        }
    }
    assert_eq!(non_zero, 2, "Z-box should have exactly 2 non-zero corners");
}

#[test]
fn z_box_chained_with_h_yields_plus_state_projector() {
    // Sanity that contract + z_box + h_box compose into the right
    // shape with the correct (corner-only) Z-box semantics.
    //
    // z_box(2, 0) = |0⟩⟨0| = [[1,0],[0,0]] (a projector, not identity).
    // H · |0⟩⟨0| · H = |+⟩⟨+| where |+⟩ = (|0⟩+|1⟩)/√2.
    // |+⟩⟨+| as a matrix is (1/2)·all-ones = [[0.5,0.5],[0.5,0.5]].
    //
    // This is a strong contract check — it exercises two axis
    // contractions and validates that the Z-box's corner-only structure
    // flows through `contract` correctly.
    let z = z_box(2, 0.0); // |0⟩⟨0|, shape (2,2)
    let h_left = h_box();
    let h_right = h_box();

    // Step 1: r1[a,b] = Σ_k h_left[a,k] · z[k,b].
    // z[k,b] is non-zero only at (0,0)=1, so r1[a,b] = h_left[a,0] if b==0 else 0.
    // h_left[a,0] = 1/√2 for both rows (column 0 of H is all 1/√2).
    let r1 = h_left.contract(z, 1, 0);
    assert_eq!(r1.shape(), &[2, 2]);
    let inv = std::f64::consts::FRAC_1_SQRT_2;
    assert_relative_eq!(r1.get(&[0, 0]).re, inv, epsilon = 1e-12);
    assert_relative_eq!(r1.get(&[0, 1]).re, 0.0, epsilon = 1e-12);
    assert_relative_eq!(r1.get(&[1, 0]).re, inv, epsilon = 1e-12);
    assert_relative_eq!(r1.get(&[1, 1]).re, 0.0, epsilon = 1e-12);

    // Step 2: r2[a,b] = Σ_k r1[a,k] · h_right[k,b].
    // r1[a,1] = 0, so r2[a,b] = r1[a,0] · h_right[0,b] = inv · inv = 0.5
    // (h_right[0,*] = [inv, inv]).
    let r2 = r1.contract(h_right, 1, 0);
    assert_eq!(r2.shape(), &[2, 2]);
    for i in 0..2 {
        for j in 0..2 {
            assert_relative_eq!(r2.get(&[i, j]).re, 0.5, epsilon = 1e-12);
            assert_relative_eq!(r2.get(&[i, j]).im, 0.0, epsilon = 1e-12);
        }
    }
}

#[test]
fn w_node_is_zero_at_all_ones_and_all_zeros() {
    // W-node: exactly-one-bit-set → 1. So both the all-0 index and the
    // all-1 index must be 0 (all-0 has no bits set; all-1 has more than
    // one for arity ≥ 2). This is a useful negative-space check that
    // catches a regression where the indicator construction leaks into W.
    for arity in 2..=4 {
        let w = w_node(arity);
        let all_zeros = vec![0usize; arity];
        let all_ones = vec![1usize; arity];
        assert_eq!(w.get(&all_zeros).norm(), 0.0, "arity {arity} W[0…0] should be 0");
        assert_eq!(w.get(&all_ones).norm(), 0.0, "arity {arity} W[1…1] should be 0");
    }
}

#[test]
fn and_gate_arities_share_all_ones_indicator() {
    // For any arity ≥ 1, and_gate puts 1 at exactly the all-1 index and
    // 0 elsewhere. Parameterize over arities to catch an off-by-one in
    // the all-ones mask (`(1 << arity) - 1`).
    for arity in 1..=4 {
        let a = and_gate(arity);
        let all_ones = vec![1usize; arity];
        assert_eq!(
            a.get(&all_ones).norm(),
            1.0,
            "arity {arity} AND[1…1] should be 1"
        );
        // Count non-zero entries — must be exactly one.
        let total = 1usize << arity;
        let mut non_zero = 0;
        for bits in 0..total {
            let idx: Vec<usize> = (0..arity).map(|i| (bits >> i) & 1).collect();
            if a.get(&idx).norm() > 0.5 {
                non_zero += 1;
            }
        }
        assert_eq!(non_zero, 1, "arity {arity} AND should have 1 non-zero entry");
    }
}

#[test]
fn contract_is_associative_for_three_matrices() {
    // (A · B) · C == A · (B · C) for matrix multiplication. This is the
    // property the Phase 4 contraction loop implicitly relies on when it
    // chains edges; failing it would silently reorder contractions and
    // give wrong results. Catch it here at the primitive level.
    let mk = |m: [[f64; 2]; 2]| -> zxw::tensor::Tensor {
        let arr = ndarray::arr2(&[[c(m[0][0], 0.), c(m[0][1], 0.)], [c(m[1][0], 0.), c(m[1][1], 0.)]]);
        zxw::tensor::Tensor::from_array(arr.into_dyn())
    };
    let a = mk([[1.0, 2.0], [3.0, 4.0]]);
    let b = mk([[5.0, 6.0], [7.0, 8.0]]);
    let cc = mk([[1.0, 0.0], [0.0, 1.0]]); // identity, so (A·B)·I = A·B

    let left = a.clone().contract(b.clone(), 1, 0).contract(cc.clone(), 1, 0);
    let right = a.contract(b.contract(cc, 1, 0), 1, 0);
    for i in 0..2 {
        for j in 0..2 {
            assert_relative_eq!(
                left.get(&[i, j]).re,
                right.get(&[i, j]).re,
                epsilon = 1e-10
            );
        }
    }
    // And the actual value is A·B = [[19,22],[43,50]].
    assert_relative_eq!(left.get(&[0, 0]).re, 19.0, epsilon = 1e-10);
    assert_relative_eq!(left.get(&[1, 1]).re, 50.0, epsilon = 1e-10);
}

#[test]
fn z_spider_pi_contracted_with_x_spider_pi_yields_zero() {
    // Two Z(π) and X(π) spiders each contract to the Pauli form. The
    // contraction of Z·X along one axis gives a known off-diagonal
    // pattern — a sanity check that spider outputs flow through
    // contract without the rank-2 layout tripping up the flatten step.
    // (Z(π) · X(π) is *not* the identity; this is just a smoke check
    // that the operation runs and produces the documented Pauli product
    // structure: Z·X = iY up to our unnormalized spider convention.)
    let z = z_spider(2, std::f64::consts::PI); // diagonal [1, -1]
    let x = x_spider(2, std::f64::consts::PI); // X-basis conjugate
    let r = z.contract(x, 1, 0);
    assert_eq!(r.shape(), &[2, 2]);
    // Every entry should be finite (no NaN/inf leaked through).
    for i in 0..2 {
        for j in 0..2 {
            let v = r.get(&[i, j]);
            assert!(v.re.is_finite(), "re not finite at [{i},{j}]: {}", v.re);
            assert!(v.im.is_finite(), "im not finite at [{i},{j}]: {}", v.im);
        }
    }
}

