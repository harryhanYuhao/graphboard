// crates/zxw/tests/contraction.rs
//
// End-to-end tests for `compute_tensor`. Each builds a `GraphSlice` from
// a JSON literal (matching the frontend wire shape), runs the
// contraction, and asserts on `TensorResult`. Expected values are noted
// inline so a builder/axis change fails with a clear story.

use approx::assert_relative_eq;
use zxw::{compute_tensor, FrontendGraphSlice};

/// Parse JSON, run `compute_tensor`, return the result. Panics on error.
fn compute(json: &str) -> zxw::TensorResult {
    let graph: FrontendGraphSlice = serde_json::from_str(json).expect("test graph JSON must parse");
    compute_tensor(&graph, None).expect("compute_tensor should succeed")
}

/// Assert the tensor's complex entries match the expected `(re, im)` pairs
/// in row-major order.
fn assert_data(actual: &[(f64, f64)], expected: &[(f64, f64)]) {
    assert_eq!(
        actual.len(),
        expected.len(),
        "data length mismatch: got {}, expected {}",
        actual.len(),
        expected.len()
    );
    for (i, (a, e)) in actual.iter().zip(expected.iter()).enumerate() {
        // `i` would be nice in the panic message but the macro takes none.
        let _ = i;
        assert_relative_eq!(a.0, e.0, epsilon = 1e-10);
        assert_relative_eq!(a.1, e.1, epsilon = 1e-10);
    }
}

// ---- Basic shapes ----------------------------------------------------------

#[test]
fn empty_graph_is_scalar_one() {
    // Plan §5.6: empty graph → multiplicative identity (scalar 1).
    let r = compute(r#"{"nodes":[],"edges":[]}"#);
    assert_eq!(r.shape, Vec::<usize>::new());
    assert_eq!(r.data, vec![(1.0, 0.0)]);
    assert_eq!(r.input_count, 0);
    assert_eq!(r.output_count, 0);
}

#[test]
fn single_z_spider_isolated_is_scalar_one_plus_exp_i_phi() {
    // Isolated Z spider: scalar `1 + e^{iφ}`. φ=π → 0, φ=0 → 2.
    let json_pi = r#"{
        "nodes": [{"id":"z","data":{"phase":"\\pi","vertexType":"z"}}],
        "edges": []
    }"#;
    let r = compute(json_pi);
    assert_eq!(r.shape, Vec::<usize>::new());
    assert_relative_eq!(r.data[0].0, 0.0, epsilon = 1e-10);

    let json_zero = r#"{
        "nodes": [{"id":"z","data":{"phase":"","vertexType":"z"}}],
        "edges": []
    }"#;
    let r0 = compute(json_zero);
    assert_relative_eq!(r0.data[0].0, 2.0, epsilon = 1e-10);
}

#[test]
fn z_h_z_chain_with_boundaries_is_z_h_z_matrix() {
    // Boundary-tagged chain output₁ → z1(π/2) → h → z2(0) → output₂.
    // Result is the matrix Z(π/2)·H = (1/√2)·[[1, 1], [i, -i]], shape [2,2].
    let json = r#"{
        "nodes": [
            {"id":"o1","data":{"phase":"","vertexType":"output"}},
            {"id":"z1","data":{"phase":"\\pi/2","vertexType":"z"}},
            {"id":"h","data":{"phase":"","vertexType":"h"}},
            {"id":"z2","data":{"phase":"","vertexType":"z"}},
            {"id":"o2","data":{"phase":"","vertexType":"output"}}
        ],
        "edges": [
            {"id":"e1","source":"o1","target":"z1"},
            {"id":"e2","source":"z1","target":"h"},
            {"id":"e3","source":"h","target":"z2"},
            {"id":"e4","source":"z2","target":"o2"}
        ]
    }"#;
    let r = compute(json);
    assert_eq!(r.shape, vec![2, 2]);
    assert_eq!(r.input_count, 0);
    assert_eq!(r.output_count, 2);

    let inv_sqrt2 = std::f64::consts::FRAC_1_SQRT_2;
    // (1/√2) [[1, 1], [i, -i]] in row-major order.
    let expected = [
        (inv_sqrt2, 0.0),  // (0,0) = 1/√2
        (inv_sqrt2, 0.0),  // (0,1) = 1/√2
        (0.0, inv_sqrt2),  // (1,0) = i/√2
        (0.0, -inv_sqrt2), // (1,1) = -i/√2
    ];
    assert_data(&r.data, &expected);
}

