// crates/zxw/tests/tensor_edge_cases.rs
//
// Edge-case probes for the `Tensor` primitive and per-vertex builders.
// Each pins ONE behavior with a hand-derived value. Panics that ARE the
// contract use `#[should_panic`. Conventions mirror tensor_correctness.rs.

use ndarray::{ArrayD, IxDyn};
use num_complex::Complex;
use std::f64::consts::{FRAC_PI_2, FRAC_PI_3, PI};
use zxw::assert_eq_cplx;
use zxw::nodes::*;
use zxw::{build_vertex_tensor, Cplx, Tensor, VertexType};

fn c(re: f64, im: f64) -> Cplx {
    Complex::new(re, im)
}

fn hadamard_matrix() -> [[Cplx; 2]; 2] {
    let i = std::f64::consts::FRAC_1_SQRT_2;
    [
        [c(i, 0.0), c(i, 0.0)],
        [c(i, 0.0), c(-i, 0.0)],
    ]
}

fn swap_matrix() -> [[Cplx; 2]; 2] {
    [
        [c(0.0, 0.0), c(1.0, 0.0)],
        [c(1.0, 0.0), c(0.0, 0.0)],
    ]
}

fn identity_matrix() -> [[Cplx; 2]; 2] {
    [
        [c(1.0, 0.0), c(0.0, 0.0)],
        [c(0.0, 0.0), c(1.0, 0.0)],
    ]
}

// =====================================================================
// Tensor primitive: contract
// =====================================================================

#[test]
#[should_panic]
fn contract_on_rank0_scalar_panics_axis_out_of_range() {
    // Rank-0 has no axes; indexing `shape()[0]` panics.
    let a = Tensor::scalar(c(3.0, 0.0));
    let b = Tensor::scalar(c(4.0, 0.0));
    let _ = a.contract(b, 0, 0);
}

#[test]
#[should_panic]
fn trace_on_rank0_scalar_panics_axis_out_of_range() {
    // Rank-0 has no axes to trace.
    let t = Tensor::scalar(c(3.0, 0.0));
    let _ = t.trace(0, 0);
}

// =====================================================================
// Tensor primitive: outer_product
// =====================================================================

#[test]
fn outer_product_of_two_scalars_is_their_product() {
    // scalar(c) ⊗ scalar(d) → scalar(c·d). The empty-graph reduction
    // identity relies on this rank-0 path.
    let a = Tensor::scalar(c(3.0, 0.0));
    let b = Tensor::scalar(c(4.0, 0.0));
    let r = a.outer_product(b);
    assert_eq!(r.rank(), 0);
    assert_eq!(r.shape(), &[] as &[usize]);
    assert_eq_cplx!(c(12.0, 0.0), r.get(&[]));
}

#[test]
fn outer_product_left_scalar_one_is_identity() {
    // scalar(1) ⊗ t == t (left identity).
    let one = Tensor::scalar(c(1.0, 0.0));
    let t = Tensor::from_array(
        ndarray::arr2(&[[c(1.0, 0.0), c(2.0, 0.0)], [c(3.0, 0.0), c(4.0, 0.0)]]).into_dyn(),
    );
    let r = one.outer_product(t);
    assert_eq!(r.shape(), &[2, 2]);
    assert_eq_cplx!(c(1.0, 0.0), r.get(&[0, 0]));
    assert_eq_cplx!(c(2.0, 0.0), r.get(&[0, 1]));
    assert_eq_cplx!(c(3.0, 0.0), r.get(&[1, 0]));
    assert_eq_cplx!(c(4.0, 0.0), r.get(&[1, 1]));
}

#[test]
fn outer_product_right_scalar_one_is_identity() {
    // t ⊗ scalar(1) == t (right identity).
    let t = Tensor::from_array(
        ndarray::arr2(&[[c(1.0, 0.0), c(2.0, 0.0)], [c(3.0, 0.0), c(4.0, 0.0)]]).into_dyn(),
    );
    let one = Tensor::scalar(c(1.0, 0.0));
    let r = t.outer_product(one);
    assert_eq!(r.shape(), &[2, 2]);
    assert_eq_cplx!(c(1.0, 0.0), r.get(&[0, 0]));
    assert_eq_cplx!(c(2.0, 0.0), r.get(&[0, 1]));
    assert_eq_cplx!(c(3.0, 0.0), r.get(&[1, 0]));
    assert_eq_cplx!(c(4.0, 0.0), r.get(&[1, 1]));
}

