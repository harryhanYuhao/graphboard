// crates/zxw/src/nodes.rs
//
// Per-vertex tensor builders, one per ZXW generator. Each returns a
// `Tensor` of shape `(2,) * arity`. Conventions are locked in
// `doc/plans.md` §4.3 — changing a normalization factor requires bumping
// `CURRENT_SCHEMA_VERSION` and updating `tests/tensor_correctness.rs`.
//
//   - spiders (`z`, `x`): `(0,…,0) → 1`, `(1,…,1) → e^{i·phase}`, mixed → 0. Unnormalized.
//   - h_box: unitary `1/√2 · [[1,1],[1,-1]]`.
//   - x_spider: z_spider conjugated per leg by H, times `(√2)^(arity-2)`
//     (standardized normalization; arity 2 is unchanged, arity 0 → half).
//   - w_node: directional — axis 0 = input, axes 1..N = outputs. `|0⟩ → |00…0⟩`,
//     `|1⟩ → single-hot superposition over outputs`. Unnormalized.
//   - and_gate: unnormalized indicator (all-1s → 1, else 0).
//   - z_box / x_box (v1): two-corner — `T[0,…,0] = 1`, `T[1,…,1] = phase`
//     (the raw phase VALUE, not `e^{i·phase}`), else 0. Multi-phase deferred to Phase 6.
//   - empty: scalar `1` when isolated (0 legs); the 2×2 identity when wired
//     with 2 legs (see `build_vertex_tensor`).
//
// X-basis builders (`x_spider`, `x_box`) derive from their Z-basis
// counterparts by applying the Hadamard to each leg.

use crate::graph::VertexType;
use crate::tensor::{Cplx, Tensor};
use std::f64::consts::FRAC_1_SQRT_2; // 1/√2
use std::f64::consts::SQRT_2;

/// The 2×2 Hadamard matrix; used to build `h_box` and to derive X-basis tensors from Z-basis ones.
fn hadamard() -> [[Cplx; 2]; 2] {
    [
        [Cplx::new(FRAC_1_SQRT_2, 0.0), Cplx::new(FRAC_1_SQRT_2, 0.0)],
        [
            Cplx::new(FRAC_1_SQRT_2, 0.0),
            Cplx::new(-FRAC_1_SQRT_2, 0.0),
        ],
    ]
}

/// Z-spider of given arity and phase. `(0,…,0) → 1`, `(1,…,1) → e^{i·phase}`, else 0. Unnormalized.
pub fn z_spider(arity: usize, phase: f64) -> Tensor {
    let shape = vec![2usize; arity];
    let mut t = Tensor::zeros(&shape);
    let total = 1usize << arity; // 2^arity; 2^0 = 1 for the scalar case
    let phase_factor = Cplx::new(0.0, phase).exp(); // e^{i·phase}
    let value_one = Cplx::new(1.0, 0.0);

    // Arity 0 (scalar): single entry is the sum 1 + e^{iφ}.
    if arity == 0 {
        *t.get_mut(&[]) = value_one + phase_factor;
    } else {
        *t.get_mut(&bits_to_index(0, arity)) = value_one;
        *t.get_mut(&bits_to_index(total - 1, arity)) = phase_factor;
    }

    t
}

/// X-spider: the Z-spider with the Hadamard applied to each leg. Same shape and phase semantics.
pub fn x_spider(arity: usize, phase: f64) -> Tensor {
    let mut t = z_spider(arity, phase);
    let h = hadamard();
    for axis in 0..arity {
        t.apply_2x2_to_axis(axis, h);
    }
    t = t * Cplx::new(SQRT_2, 0.0).powi(arity as i32 - 2);
    t
}

/// H-box: the 2×2 Hadamard matrix as a rank-2 tensor. Fixed arity 2; chain H-boxes for larger circuits.
pub fn h_box() -> Tensor {
    let h = hadamard();
    let mut t = Tensor::zeros(&[2, 2]);
    *t.get_mut(&[0, 0]) = h[0][0];
    *t.get_mut(&[0, 1]) = h[0][1];
    *t.get_mut(&[1, 0]) = h[1][0];
    *t.get_mut(&[1, 1]) = h[1][1];
    t
}