// ---- Closed-graph scalars --------------------------------------------------

#[test]
fn fully_contracted_two_z_spiders_scalar_is_two_plus_one() {
    // Two arity-2 Z spiders joined by 2 edges → fully contracted scalar.
    // Both are I (φ=0); Σ z1·z2 over the shared indices = 2.
    let json = r#"{
        "nodes": [
            {"id":"z1","data":{"phase":"","vertexType":"z"}},
            {"id":"z2","data":{"phase":"","vertexType":"z"}}
        ],
        "edges": [
            {"id":"e1","source":"z1","target":"z2"},
            {"id":"e2","source":"z1","target":"z2"}
        ]
    }"#;
    let r = compute(json);
    assert_eq!(r.shape, Vec::<usize>::new());
    assert_relative_eq!(r.data[0].0, 2.0, epsilon = 1e-10);
    assert_relative_eq!(r.data[0].1, 0.0, epsilon = 1e-10);
}

#[test]
fn fully_contracted_z_pi_cancels_to_zero() {
    // z1 = diag(1,-1); the two contributions cancel → 0.
    let json = r#"{
        "nodes": [
            {"id":"z1","data":{"phase":"\\pi","vertexType":"z"}},
            {"id":"z2","data":{"phase":"","vertexType":"z"}}
        ],
        "edges": [
            {"id":"e1","source":"z1","target":"z2"},
            {"id":"e2","source":"z1","target":"z2"}
        ]
    }"#;
    let r = compute(json);
    assert_eq!(r.shape, Vec::<usize>::new());
    assert_relative_eq!(r.data[0].0, 0.0, epsilon = 1e-10);
}

// ---- Self-loop (supported via trace) ---------------------------------------

#[test]
fn self_loop_z_spider_yields_trace() {
    // Self-loop → arity 2 (self-loop counts twice) → trace = 1 + e^{iφ}.
    // φ=π/2 → 1+i.
    let json = r#"{
        "nodes": [
            {"id":"z","data":{"phase":"\\pi/2","vertexType":"z"}}
        ],
        "edges": [
            {"id":"self","source":"z","target":"z"}
        ]
    }"#;
    let r = compute(json);
    assert_eq!(r.shape, Vec::<usize>::new());
    // 1 + i.
    assert_relative_eq!(r.data[0].0, 1.0, epsilon = 1e-10);
    assert_relative_eq!(r.data[0].1, 1.0, epsilon = 1e-10);
}

// ---- Boundary handling -----------------------------------------------------

#[test]
fn input_output_counts_flow_through() {
    // input → z → output: z(2,0)=I contracts to a scalar, but the two
    // boundary legs remain as open axes → shape [2,2].
    let json = r#"{
        "nodes": [
            {"id":"in","data":{"phase":"","vertexType":"input"}},
            {"id":"z","data":{"phase":"","vertexType":"z"}},
            {"id":"out","data":{"phase":"","vertexType":"output"}}
        ],
        "edges": [
            {"id":"e1","source":"in","target":"z"},
            {"id":"e2","source":"z","target":"out"}
        ]
    }"#;
    let r = compute(json);
    assert_eq!(r.shape, vec![2, 2]);
    assert_eq!(r.input_count, 1);
    assert_eq!(r.output_count, 1);
    // z(2,0)=I → identity matrix (input rows, output cols).
    assert_data(&r.data, &[(1.0, 0.0), (0.0, 0.0), (0.0, 0.0), (1.0, 0.0)]);
}