// =====================================================================
// Tensor primitive: trace
// =====================================================================

#[test]
fn trace_of_non_symmetric_rank2_is_diagonal_sum() {
    // trace([[1,2],[3,4]]) over (0,1) = 1+4 = 5. Non-symmetric values
    // catch an off-diagonal-leak bug.
    let t = Tensor::from_array(
        ndarray::arr2(&[[c(1.0, 0.0), c(2.0, 0.0)], [c(3.0, 0.0), c(4.0, 0.0)]]).into_dyn(),
    );
    let r = t.trace(0, 1);
    assert_eq!(r.rank(), 0);
    assert_eq!(r.shape(), &[] as &[usize]);
    assert_eq_cplx!(c(5.0, 0.0), r.get(&[]));
}

#[test]
#[should_panic]
fn trace_of_rank1_with_same_axis_twice_panics() {
    // trace(t, 0, 0) on a length-2 vector: perm `[0,0]` isn't a valid
    // permutation, so `permuted_axes` rejects it. Tracing an axis against
    // itself is undefined.
    let t = Tensor::from_array(ndarray::arr1(&[c(5.0, 0.0), c(7.0, 0.0)]).into_dyn());
    let _ = t.trace(0, 0);
}

#[test]
fn trace_adjacent_and_non_adjacent_axes_give_same_result() {
    // Rank-4 "all-equal diagonal" tensor T[i,j,k,l] = v iff all four
    // indices match. Tracing adjacent (0,1) and non-adjacent (0,3) both
    // reduce to v·I_2 — confirms the permute-to-last-two path handles
    // both axis-pair shapes identically.
    let v = c(2.0, 0.0);
    let mut buf = vec![c(0.0, 0.0); 16];
    for i in 0..2 {
        for j in 0..2 {
            for k in 0..2 {
                for l in 0..2 {
                    if i == j && j == k && k == l {
                        buf[i * 8 + j * 4 + k * 2 + l] = v;
                    }
                }
            }
        }
    }
    let t = Tensor::from_array(
        ArrayD::from_shape_vec(IxDyn(&[2, 2, 2, 2]), buf).unwrap(),
    );
    let eye = [[c(v.re, 0.0), c(0.0, 0.0)], [c(0.0, 0.0), c(v.re, 0.0)]];

    let r_adj = t.clone().trace(0, 1);
    assert_eq!(r_adj.shape(), &[2, 2]);
    assert_eq_cplx!(eye[0][0], r_adj.get(&[0, 0]));
    assert_eq_cplx!(eye[0][1], r_adj.get(&[0, 1]));
    assert_eq_cplx!(eye[1][0], r_adj.get(&[1, 0]));
    assert_eq_cplx!(eye[1][1], r_adj.get(&[1, 1]));

    let r_nonadj = t.trace(0, 3);
    assert_eq!(r_nonadj.shape(), &[2, 2]);
    assert_eq_cplx!(eye[0][0], r_nonadj.get(&[0, 0]));
    assert_eq_cplx!(eye[0][1], r_nonadj.get(&[0, 1]));
    assert_eq_cplx!(eye[1][0], r_nonadj.get(&[1, 0]));
    assert_eq_cplx!(eye[1][1], r_nonadj.get(&[1, 1]));
}

// =====================================================================
// Tensor primitive: permuted_axes
// =====================================================================