/// W-node with `num_outputs` outputs. Directional: axis 0 = input, axes
/// 1..=num_outputs = outputs. Shape `(2,) * (1 + num_outputs)`.
///
/// Encodes `|0⟩ → |00…0⟩` (single-hot at no output) and
/// `|1⟩ → single-hot over each output` (`T[1, hot at axis k] = 1`).
/// Unnormalized — the normalized W-state is a Phase 6 concern.
///
/// The contraction layer assigns the W's target edge to axis 0 and source
/// edges to axes 1..N, and enforces exactly-1-input + ≥2-output.
pub fn w_node(num_outputs: usize) -> Tensor {
    let arity = 1 + num_outputs;
    let shape = vec![2usize; arity];
    let mut t = Tensor::zeros(&shape);
    let one = Cplx::new(1.0, 0.0);

    // input |0⟩ → |00…0⟩
    *t.get_mut(&bits_to_index(0, arity)) = one;

    // input |1⟩ → single-hot on output axis k, for k = 1..=num_outputs.
    // Bit 0 = input leg; bit k = output axis k.
    for k in 1..=num_outputs {
        let bits = (1usize << 0) | (1usize << k);
        *t.get_mut(&bits_to_index(bits, arity)) = one;
    }
    t
}

/// AND-gate of given arity. `(1,…,1) → 1`, else 0. Unnormalized indicator.
pub fn and_gate(arity: usize) -> Tensor {
    let shape = vec![2usize; arity];
    let mut t = Tensor::zeros(&shape);
    if arity == 0 {
        // Vacuously true → scalar 1. Renderer disallows arity-0 AND.
        *t.get_mut(&[]) = Cplx::new(1.0, 0.0);
        return t;
    }
    let all_ones = (1usize << arity) - 1;
    let idx = bits_to_index(all_ones, arity);
    *t.get_mut(&idx) = Cplx::new(1.0, 0.0);
    t
}

/// Z-box of given arity with a single phase value `a`. `T[0,…,0] = 1` and
/// `T[1,…,1] = a` (the phase *value*, not `e^{ia}`), else 0. Multi-phase
/// boxes are Phase 6.
pub fn z_box(arity: usize, phase: f64) -> Tensor {
    two_corner_box(arity, phase)
}

/// X-box: the Z-box with the Hadamard applied to each leg.
pub fn x_box(arity: usize, phase: f64) -> Tensor {
    let mut t = two_corner_box(arity, phase);
    let h = hadamard();
    for axis in 0..arity {
        t.apply_2x2_to_axis(axis, h);
    }
    t
}

/// The empty node: a 2-leg identity weight (multiplicative identity under
/// contraction). An isolated empty node (0 legs) is the scalar `1` instead —
/// see the arity-0 branch in `build_vertex_tensor`.
pub fn empty() -> Tensor {
    let mut t = Tensor::zeros(&[2, 2]);
    *t.get_mut(&[0, 0]) = Cplx::new(1.0, 0.0);
    *t.get_mut(&[0, 1]) = Cplx::new(0.0, 0.0);
    *t.get_mut(&[1, 0]) = Cplx::new(0.0, 0.0);
    *t.get_mut(&[1, 1]) = Cplx::new(1.0, 0.0);
    t
}

/// Dispatch a `VertexType` to its builder at the given `arity` and `phase`.
/// Returns `None` for `Input`/`Output` — boundaries have no tensor; the
/// contraction layer treats them as tagged open legs.
///
/// `phase` is read only for spider/box types; `arity` is ignored for
/// `H` (the caller validates degree==2 separately). Builders do no
/// validation; all arity/degree checks belong to the caller.
pub fn build_vertex_tensor(vertex_type: VertexType, arity: usize, phase: f64) -> Option<Tensor> {
    use VertexType::*;
    match vertex_type {
        Z => Some(z_spider(arity, phase)),
        X => Some(x_spider(arity, phase)),
        Zbox => Some(z_box(arity, phase)),
        Xbox => Some(x_box(arity, phase)),
        // `arity` = degree = 1 input + N outputs; the builder takes the
        // output count, so subtract the input leg. `saturating_sub` guards
        // against underflow (contraction layer validates the split first).
        W => Some(w_node(arity.saturating_sub(1))),
        H => Some(h_box()),
        And => Some(and_gate(arity)),
        // A filled black dot is a phaseless Z spider. Hardcode phase 0 so
        // the builder stays correct even if a caller ever passes a phase.
        BlackDot => Some(z_spider(arity, 0.0)),
        // Wired (2 legs) → identity weight; isolated (0 legs) → scalar 1
        // (plan §4.3 D3). Other arities mismatch the rank/degree check in
        // contraction.rs and surface as `DegreeOverflow`.
        Empty => Some(if arity == 0 {
            Tensor::scalar(Cplx::new(1.0, 0.0))
        } else {
            empty()
        }),
        Input | Output => None,
    }
}