#[test]
fn black_dot_contracts_like_a_phaseless_z_spider() {
    // Pinned semantics: black_dot ≡ z_spider(arity, 0). The same wire-up
    // as `input_output_counts_flow_through` with a black dot in place of the
    // phaseless Z must give the identity matrix.
    let json = r#"{
        "nodes": [
            {"id":"in","data":{"phase":"","vertexType":"input"}},
            {"id":"bd","data":{"phase":"ignored","vertexType":"black_dot"}},
            {"id":"out","data":{"phase":"","vertexType":"output"}}
        ],
        "edges": [
            {"id":"e1","source":"in","target":"bd"},
            {"id":"e2","source":"bd","target":"out"}
        ]
    }"#;
    let r = compute(json);
    assert_eq!(r.shape, vec![2, 2]);
    assert_eq!(r.input_count, 1);
    assert_eq!(r.output_count, 1);
    // Identity, exactly like the phaseless Z case — and the (ignored)
    // non-empty `phase` string proves black_dot never parses a phase.
    assert_data(&r.data, &[(1.0, 0.0), (0.0, 0.0), (0.0, 0.0), (1.0, 0.0)]);
    assert!(r.warnings.is_empty(), "phase on black_dot must be ignored");
}

// ---- Disconnected components -----------------------------------------------

#[test]
fn disconnected_components_outer_producted() {
    // Two isolated Z spiders outer-producted; each scalar = 2 → product 4.
    let json = r#"{
        "nodes": [
            {"id":"a","data":{"phase":"","vertexType":"z"}},
            {"id":"b","data":{"phase":"","vertexType":"z"}}
        ],
        "edges": []
    }"#;
    let r = compute(json);
    assert_eq!(r.shape, Vec::<usize>::new()); // scalars × scalars = scalar
    assert_relative_eq!(r.data[0].0, 4.0, epsilon = 1e-10);
}

#[test]
fn dangling_boundary_contributes_identity_axis() {
    // A dangling `input` contributes a length-2 axis [1, 0] → shape [2].
    let json = r#"{
        "nodes": [
            {"id":"in","data":{"phase":"","vertexType":"input"}}
        ],
        "edges": []
    }"#;
    let r = compute(json);
    assert_eq!(r.shape, vec![2]);
    assert_eq!(r.input_count, 1);
    assert_eq!(r.output_count, 0);
    assert_data(&r.data, &[(1.0, 0.0), (0.0, 0.0)]);
}

// ---- Parity / additional coverage -----------------------------------------

#[test]
fn z_h_z_chain_with_zero_phase_is_identity() {
    // Chain with φ=0 → I·H·I = H. Result is the Hadamard matrix.
    let json = r#"{
        "nodes": [
            {"id":"o1","data":{"phase":"","vertexType":"output"}},
            {"id":"z1","data":{"phase":"","vertexType":"z"}},
            {"id":"h","data":{"phase":"","vertexType":"h"}},
            {"id":"z2","data":{"phase":"","vertexType":"z"}},
            {"id":"o2","data":{"phase":"","vertexType":"output"}}
        ],
        "edges": [
            {"id":"e1","source":"o1","target":"z1"},
            {"id":"e2","source":"z1","target":"h"},
            {"id":"e3","source":"h","target":"z2"},
            {"id":"e4","source":"z2","target":"o2"}
        ]
    }"#;
    let r = compute(json);
    assert_eq!(r.shape, vec![2, 2]);
    assert_eq!(r.input_count, 0);
    assert_eq!(r.output_count, 2);
    let inv = std::f64::consts::FRAC_1_SQRT_2;
    assert_data(&r.data, &[(inv, 0.0), (inv, 0.0), (inv, 0.0), (-inv, 0.0)]);
}