#[test]
fn permuted_axes_identity_perm_is_noop() {
    // Identity perm on a rank-3 tensor with distinguishable values is a no-op.
    let mut values = vec![c(0.0, 0.0); 24];
    for idx in 0..24 {
        values[idx] = c(idx as f64, 0.0);
    }
    let t = Tensor::from_array(ArrayD::from_shape_vec(IxDyn(&[2, 3, 4]), values).unwrap());
    let r = t.permuted_axes(&[0, 1, 2]);
    assert_eq!(r.shape(), &[2, 3, 4]);
    for i in 0..2 {
        for j in 0..3 {
            for k in 0..4 {
                assert_eq_cplx!(c((i * 12 + j * 4 + k) as f64, 0.0), r.get(&[i, j, k]));
            }
        }
    }
}

#[test]
#[should_panic]
fn permuted_axes_non_permutation_panics() {
    // perm [0,0] isn't a permutation (axis 0 reused) → ndarray rejects it.
    let t = Tensor::zeros(&[2, 2]);
    let _ = t.permuted_axes(&[0, 0]);
}

#[test]
#[should_panic]
fn permuted_axes_wrong_length_panics() {
    // perm of length 3 for a rank-2 tensor — wrong arity → panic.
    let t = Tensor::zeros(&[2, 2]);
    let _ = t.permuted_axes(&[0, 1, 2]);
}

// =====================================================================
// Tensor primitive: apply_2x2_to_axis
// =====================================================================

#[test]
fn apply_2x2_identity_matrix_is_noop_on_rank2() {
    // I applied to an axis leaves the tensor unchanged.
    let mut t = Tensor::from_array(
        ndarray::arr2(&[[c(1.0, 0.0), c(2.0, 0.0)], [c(3.0, 0.0), c(4.0, 0.0)]]).into_dyn(),
    );
    t.apply_2x2_to_axis(0, identity_matrix());
    assert_eq_cplx!(c(1.0, 0.0), t.get(&[0, 0]));
    assert_eq_cplx!(c(2.0, 0.0), t.get(&[0, 1]));
    assert_eq_cplx!(c(3.0, 0.0), t.get(&[1, 0]));
    assert_eq_cplx!(c(4.0, 0.0), t.get(&[1, 1]));
    // And on axis 1 too.
    t.apply_2x2_to_axis(1, identity_matrix());
    assert_eq_cplx!(c(1.0, 0.0), t.get(&[0, 0]));
    assert_eq_cplx!(c(4.0, 0.0), t.get(&[1, 1]));
}

#[test]
fn apply_2x2_hadamard_twice_recovers_original_on_rank3() {
    // H·H = I per leg: applying H to axis 1 twice recovers the original.
    // Distinguishable values expose any indexing bug.
    let mut values = vec![c(0.0, 0.0); 8];
    for idx in 0..8 {
        values[idx] = c((idx as f64) + 1.0, (idx as f64) * 0.5);
    }
    let original = Tensor::from_array(ArrayD::from_shape_vec(IxDyn(&[2, 2, 2]), values).unwrap());
    let mut t = Tensor::from_array(
        ArrayD::from_shape_vec(
            IxDyn(&[2, 2, 2]),
            (1..=8).map(|n| c(n as f64, (n - 1) as f64 * 0.5)).collect(),
        )
        .unwrap(),
    );
    let h = hadamard_matrix();
    t.apply_2x2_to_axis(1, h);
    t.apply_2x2_to_axis(1, h);
    for i in 0..2 {
        for j in 0..2 {
            for k in 0..2 {
                assert_eq_cplx!(original.get(&[i, j, k]), t.get(&[i, j, k]), 1e-10);
            }
        }
    }
}

#[test]
fn apply_2x2_on_last_axis_of_rank3() {
    // (2,2,2) with T[i,j,k] = i*4+j*2+k+1. Swap on axis 2: T'[i,j,k]=T[i,j,1-k].
    let mut values = vec![c(0.0, 0.0); 8];
    for i in 0..2 {
        for j in 0..2 {
            for k in 0..2 {
                values[i * 4 + j * 2 + k] = c((i * 4 + j * 2 + k + 1) as f64, 0.0);
            }
        }
    }
    let mut t = Tensor::from_array(ArrayD::from_shape_vec(IxDyn(&[2, 2, 2]), values).unwrap());
    t.apply_2x2_to_axis(2, swap_matrix());
    for i in 0..2 {
        for j in 0..2 {
            for k in 0..2 {
                let expected = (i * 4 + j * 2 + (1 - k) + 1) as f64;
                assert_eq_cplx!(c(expected, 0.0), t.get(&[i, j, k]));
            }
        }
    }
}