// ---- internals --------------------------------------------------------------

/// Shared core of `z_box`/`x_box`: a rank-n tensor non-zero only at the two
/// opposite corners — `T[0,…,0] = 1`, `T[1,…,1] = a` (phase *value*), else 0.
fn two_corner_box(arity: usize, phase: f64) -> Tensor {
    let shape = vec![2usize; arity];
    let mut t = Tensor::zeros(&shape);

    // Arity 0: the two corners coincide, so the single entry picks up `a`.
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

/// Convert a flat bit-pattern `bits` (low bits significant) into the multi-index
/// `[bit0, bit1, …]`. Bit `i` is leg `i`. E.g. `bits=0b110110, arity=3` → `[0, 1, 1]`.
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
        // Pins the dispatch table; a new `VertexType` variant without a
        // match arm fails loudly (Rust's exhaustiveness check would too).
        use crate::graph::VertexType::*;
        let cases: [(VertexType, Option<usize>); 11] = [
            (Z, Some(2)), // arity-2 z_spider → shape (2,2)
            (X, Some(2)),
            (Zbox, Some(2)),
            (Xbox, Some(2)),
            (W, Some(2)),
            (H, Some(2)), // h_box always shape (2,2) regardless of arity
            (And, Some(2)),
            (Empty, Some(2)), // arity 2 → identity weight
            (BlackDot, Some(2)), // phaseless z spider → shape (2,2)
            (Input, None),       // boundary, no tensor
            (Output, None),
        ];
        for (vt, expected_rank) in cases {
            let built = build_vertex_tensor(vt, 2, std::f64::consts::PI);
            match (built, expected_rank) {
                (Some(t), Some(r)) => {
                    assert_eq!(t.rank(), r, "rank mismatch for variant {vt:?}");
                }
                (None, None) => { /* boundary as expected */ }
                (got, want) => {
                    panic!("dispatch for {vt:?}: got rank {got:?}, expected rank {want:?}")
                }
            }
        }
    }

    #[test]
    fn black_dot_is_a_phaseless_z_spider() {
        // Pins the chosen semantics: BlackDot ≡ z_spider(arity, 0), and the
        // passed `phase` is deliberately ignored (hardcoded 0 in the builder).
        use crate::graph::VertexType::BlackDot;
        let with_pi = build_vertex_tensor(BlackDot, 3, std::f64::consts::PI).unwrap();
        let with_zero = build_vertex_tensor(BlackDot, 3, 0.0).unwrap();
        let z_phaseless = z_spider(3, 0.0);
        assert_eq!(with_pi.shape(), z_phaseless.shape());
        // `Tensor` has no PartialEq; compare entry-by-entry.
        for bits in 0..8usize {
            let idx = bits_to_index(bits, 3);
            assert_eq!(with_pi.get(&idx), with_zero.get(&idx));
            assert_eq!(with_pi.get(&idx), z_phaseless.get(&idx));
        }
    }

    #[test]
    fn two_corner_box_test() {
        // z_box(3, π): only (0,0,0)=1 and (1,1,1)=π are non-zero.
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
        // z_spider(2, 0): projector onto |00> + |11> — not the 2×2
        // identity, which is a property of the contracted graph.
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
    fn w_node_2_outputs_is_directional_map() {
        // w_node(2 outputs): axis 0 = input, axes 1,2 = outputs.
        // |0⟩→|000⟩ (T[0,0,0]=1); |1⟩→|100⟩+|010⟩ (T[1,0,1]=T[1,1,0]=1).
        let w = w_node(2);
        assert_eq!(w.shape(), &[2, 2, 2]);
        // input |0⟩ → all outputs |0⟩
        assert_eq!(w.get(&[0, 0, 0]), c(1.0, 0.0));
        // input |1⟩ → single-hot on output 0 (axis 1)
        assert_eq!(w.get(&[1, 1, 0]), c(1.0, 0.0));
        // input |1⟩ → single-hot on output 1 (axis 2)
        assert_eq!(w.get(&[1, 0, 1]), c(1.0, 0.0));
        // everything else is 0
        assert_eq!(w.get(&[1, 1, 1]), c(0.0, 0.0));
        assert_eq!(w.get(&[0, 1, 0]), c(0.0, 0.0));
        assert_eq!(w.get(&[1, 0, 0]), c(0.0, 0.0));
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
        // e^{iπ}=-1) — the box particularity vs the spider.
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
        // z_box(2, 0): T[1,1]=0 (phase value 0, not e^{i0}=1) → [[1,0],[0,0]],
        // a rank-1 projector onto |0>. Counterintuitive vs spiders.
        let t = z_box(2, 0.0);
        assert_eq!(t.get(&[0, 0]), c(1.0, 0.0));
        assert_eq!(t.get(&[1, 1]), c(0.0, 0.0));
        assert_eq!(t.get(&[0, 1]), c(0.0, 0.0));
        assert_eq!(t.get(&[1, 0]), c(0.0, 0.0));
    }

    // ---- arity edge cases ----------------------------------------------------

    #[test]
    fn w_node_1_output_is_qubit_identity() {
        // w_node(1 output): |0⟩→|00⟩, |1⟩→|11⟩ (the single output) →
        // identity matrix. The contraction layer rejects <2 outputs, but
        // the builder itself constructs this cleanly.
        let w = w_node(1);
        assert_eq!(w.shape(), &[2, 2]);
        assert_eq!(w.get(&[0, 0]), c(1.0, 0.0));
        assert_eq!(w.get(&[1, 1]), c(1.0, 0.0));
        assert_eq!(w.get(&[0, 1]), c(0.0, 0.0));
        assert_eq!(w.get(&[1, 0]), c(0.0, 0.0));
    }

    #[test]
    fn and_gate_arity_1_is_a_qubit_one() {
        // and_gate(1): all-1s index is [1] → [0, 1]. (Single-input AND is vacuously true.)
        let a = and_gate(1);
        assert_eq!(a.shape(), &[2]);
        assert_eq!(a.get(&[0]), c(0.0, 0.0));
        assert_eq!(a.get(&[1]), c(1.0, 0.0));
    }

    #[test]
    fn z_box_arity_1_two_corners() {
        // Arity-1 z_box: T[0]=1, T[1]=φ.
        let phi = 0.7;
        let z = z_box(1, phi);
        assert_eq!(z.shape(), &[2]);
        assert_eq!(z.get(&[0]), c(1.0, 0.0));
        assert_eq!(z.get(&[1]), c(phi, 0.0));
    }

    #[test]
    fn x_box_round_trips_through_z_basis_via_hadamard() {
        // x_box is defined as z_box with H per leg; applying H again recovers z_box.
        let phi = std::f64::consts::FRAC_PI_3;
        let mut x = x_box(2, phi);
        let h: [[Cplx; 2]; 2] = [
            [
                c(std::f64::consts::FRAC_1_SQRT_2, 0.0),
                c(std::f64::consts::FRAC_1_SQRT_2, 0.0),
            ],
            [
                c(std::f64::consts::FRAC_1_SQRT_2, 0.0),
                c(-std::f64::consts::FRAC_1_SQRT_2, 0.0),
            ],
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
        // z_spider(3): only (0,0,0)=1 and (1,1,1)=e^{iπ}=-1 are non-zero.
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
        assert_eq!(
            non_zero, 2,
            "z_spider(3) should have exactly 2 non-zero entries"
        );
        // (0,0,0) = 1, (1,1,1) = e^{iπ} = -1.
        assert_eq!(z.get(&[0, 0, 0]), c(1.0, 0.0));
        assert!((z.get(&[1, 1, 1]).re - (-1.0)).abs() < 1e-10);
    }
}