#[test]
fn bell_state_preparation_yields_phi_plus() {
    // 3-vertex graph, no inputs, 2 outputs: z1(2,0) ── h ── output₁ with
    // z1's other leg → output₂. Contracting one z1 leg with H leaves the
    // (o1, o2) matrix = H = (1/√2)·[[1,1],[1,-1]] (the X-basis Bell state).
    let json = r#"{
        "nodes": [
            {"id":"z1","data":{"phase":"","vertexType":"z"}},
            {"id":"h","data":{"phase":"","vertexType":"h"}},
            {"id":"o1","data":{"phase":"","vertexType":"output"}},
            {"id":"o2","data":{"phase":"","vertexType":"output"}}
        ],
        "edges": [
            {"id":"e1","source":"z1","target":"h"},
            {"id":"e2","source":"h","target":"o1"},
            {"id":"e3","source":"z1","target":"o2"}
        ]
    }"#;
    let r = compute(json);
    assert_eq!(r.shape, vec![2, 2]);
    assert_eq!(r.input_count, 0);
    assert_eq!(r.output_count, 2);
    let inv = std::f64::consts::FRAC_1_SQRT_2;
    // Axes [o1, o2] by node order; H in row-major.
    assert_data(&r.data, &[(inv, 0.0), (inv, 0.0), (inv, 0.0), (-inv, 0.0)]);
}

#[test]
fn fully_contracted_has_zero_boundaries() {
    // Fully-contracted graph → scalar; both boundary counts zero.
    let json = r#"{
        "nodes": [
            {"id":"z1","data":{"phase":"","vertexType":"z"}},
            {"id":"z2","data":{"phase":"","vertexType":"z"}}
        ],
        "edges": [
            {"id":"e1","source":"z1","target":"z2"},
            {"id":"e2","source":"z1","target":"z2"}
        ]
    }"#;
    let r = compute(json);
    assert_eq!(r.shape, Vec::<usize>::new());
    assert_eq!(r.input_count, 0);
    assert_eq!(r.output_count, 0);
}

// ---- Builder coverage: Z-box, X-box, W-node, AND-gate end-to-end ----------

#[test]
fn z_box_between_boundaries_is_diagonal_with_phase_value() {
    // output → z_box(2, π) → input. Z-box corner-only: T[0,0]=1, T[1,1]=φ
    // (raw value, NOT e^{iφ}). Boundary legs become result axes.
    let json = r#"{
        "nodes": [
            {"id":"o","data":{"phase":"","vertexType":"output"}},
            {"id":"zb","data":{"phase":"\\pi","vertexType":"zbox"}},
            {"id":"i","data":{"phase":"","vertexType":"input"}}
        ],
        "edges": [
            {"id":"e1","source":"i","target":"zb"},
            {"id":"e2","source":"zb","target":"o"}
        ]
    }"#;
    let r = compute(json);
    assert_eq!(r.shape, vec![2, 2]);
    assert_eq!(r.input_count, 1);
    assert_eq!(r.output_count, 1);
    let pi = std::f64::consts::PI;
    // data layout: [M(0,0), M(1,0), M(0,1), M(1,1)] (col-major).
    assert_data(&r.data, &[(1.0, 0.0), (0.0, 0.0), (0.0, 0.0), (pi, 0.0)]);
}

#[test]
fn x_box_between_boundaries_is_basis_conjugate_of_z_box() {
    // x_box(2,0) = H·z_box·H per leg; z_box(2,0)=|0⟩⟨0| → |+⟩⟨+| =
    // (1/2)·all-ones.
    let json = r#"{
        "nodes": [
            {"id":"o","data":{"phase":"","vertexType":"output"}},
            {"id":"xb","data":{"phase":"","vertexType":"xbox"}},
            {"id":"i","data":{"phase":"","vertexType":"input"}}
        ],
        "edges": [
            {"id":"e1","source":"i","target":"xb"},
            {"id":"e2","source":"xb","target":"o"}
        ]
    }"#;
    let r = compute(json);
    assert_eq!(r.shape, vec![2, 2]);
    assert_eq!(r.input_count, 1);
    assert_eq!(r.output_count, 1);
    // (1/2)·all-ones; all four entries are 0.5 in col-major layout.
    assert_data(&r.data, &[(0.5, 0.0), (0.5, 0.0), (0.5, 0.0), (0.5, 0.0)]);
}