#[test]
fn apply_2x2_on_axis0_of_rank1_length2() {
    // Length-2 vector: swap on axis 0 flips the entries.
    let mut t = Tensor::from_array(ndarray::arr1(&[c(5.0, 0.0), c(7.0, 0.0)]).into_dyn());
    t.apply_2x2_to_axis(0, swap_matrix());
    assert_eq_cplx!(c(7.0, 0.0), t.get(&[0]));
    assert_eq_cplx!(c(5.0, 0.0), t.get(&[1]));
}

// =====================================================================
// Tensor primitive: get / get_mut / Display
// =====================================================================

#[test]
fn get_mut_round_trips_through_get() {
    // Set via get_mut, read back via get (including imaginary part).
    let mut t = Tensor::zeros(&[2, 3]);
    *t.get_mut(&[1, 2]) = c(4.0, 5.0);
    assert_eq_cplx!(c(4.0, 5.0), t.get(&[1, 2]));
    // Other entries stay 0.
    assert_eq_cplx!(c(0.0, 0.0), t.get(&[0, 0]));
}

#[test]
#[should_panic]
fn get_out_of_bounds_panics() {
    // t.get(&[5]) on a length-2 vector → ndarray indexing panics.
    let t = Tensor::zeros(&[2]);
    let _ = t.get(&[5]);
}

#[test]
fn display_produces_nonempty_string_with_shape() {
    // Smoke test: Display (forwarded to ndarray) emits non-empty array markup.
    let t = Tensor::from_array(
        ndarray::arr2(&[[c(1.0, 0.0), c(2.0, 0.0)], [c(3.0, 0.0), c(4.0, 0.0)]]).into_dyn(),
    );
    let s = format!("{}", t);
    assert!(!s.is_empty(), "Display output must be non-empty");
    assert!(s.contains('['), "Display output should contain array brackets");
}

// =====================================================================
// Builders: z_spider arity-0
// =====================================================================

#[test]
fn z_spider_arity0_phase0_is_scalar_two() {
    // 1 + e^{i·0} = 1 + 1 = 2.
    let t = z_spider(0, 0.0);
    assert_eq!(t.rank(), 0);
    assert_eq_cplx!(c(2.0, 0.0), t.get(&[]));
}

#[test]
fn z_spider_arity0_phase_pi_is_scalar_zero() {
    // 1 + e^{iπ} = 1 + (-1) = 0.
    let t = z_spider(0, PI);
    assert_eq_cplx!(c(0.0, 0.0), t.get(&[]));
}

#[test]
fn z_spider_arity0_phase_pi_half_is_one_plus_i() {
    // 1 + e^{iπ/2} = 1 + i.
    let t = z_spider(0, FRAC_PI_2);
    assert_eq_cplx!(c(1.0, 1.0), t.get(&[]));
}

// =====================================================================
// Builders: z_box arity-0 (two-corner; raw phase value, NOT e^{iφ})
// =====================================================================

#[test]
fn z_box_arity0_is_raw_phase_not_one_plus_phase() {
    // z_box(0, φ) = scalar φ (corners collapse to one entry). Distinct
    // from z_spider(0, φ) = 1 + e^{iφ}.
    let t_pi = z_box(0, PI);
    assert_eq_cplx!(c(PI, 0.0), t_pi.get(&[]));

    let t_zero = z_box(0, 0.0);
    assert_eq_cplx!(c(0.0, 0.0), t_zero.get(&[]));

    let t_half = z_box(0, 0.5);
    assert_eq_cplx!(c(0.5, 0.0), t_half.get(&[]));
}

// =====================================================================
// Builders: w_node / and_gate / empty arity-0
// =====================================================================

