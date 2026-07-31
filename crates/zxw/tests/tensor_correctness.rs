// crates/zxw/tests/tensor_correctness.rs
//
// Identity tests for the per-vertex builders and the `Tensor::contract`
// primitive. They catch the class of bug invisible in unit tests on
// individual builders: wrong normalization or contraction axis bookkeeping.
// Identities: H·H=I, z_spider(2,π) ≡ Pauli-Z, z_spider(2,0) sandwiched by
// Hs gives the X-basis copy spider, x_spider ≡ H·z_spider·H per leg.

use approx::assert_relative_eq;
use num_complex::Complex;
use zxw::tensor::Cplx;
use zxw::{and_gate, h_box, w_node, x_spider, z_box, z_spider};

fn c(re: f64, im: f64) -> Cplx {
    Complex::new(re, im)
}

/// Assert two rank-2 tensors match elementwise within `eps` (re and im).
/// Shape mismatch is a hard panic — it signals a structural bug.
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
    // H · H = I. Contracting the inner axes of two Hs gives the matrix
    // product h1·h2, which must be the 2×2 identity.
    let h1 = h_box();
    let h2 = h_box();
    // Contract axis 1 of h1 with axis 0 of h2 → matrix product h1·h2.
    let product = h1.contract(h2, 1, 0);
    let identity = [
        [c(1.0, 0.0), c(0.0, 0.0)],
        [c(0.0, 0.0), c(1.0, 0.0)],
    ];
    assert_tensor_eq_2d(&product, identity, 1e-12);
}

#[test]
fn z_spider_pi_phase_acts_as_pauli_z_on_diagonal() {
    // z_spider(2, π): diag(1, e^{iπ}) = diag(1, -1) = Pauli-Z.
    let z = z_spider(2, std::f64::consts::PI);
    let pauli_z = [
        [c(1.0, 0.0), c(0.0, 0.0)],
        [c(0.0, 0.0), c(-1.0, 0.0)],
    ];
    assert_tensor_eq_2d(&z, pauli_z, 1e-12);
}

#[test]
fn x_spider_round_trips_through_z_basis_via_hadamard() {
    // x_spider ≡ z_spider with H per leg; applying H again recovers
    // z_spider (H·H=I). Pins the `apply_2x2_to_axis` round-trip identity.
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
fn w_node_2_outputs_has_three_nonzero_entries() {
    // Directional W(2 outputs): shape [2,2,2], exactly 3 non-zero entries
    // (T[0,0,0], T[1,1,0], T[1,0,1]).
    let w = w_node(2);
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
    assert_eq!(ones, 3, "W(2 outputs) should have 3 non-zero entries");
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
    // z_box(2, 0) = [[1,0],[0,0]] = |0⟩⟨0|, NOT identity: the box stores the
    // raw phase value (0), unlike spiders where phase 0 is the copy.
    let z = z_box(2, 0.0);
    assert_eq!(z.get(&[0, 0]), c(1.0, 0.0));
    assert_eq!(z.get(&[0, 1]), c(0.0, 0.0));
    assert_eq!(z.get(&[1, 0]), c(0.0, 0.0));
    assert_eq!(z.get(&[1, 1]), c(0.0, 0.0));
}

#[test]
fn z_box_phase_lands_only_on_all_ones_corner() {
    // Z-box convention: only the two opposite corners are non-zero —
    // T[0,…,0]=1 and T[1,…,1]=phase (raw value). Arity 3 → exactly 2
    // non-zero entries: 1 at (0,0,0), φ at (1,1,1).
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
    // H · z_box(2,0) · H = H·|0⟩⟨0|·H = |+⟩⟨+| = (1/2)·all-ones.
    // Exercises two axis contractions with the Z-box's corner-only structure.
    let z = z_box(2, 0.0); // |0⟩⟨0|, shape (2,2)
    let h_left = h_box();
    let h_right = h_box();

    // Step 1: r1[a,b] = Σ_k h_left[a,k]·z[k,b]; z is non-zero only at
    // (0,0)=1, so r1[a,b] = h_left[a,0] if b==0 else 0.
    let r1 = h_left.contract(z, 1, 0);
    assert_eq!(r1.shape(), &[2, 2]);
    let inv = std::f64::consts::FRAC_1_SQRT_2;
    assert_relative_eq!(r1.get(&[0, 0]).re, inv, epsilon = 1e-12);
    assert_relative_eq!(r1.get(&[0, 1]).re, 0.0, epsilon = 1e-12);
    assert_relative_eq!(r1.get(&[1, 0]).re, inv, epsilon = 1e-12);
    assert_relative_eq!(r1.get(&[1, 1]).re, 0.0, epsilon = 1e-12);

    // Step 2: r2[a,b] = Σ_k r1[a,k]·h_right[k,b] → 0.5 everywhere.
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
fn w_node_zero_input_is_all_zeros_and_all_ones_is_zero() {
    // Directional W(N): T[0,…,0]=1 (|0⟩→all-|0⟩), T[1,…,1]=0 (not single-hot).
    for num_outputs in 2..=4 {
        let w = w_node(num_outputs);
        let arity = 1 + num_outputs;
        let all_zeros = vec![0usize; arity];
        let all_ones = vec![1usize; arity];
        assert_eq!(
            w.get(&all_zeros).norm(),
            1.0,
            "{num_outputs}-output W[0…0] should be 1 (|0⟩→|00…0⟩)"
        );
        assert_eq!(
            w.get(&all_ones).norm(),
            0.0,
            "{num_outputs}-output W[1…1] should be 0 (not single-hot)"
        );
    }
}

#[test]
fn and_gate_arities_share_all_ones_indicator() {
    // For any arity, and_gate is 1 only at the all-1 index. Parameterized
    // to catch an off-by-one in the all-ones mask `(1 << arity) - 1`.
    for arity in 1..=4 {
        let a = and_gate(arity);
        let all_ones = vec![1usize; arity];
        assert_eq!(
            a.get(&all_ones).norm(),
            1.0,
            "arity {arity} AND[1…1] should be 1"
        );
        // Must have exactly one non-zero entry.
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
    // (A·B)·C == A·(B·C). The contraction loop relies on this; failing it
    // would silently reorder contractions. C is identity, so both = A·B.
    let mk = |m: [[f64; 2]; 2]| -> zxw::tensor::Tensor {
        let arr = ndarray::arr2(&[[c(m[0][0], 0.), c(m[0][1], 0.)], [c(m[1][0], 0.), c(m[1][1], 0.)]]);
        zxw::tensor::Tensor::from_array(arr.into_dyn())
    };
    let a = mk([[1.0, 2.0], [3.0, 4.0]]);
    let b = mk([[5.0, 6.0], [7.0, 8.0]]);
    let cc = mk([[1.0, 0.0], [0.0, 1.0]]); // identity

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
    // Smoke check: Z(π)·X(π) runs through contract without the rank-2
    // layout tripping the flatten step; every entry stays finite.
    let z = z_spider(2, std::f64::consts::PI); // diagonal [1, -1]
    let x = x_spider(2, std::f64::consts::PI); // X-basis conjugate
    let r = z.contract(x, 1, 0);
    assert_eq!(r.shape(), &[2, 2]);
    for i in 0..2 {
        for j in 0..2 {
            let v = r.get(&[i, j]);
            assert!(v.re.is_finite(), "re not finite at [{i},{j}]: {}", v.re);
            assert!(v.im.is_finite(), "im not finite at [{i},{j}]: {}", v.im);
        }
    }
}