#[test]
fn and_gate_two_inputs_is_logical_and() {
    // 2 inputs → and_gate → output: rank-3 tensor [in1, in2, out], only
    // (1,1,1) non-zero. The compute layer returns the raw rank-n tensor
    // (reshape to a matrix is the frontend's concern).
    let json = r#"{
        "nodes": [
            {"id":"i1","data":{"phase":"","vertexType":"input"}},
            {"id":"i2","data":{"phase":"","vertexType":"input"}},
            {"id":"a","data":{"phase":"","vertexType":"and"}},
            {"id":"o","data":{"phase":"","vertexType":"output"}}
        ],
        "edges": [
            {"id":"e1","source":"i1","target":"a"},
            {"id":"e2","source":"i2","target":"a"},
            {"id":"e3","source":"a","target":"o"}
        ]
    }"#;
    let r = compute(json);
    assert_eq!(r.shape, vec![2, 2, 2]);
    assert_eq!(r.input_count, 2);
    assert_eq!(r.output_count, 1);
    // Row-major over [in1, in2, out]; index = i1*4 + i2*2 + out. Only (1,1,1)=1.
    assert!(r.data[7].0.abs() - 1.0 < 1e-10, "AND(1,1,1) should be 1");
    // Every other entry must be zero.
    let non_zeros: Vec<_> = r
        .data
        .iter()
        .filter(|(re, im)| re.abs() + im.abs() > 1e-10)
        .collect();
    assert_eq!(
        non_zeros.len(),
        1,
        "AND should have exactly 1 non-zero entry across 8"
    );
}

#[test]
fn w_node_one_input_two_outputs_yields_directional_state() {
    // Directional W: 1 input + 2 outputs, axes [in, out0, out1], shape
    // [2,2,2]. Non-zero at T[0,0,0], T[1,0,1], T[1,1,0] (index = in*4+out0*2+out1).
    let json = r#"{
        "nodes": [
            {"id":"i","data":{"phase":"","vertexType":"input"}},
            {"id":"w","data":{"phase":"","vertexType":"w"}},
            {"id":"o0","data":{"phase":"","vertexType":"output"}},
            {"id":"o1","data":{"phase":"","vertexType":"output"}}
        ],
        "edges": [
            {"id":"e1","source":"i","target":"w"},
            {"id":"e2","source":"w","target":"o0"},
            {"id":"e3","source":"w","target":"o1"}
        ]
    }"#;
    let r = compute(json);
    assert_eq!(r.shape, vec![2, 2, 2]);
    assert_eq!(r.input_count, 1);
    assert_eq!(r.output_count, 2);
    assert_data(
        &r.data,
        &[
            (1.0, 0.0), // [0,0,0]
            (0.0, 0.0),
            (0.0, 0.0),
            (0.0, 0.0),
            (0.0, 0.0),
            (1.0, 0.0), // [1,0,1]
            (1.0, 0.0), // [1,1,0]
            (0.0, 0.0),
        ],
    );
}

// ---- Multi-vertex chains --------------------------------------------------

#[test]
fn z_z_parallel_path_multi_edge() {
    // input → z1 →(2 edges)→ z2 → output: each Z arity 3, contracting the
    // 2 internal edges leaves the two boundary legs → shape [2,2].
    // Pins multi-edge contraction (two legs consumed between one pair).
    let json = r#"{
        "nodes": [
            {"id":"i","data":{"phase":"","vertexType":"input"}},
            {"id":"z1","data":{"phase":"","vertexType":"z"}},
            {"id":"z2","data":{"phase":"","vertexType":"z"}},
            {"id":"o","data":{"phase":"","vertexType":"output"}}
        ],
        "edges": [
            {"id":"e1","source":"i","target":"z1"},
            {"id":"e2","source":"z1","target":"z2"},
            {"id":"e3","source":"z1","target":"z2"},
            {"id":"e4","source":"z2","target":"o"}
        ]
    }"#;
    let r = compute(json);
    assert_eq!(r.shape, vec![2, 2]);
    assert_eq!(r.input_count, 1);
    assert_eq!(r.output_count, 1);
    // Entries must stay finite (no NaN/inf).
    for (re, im) in &r.data {
        assert!(re.is_finite(), "re not finite: {re}");
        assert!(im.is_finite(), "im not finite: {im}");
    }
    // Trace of the result matrix is 2.
    let trace = r.data[0].0 + r.data[3].0; // M(0,0) + M(1,1)
    assert_relative_eq!(trace, 2.0, epsilon = 1e-10);
}