#[test]
fn w_node_zero_outputs_is_input_qubit() {
    // w_node(0 outputs): rank-1 [2]. T[0]=1 (|0⟩ vacuously maps to empty
    // output), T[1]=0. A degenerate W the contraction layer rejects
    // (≥2 outputs) but the builder constructs cleanly.
    let t = w_node(0);
    assert_eq!(t.rank(), 1);
    assert_eq!(t.shape(), &[2]);
    assert_eq_cplx!(c(1.0, 0.0), t.get(&[0]));
    assert_eq_cplx!(c(0.0, 0.0), t.get(&[1]));
}

#[test]
fn and_gate_arity0_is_scalar_one() {
    // No inputs → vacuously true → scalar 1.
    let t = and_gate(0);
    assert_eq!(t.rank(), 0);
    assert_eq_cplx!(c(1.0, 0.0), t.get(&[]));
}

// =====================================================================
// Builders: h_box (fixed arity 2)
// =====================================================================

#[test]
fn h_box_is_fixed_2x2_hadamard() {
    let h = h_box();
    assert_eq!(h.shape(), &[2, 2]);
    let inv = std::f64::consts::FRAC_1_SQRT_2;
    assert_eq_cplx!(c(inv, 0.0), h.get(&[0, 0]));
    assert_eq_cplx!(c(inv, 0.0), h.get(&[0, 1]));
    assert_eq_cplx!(c(inv, 0.0), h.get(&[1, 0]));
    assert_eq_cplx!(c(-inv, 0.0), h.get(&[1, 1]));
}

// =====================================================================
// Builders: build_vertex_tensor dispatch
// =====================================================================

#[test]
fn build_vertex_tensor_returns_none_for_boundaries() {
    assert!(build_vertex_tensor(VertexType::Input, 2, PI).is_none());
    assert!(build_vertex_tensor(VertexType::Output, 2, PI).is_none());
}

#[test]
fn build_vertex_tensor_returns_some_for_every_generator() {
    // Pin the dispatch table: every generator variant produces a tensor.
    let cases = [
        VertexType::Z,
        VertexType::X,
        VertexType::Zbox,
        VertexType::Xbox,
        VertexType::W,
        VertexType::H,
        VertexType::And,
        VertexType::Empty,
    ];
    for vt in cases {
        assert!(
            build_vertex_tensor(vt, 2, PI).is_some(),
            "dispatch for {vt:?} should return Some"
        );
    }
}

// =====================================================================
// Builders: x_spider / x_box arity-0 (no legs to Hadamard)
// =====================================================================

#[test]
fn x_spider_arity0_scalar_is_half_z_spider_arity0() {
    // No legs to Hadamard, so x_spider(0, φ) = z_spider(0, φ) · (√2)^(-2)
    // = (1 + e^{iφ}) / 2 (the standardized normalization).
    let t = x_spider(0, FRAC_PI_2);
    assert_eq!(t.rank(), 0);
    assert_eq_cplx!(c(0.5, 0.5), t.get(&[]));

    let t_pi = x_spider(0, PI);
    assert_eq!(t_pi.rank(), 0);
    assert_eq_cplx!(c(0.0, 0.0), t_pi.get(&[]));
}

#[test]
fn x_box_arity0_equals_z_box_arity0() {
    // No legs → no Hadamard → x_box(0, φ) == two_corner_box(0, φ) == φ.
    let t = x_box(0, FRAC_PI_3);
    assert_eq!(t.rank(), 0);
    assert_eq_cplx!(c(FRAC_PI_3, 0.0), t.get(&[]));
}

// =====================================================================
// Builders: arity-4 structure (z_spider, and_gate, w_node)
// =====================================================================

#[test]
fn z_spider_arity4_has_exactly_two_nonzero_entries() {
    // Shape [2,2,2,2]; only (0,0,0,0)=1 and (1,1,1,1)=e^{iφ} non-zero.
    let phi = FRAC_PI_3;
    let z = z_spider(4, phi);
    assert_eq!(z.shape(), &[2, 2, 2, 2]);
    let mut non_zero = 0;
    for bits in 0..16u32 {
        let idx: Vec<usize> = (0..4).map(|i| ((bits >> i) & 1) as usize).collect();
        let v = z.get(&idx);
        if v.norm() > 1e-9 {
            non_zero += 1;
        }
    }
    assert_eq!(non_zero, 2, "z_spider(4) should have exactly 2 non-zero entries");
    // Corner values.
    let phase_factor = c(0.0, phi).exp();
    assert_eq_cplx!(c(1.0, 0.0), z.get(&[0, 0, 0, 0]));
    assert_eq_cplx!(phase_factor, z.get(&[1, 1, 1, 1]));
}