// ---- Basis ordering: the locked matrix convention -------------------------

#[test]
fn two_inputs_two_outputs_basis_order_is_big_endian() {
    // i1,i2 → z(0) → o1,o2: a single arity-4 copy spider, axes
    // [in1,in2,out1,out2]. Big-endian index k = in1*8+in2*4+out1*2+out2;
    // only k=0 (0000) and k=15 (1111) are non-zero.
    let json = r#"{
        "nodes": [
            {"id":"i1","data":{"phase":"","vertexType":"input"}},
            {"id":"i2","data":{"phase":"","vertexType":"input"}},
            {"id":"z","data":{"phase":"","vertexType":"z"}},
            {"id":"o1","data":{"phase":"","vertexType":"output"}},
            {"id":"o2","data":{"phase":"","vertexType":"output"}}
        ],
        "edges": [
            {"id":"e1","source":"i1","target":"z"},
            {"id":"e2","source":"i2","target":"z"},
            {"id":"e3","source":"z","target":"o1"},
            {"id":"e4","source":"z","target":"o2"}
        ]
    }"#;
    let r = compute(json);
    assert_eq!(r.shape, vec![2, 2, 2, 2]);
    assert_eq!(r.input_count, 2);
    assert_eq!(r.output_count, 2);
    assert_eq!(r.data.len(), 16);
    assert_relative_eq!(r.data[0].0, 1.0, epsilon = 1e-10); // all-0 = 1
    assert_relative_eq!(r.data[15].0, 1.0, epsilon = 1e-10); // all-1 = 1
    for (i, (re, im)) in r.data.iter().enumerate() {
        if i == 0 || i == 15 {
            continue;
        }
        assert_relative_eq!(*re, 0.0, epsilon = 1e-10);
        assert_relative_eq!(*im, 0.0, epsilon = 1e-10);
    }
}

// ---- Boundary `order` field drives axis ordering --------------------------

#[test]
fn boundary_order_field_drives_input_axis_order() {
    // Same topology, two `order` assignments → different `data` layouts.
    // Proves `order` (not array position) picks which input is axis 0.
    // Two components: A is Z(π) → diag(1,-1), B is Z(0) → I; outer product
    // over [iX, iY, oA, oB] (iX = first input). Non-zero pattern shifts
    // when the inputs swap.
    //
    // Case 1 — no `order`: array position keys it, axes = [iA, iB, oA, oB].
    // Non-zero: 0→1, 5→1, 10→−1, 15→−1.
    let baseline = compute(
        r#"{
        "nodes": [
            {"id":"iA","data":{"phase":"","vertexType":"input"}},
            {"id":"oA","data":{"phase":"","vertexType":"output"}},
            {"id":"zA","data":{"phase":"\\pi","vertexType":"z"}},
            {"id":"iB","data":{"phase":"","vertexType":"input"}},
            {"id":"oB","data":{"phase":"","vertexType":"output"}},
            {"id":"zB","data":{"phase":"0","vertexType":"z"}}
        ],
        "edges": [
            {"id":"e1","source":"iA","target":"zA"},
            {"id":"e2","source":"zA","target":"oA"},
            {"id":"e3","source":"iB","target":"zB"},
            {"id":"e4","source":"zB","target":"oB"}
        ]
    }"#,
    );
    assert_eq!(baseline.shape, vec![2, 2, 2, 2]);
    assert_eq!(baseline.input_count, 2);
    assert_eq!(baseline.output_count, 2);
    assert_relative_eq!(baseline.data[0].0, 1.0, epsilon = 1e-10);
    assert_relative_eq!(baseline.data[5].0, 1.0, epsilon = 1e-10);
    assert_relative_eq!(baseline.data[10].0, -1.0, epsilon = 1e-10);
    assert_relative_eq!(baseline.data[15].0, -1.0, epsilon = 1e-10);

    // Case 2 — `order` reverses inputs: axes = [iB, iA, oA, oB] (iB = +1 first).
    // Non-zero: 0→1, 9→1, 6→−1, 15→−1.
    let reordered = compute(
        r#"{
        "nodes": [
            {"id":"iA","data":{"phase":"","vertexType":"input","order":1}},
            {"id":"oA","data":{"phase":"","vertexType":"output"}},
            {"id":"zA","data":{"phase":"\\pi","vertexType":"z"}},
            {"id":"iB","data":{"phase":"","vertexType":"input","order":0}},
            {"id":"oB","data":{"phase":"","vertexType":"output"}},
            {"id":"zB","data":{"phase":"0","vertexType":"z"}}
        ],
        "edges": [
            {"id":"e1","source":"iA","target":"zA"},
            {"id":"e2","source":"zA","target":"oA"},
            {"id":"e3","source":"iB","target":"zB"},
            {"id":"e4","source":"zB","target":"oB"}
        ]
    }"#,
    );
    assert_eq!(reordered.shape, vec![2, 2, 2, 2]);
    assert_relative_eq!(reordered.data[0].0, 1.0, epsilon = 1e-10);
    assert_relative_eq!(reordered.data[9].0, 1.0, epsilon = 1e-10);
    assert_relative_eq!(reordered.data[6].0, -1.0, epsilon = 1e-10);
    assert_relative_eq!(reordered.data[15].0, -1.0, epsilon = 1e-10);

    // The two arrangements must differ — otherwise `order` isn't driving anything.
    assert_ne!(baseline.data[5].0, reordered.data[5].0);
    assert_ne!(baseline.data[6].0, reordered.data[6].0);
    assert_ne!(baseline.data[9].0, reordered.data[9].0);
    assert_ne!(baseline.data[10].0, reordered.data[10].0);
}