#[test]
fn x_spider_arity3_is_not_sparse_like_z_spider() {
    // After Hadamard on each leg, x_spider is dense — more than 2 non-zero
    // entries (unlike z_spider's exactly 2).
    let x = x_spider(3, FRAC_PI_3);
    assert_eq!(x.shape(), &[2, 2, 2]);
    let mut non_zero = 0;
    for bits in 0..8u32 {
        let idx: Vec<usize> = (0..3).map(|i| ((bits >> i) & 1) as usize).collect();
        if x.get(&idx).norm() > 1e-9 {
            non_zero += 1;
        }
    }
    assert!(
        non_zero > 2,
        "x_spider(3) should have more than 2 non-zero entries, got {non_zero}"
    );
}

#[test]
fn and_gate_arity4_is_one_only_at_all_ones() {
    let a = and_gate(4);
    assert_eq!(a.shape(), &[2, 2, 2, 2]);
    assert_eq_cplx!(c(1.0, 0.0), a.get(&[1, 1, 1, 1]));
    for bits in 0..16u32 {
        let idx: Vec<usize> = (0..4).map(|i| ((bits >> i) & 1) as usize).collect();
        if idx == vec![1, 1, 1, 1] {
            continue;
        }
        assert_eq_cplx!(c(0.0, 0.0), a.get(&idx));
    }
}

#[test]
fn w_node_4_outputs_has_five_nonzero_entries() {
    // Directional W(4 outputs): shape [2;5]. Non-zero: T[0,…,0]=1 plus
    // T[1, single-hot at one output axis]=1 for each of 4 outputs → 5 total.
    let w = w_node(4);
    assert_eq!(w.shape(), &[2, 2, 2, 2, 2]);
    let mut ones = 0;
    for bits in 0..32u32 {
        let idx: Vec<usize> = (0..5).map(|i| ((bits >> i) & 1) as usize).collect();
        let v = w.get(&idx);
        // Valid non-zero patterns: all-zeros, or {input=1, exactly one
        // output axis (1..4) hot}.
        let input_bit = (bits >> 0) & 1;
        let output_bits: u32 = (bits >> 1) & 0b1111; // outputs are bits 1..4
        let is_valid = bits == 0
            || (input_bit == 1 && output_bits.count_ones() == 1);
        if is_valid {
            assert!(
                (v - c(1.0, 0.0)).norm() < 1e-9,
                "valid index {:?} should be 1, got {:?}",
                idx,
                v
            );
            ones += 1;
        } else {
            assert!(
                v.norm() < 1e-9,
                "invalid index {:?} should be 0, got {:?}",
                idx,
                v
            );
        }
    }
    assert_eq!(ones, 5, "w_node(4 outputs) should have 5 non-zero entries");
}

// =====================================================================
// Builders: consistency via trace
// =====================================================================

#[test]
fn z_spider_arity4_fully_traced_is_two() {
    // z_spider(4, 0) double-traced → 2. Pins the all-pairs reduction.
    let r = z_spider(4, 0.0).trace(0, 1).trace(0, 1);
    assert_eq!(r.rank(), 0);
    assert_eq_cplx!(c(2.0, 0.0), r.get(&[]));
}

// =====================================================================
// Tensor primitive: zeros of empty shape
// =====================================================================

#[test]
fn zeros_of_empty_shape_is_rank0_zero() {
    // Tensor::zeros(&[]) → rank-0 tensor with a single 0 entry.
    let t = Tensor::zeros(&[]);
    assert_eq!(t.rank(), 0);
    assert_eq!(t.shape(), &[] as &[usize]);
    assert_eq_cplx!(c(0.0, 0.0), t.get(&[]));
}