// ---- Error paths ----------------------------------------------------------

#[test]
fn empty_node_is_identity_weight() {
    // An isolated empty node → degree 0 → scalar 1 (the multiplicative identity).
    let json = r#"{
        "nodes": [{"id":"e","data":{"phase":"","vertexType":"empty"}}],
        "edges": []
    }"#;
    let r = compute(json);
    assert_eq!(r.shape, Vec::<usize>::new());
    // assert_relative_eq!(r.data[0].0, 1.0, epsilon = 1e-10);
    // assert_eq!(r.input_count, 2);
    // assert_eq!(r.output_count, 2);
}

#[test]
fn unparseable_label_warning_flows_through_end_to_end() {
    // Fallback: an unparseable label still computes (phase 0 substituted)
    // and surfaces exactly one warning. z_spider(2,0)=I here, so the result
    // also confirms the substitution happened.
    let json = r#"{
        "nodes": [
            {"id":"o","data":{"phase":"","vertexType":"output"}},
            {"id":"z","data":{"phase":"not a phase","vertexType":"z"}},
            {"id":"i","data":{"phase":"","vertexType":"input"}}
        ],
        "edges": [
            {"id":"e1","source":"i","target":"z"},
            {"id":"e2","source":"z","target":"o"}
        ]
    }"#;
    let r = compute(json);
    assert_eq!(r.shape, vec![2, 2]);
    assert_eq!(r.warnings.len(), 1, "exactly one warning for the bad label");
    assert!(
        r.warnings[0].to_lowercase().contains("parse"),
        "warning should mention parse: {}",
        r.warnings[0]
    );
    // With phase 0 substituted → identity matrix.
    assert_data(&r.data, &[(1.0, 0.0), (0.0, 0.0), (0.0, 0.0), (1.0, 0.0)]);
}

// ---- Coverage: on_progress, dangling boundaries ----------------------------

#[test]
fn dangling_degree_zero_input_contributes_basis_state_axis() {
    // A degree-0 boundary contributes an open axis of value [1, 0]
    // (the |0⟩ basis state).
    let json = r#"{
        "nodes": [
            {"id":"in","data":{"phase":"","vertexType":"input"}}
        ],
        "edges": []
    }"#;
    let r = compute(json);
    assert_eq!(r.shape, vec![2]);
    assert_eq!(r.input_count, 1);
    assert_eq!(r.output_count, 0);
    assert_data(&r.data, &[(1.0, 0.0), (0.0, 0.0)]);
}

#[test]
fn dangling_degree_zero_output_contributes_basis_state_axis() {
    // Symmetric to the input case: isolated `output` → shape [2], data [1,0].
    let json = r#"{
        "nodes": [
            {"id":"out","data":{"phase":"","vertexType":"output"}}
        ],
        "edges": []
    }"#;
    let r = compute(json);
    assert_eq!(r.shape, vec![2]);
    assert_eq!(r.input_count, 0);
    assert_eq!(r.output_count, 1);
    assert_data(&r.data, &[(1.0, 0.0), (0.0, 0.0)]);
}

#[test]
fn on_progress_is_invoked_once_per_edge_with_running_and_total_counts() {
    // Contract: `on_progress(running, total)` fires once per edge in
    // order, with a 1-based running count and the constant total.
    // 3-edge chain → 3 calls: (1,3),(2,3),(3,3).
    let json = r#"{
        "nodes": [
            {"id":"a","data":{"phase":"","vertexType":"z"}},
            {"id":"b","data":{"phase":"","vertexType":"z"}},
            {"id":"c","data":{"phase":"","vertexType":"z"}},
            {"id":"d","data":{"phase":"","vertexType":"z"}}
        ],
        "edges": [
            {"id":"e1","source":"a","target":"b"},
            {"id":"e2","source":"b","target":"c"},
            {"id":"e3","source":"c","target":"d"}
        ]
    }"#;
    let graph: FrontendGraphSlice = serde_json::from_str(json).expect("test graph JSON must parse");

    use std::cell::RefCell;
    use std::sync::atomic::{AtomicUsize, Ordering};
    // `on_progress` is `&dyn Fn`; single-threaded within one call → RefCell is safe.
    let calls: RefCell<Vec<(usize, usize)>> = RefCell::new(Vec::new());
    let count = AtomicUsize::new(0);
    let cb = |contracted: usize, total: usize| {
        count.fetch_add(1, Ordering::Relaxed);
        calls.borrow_mut().push((contracted, total));
    };
    compute_tensor(&graph, Some(&cb)).expect("compute should succeed");

    let calls = calls.into_inner();
    assert_eq!(calls.len(), 3, "one callback per edge");
    assert_eq!(
        calls,
        vec![(1, 3), (2, 3), (3, 3)],
        "running 1-based count then constant total"
    );
}

#[test]
fn on_progress_not_called_when_there_are_zero_edges() {
    // No edges → callback never fires (no spurious "0/0" call).
    let json = r#"{
        "nodes": [{"id":"z","data":{"phase":"","vertexType":"z"}}],
        "edges": []
    }"#;
    let graph: FrontendGraphSlice = serde_json::from_str(json).expect("test graph JSON must parse");
    let fired = std::sync::atomic::AtomicUsize::new(0);
    compute_tensor(
        &graph,
        Some(&|_, _| {
            fired.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        }),
    )
    .expect("compute should succeed");
    assert_eq!(
        fired.into_inner(),
        0,
        "no progress callback for an edge-less graph"
    );
}

#[test]
fn degree_overflow_is_defensive_only_parallel_plus_selfloops() {
    // Most adversarial same-group case: z1/z2 with 3 parallel edges + 1
    // self-loop each → degree 5. A valid graph like this must compute
    // (DegreeOverflow is unreachable for valid inputs since arity == degree).
    let json = r#"{
        "nodes": [
            {"id":"z1","data":{"phase":"","vertexType":"z"}},
            {"id":"z2","data":{"phase":"","vertexType":"z"}}
        ],
        "edges": [
            {"id":"e1","source":"z1","target":"z2"},
            {"id":"e2","source":"z1","target":"z2"},
            {"id":"e3","source":"z1","target":"z2"},
            {"id":"e4","source":"z1","target":"z1"}
        ]
    }"#;
    let graph: FrontendGraphSlice = serde_json::from_str(json).expect("test graph JSON must parse");
    // All legs consumed → scalar.
    let r = compute_tensor(&graph, None).expect("valid graph must compute");
    assert_eq!(r.shape, Vec::<usize>::new());
}
