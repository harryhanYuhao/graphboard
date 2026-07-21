// crates/zxw/tests/contraction.rs
//
// End-to-end tests for `compute_tensor` (plan §5.3 + §5.6 edge cases).
// Each test builds a small `GraphSlice` from a JSON literal (matching
// the wire shape `src/lib/graph/serialization.ts` emits), runs
// `compute_tensor`, and asserts on the resulting `TensorResult`
// (shape, data, boundary counts, or `ComputeError` variant).
//
// Hand-derived expected values are commented inline so a future change
// to a builder's convention or to `contract`'s axis bookkeeping is
// caught with a clear story, not just a number diff.

use approx::assert_relative_eq;
use zxw::{compute_tensor, ComputeError, GraphSlice};

/// Helper: parse a JSON graph payload, run `compute_tensor`, return the
/// `TensorResult`. Panics on parse or compute errors so test bodies
/// stay focused on values.
fn compute(json: &str) -> zxw::TensorResult {
    let graph: GraphSlice =
        serde_json::from_str(json).expect("test graph JSON must parse");
    compute_tensor(&graph, None).expect("compute_tensor should succeed")
}

/// Helper: like `compute`, but expects a `ComputeError`. Returns it so
/// the test can assert on the variant.
fn compute_err(json: &str) -> ComputeError {
    let graph: GraphSlice =
        serde_json::from_str(json).expect("test graph JSON must parse");
    compute_tensor(&graph, None).expect_err("compute_tensor should error")
}

/// Helper: assert the result tensor's complex entries match a list of
/// expected `(re, im)` pairs, in row-major order.
fn assert_data(actual: &[(f64, f64)], expected: &[(f64, f64)]) {
    assert_eq!(
        actual.len(),
        expected.len(),
        "data length mismatch: got {}, expected {}",
        actual.len(),
        expected.len()
    );
    for (i, (a, e)) in actual.iter().zip(expected.iter()).enumerate() {
        assert_relative_eq!(a.0, e.0, epsilon = 1e-10);
        assert_relative_eq!(a.1, e.1, epsilon = 1e-10);
        // On mismatch, `assert_relative_eq` panics with a diff. The
        // `i` would be nice in the message but the macro doesn't take
        // a format string; the panic location still points here.
        let _ = i;
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
    // 1 isolated Z spider with no edges → degree 0 → arity 0 → scalar
    // value `1 + e^{iφ}` (the all-0 corner = 1, the all-1 corner = e^{iφ};
    // for arity 0 they coincide and sum). For φ = π: 1 + (-1) = 0.
    // For φ = 0: 1 + 1 = 2.
    let json_pi = r#"{
        "nodes": [{"id":"z","data":{"label":"\\pi","vertexType":"z"}}],
        "edges": []
    }"#;
    let r = compute(json_pi);
    assert_eq!(r.shape, Vec::<usize>::new());
    assert_relative_eq!(r.data[0].0, 0.0, epsilon = 1e-10);

    let json_zero = r#"{
        "nodes": [{"id":"z","data":{"label":"","vertexType":"z"}}],
        "edges": []
    }"#;
    let r0 = compute(json_zero);
    assert_relative_eq!(r0.data[0].0, 2.0, epsilon = 1e-10);
}

#[test]
fn z_h_z_chain_with_boundaries_is_z_h_z_matrix() {
    // output₁ → z1 → h → z2 → output₂.
    //
    // z1 (degree 2: one leg to boundary, one to h): arity 2 → Z(α).
    // h  (degree 2): arity 2 → H.
    // z2 (degree 2: one leg to h, one to boundary): arity 2 → Z(0) = I.
    //
    // The two boundary legs become the two open axes of the result
    // (output₁ = input side of z1, output₂ = output side of z2).
    // Result shape [2, 2] = the matrix Z(α) · H · I = Z(α) · H.
    //
    // For α = π/2:
    //   Z(π/2) = [[1, 0], [0, i]]
    //   H = (1/√2) [[1, 1], [1, -1]]
    //   Z(π/2) · H = (1/√2) [[1·1 + 0·1, 1·1 + 0·(-1)],
    //                       [0·1 + i·1, 0·1 + i·(-1)]]
    //             = (1/√2) [[1, 1], [i, -i]]
    let json = r#"{
        "nodes": [
            {"id":"o1","data":{"label":"","vertexType":"output"}},
            {"id":"z1","data":{"label":"\\pi/2","vertexType":"z"}},
            {"id":"h","data":{"label":"","vertexType":"h"}},
            {"id":"z2","data":{"label":"","vertexType":"z"}},
            {"id":"o2","data":{"label":"","vertexType":"output"}}
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
    // Both boundaries are `output`, so input_count = 0, output_count = 2.
    assert_eq!(r.input_count, 0);
    assert_eq!(r.output_count, 2);

    let inv_sqrt2 = std::f64::consts::FRAC_1_SQRT_2;
    // Expected (1/√2) [[1, 1], [i, -i]] in row-major order.
    let expected = [
        (inv_sqrt2, 0.0),       // (0,0) = 1/√2
        (inv_sqrt2, 0.0),       // (0,1) = 1/√2
        (0.0, inv_sqrt2),       // (1,0) = i/√2
        (0.0, -inv_sqrt2),      // (1,1) = -i/√2
    ];
    assert_data(&r.data, &expected);
}

// ---- Closed-graph scalars --------------------------------------------------

#[test]
fn fully_contracted_two_z_spiders_scalar_is_two_plus_one() {
    // Two Z spiders, each arity 2 (degree 2), connected by 2 edges.
    // Both legs of each are contracted → no open legs → scalar.
    //
    // z1(φ=0) = [[1,0],[0,1]] = I,  z2(φ=0) = I.
    // Inner product ⟨z1, z2⟩ with both legs contracted = trace of I·Iᵀ
    // counted twice... the closed form for a 2-edge-2-vertex graph:
    //   Σ_{a,b} z1[a,b] · z2[a,b] = 1·1 + 1·1 = 2.
    // (Each spider contributes 1 at (0,0) and 1 at (1,1).)
    let json = r#"{
        "nodes": [
            {"id":"z1","data":{"label":"","vertexType":"z"}},
            {"id":"z2","data":{"label":"","vertexType":"z"}}
        ],
        "edges": [
            {"id":"e1","source":"z1","target":"z2"},
            {"id":"e2","source":"z1","target":"z2"}
        ]
    }"#;
    let r = compute(json);
    assert_eq!(r.shape, Vec::<usize>::new());
    // Hand-derived: z1 has entries {(0,0):1, (1,1):1}; z2 same. Contract
    // two pairs of legs → Σ_{a,b} z1[a,b]·z2[a,b] = 1·1 + 1·1 = 2.
    assert_relative_eq!(r.data[0].0, 2.0, epsilon = 1e-10);
    assert_relative_eq!(r.data[0].1, 0.0, epsilon = 1e-10);
}

#[test]
fn fully_contracted_z_pi_cancels_to_zero() {
    // Same as above but z1 has phase π → z1 = [[1,0],[0,-1]]. The two
    // contributions cancel: 1·1 + (-1)·1 = 0.
    let json = r#"{
        "nodes": [
            {"id":"z1","data":{"label":"\\pi","vertexType":"z"}},
            {"id":"z2","data":{"label":"","vertexType":"z"}}
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
    // 1 Z spider with phase φ, one self-loop edge. Degree = 2 (self-loop
    // counts twice), so arity 2 → z_spider(2, φ) = [[1,0],[0,e^{iφ}]].
    // Trace over both axes = 1 + e^{iφ}.
    //
    // For φ = π/2: 1 + i.
    let json = r#"{
        "nodes": [
            {"id":"z","data":{"label":"\\pi/2","vertexType":"z"}}
        ],
        "edges": [
            {"id":"self","source":"z","target":"z"}
        ]
    }"#;
    let r = compute(json);
    assert_eq!(r.shape, Vec::<usize>::new());
    // 1 + e^{iπ/2} = 1 + i.
    assert_relative_eq!(r.data[0].0, 1.0, epsilon = 1e-10);
    assert_relative_eq!(r.data[0].1, 1.0, epsilon = 1e-10);
}

// ---- Boundary handling -----------------------------------------------------

#[test]
fn boundary_degree_2_rejected() {
    // 1 output + 2 edges to two Z spiders → output has degree 2 → error.
    let json = r#"{
        "nodes": [
            {"id":"o","data":{"label":"","vertexType":"output"}},
            {"id":"z1","data":{"label":"","vertexType":"z"}},
            {"id":"z2","data":{"label":"","vertexType":"z"}}
        ],
        "edges": [
            {"id":"e1","source":"z1","target":"o"},
            {"id":"e2","source":"z2","target":"o"}
        ]
    }"#;
    let err = compute_err(json);
    match err {
        ComputeError::BoundaryDegreeViolation { vertex_id, degree } => {
            assert_eq!(vertex_id, "o");
            assert_eq!(degree, 2);
        }
        other => panic!("expected BoundaryDegreeViolation, got {other:?}"),
    }
}

#[test]
fn hbox_wrong_arity_rejected() {
    // H-box with degree 3 → error.
    let json = r#"{
        "nodes": [
            {"id":"h","data":{"label":"","vertexType":"h"}},
            {"id":"a","data":{"label":"","vertexType":"z"}},
            {"id":"b","data":{"label":"","vertexType":"z"}},
            {"id":"c","data":{"label":"","vertexType":"z"}}
        ],
        "edges": [
            {"id":"e1","source":"a","target":"h"},
            {"id":"e2","source":"b","target":"h"},
            {"id":"e3","source":"c","target":"h"}
        ]
    }"#;
    let err = compute_err(json);
    match err {
        ComputeError::HBoxArity { vertex_id, arity } => {
            assert_eq!(vertex_id, "h");
            assert_eq!(arity, 3);
        }
        other => panic!("expected HBoxArity, got {other:?}"),
    }
}

#[test]
fn input_output_counts_flow_through() {
    // input → z → output. Z spider has degree 2 (one leg to input, one
    // to output), so it contracts to a scalar — but the two boundary
    // legs remain as open axes of the result. Final shape [2,2]
    // (input axis first, output axis second), with the boundary tags.
    let json = r#"{
        "nodes": [
            {"id":"in","data":{"label":"","vertexType":"input"}},
            {"id":"z","data":{"label":"","vertexType":"z"}},
            {"id":"out","data":{"label":"","vertexType":"output"}}
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
    // z_spider(2, 0) = I = [[1,0],[0,1]]. The boundary legs are the
    // spider's two legs; no contraction happens, so the result is the
    // identity matrix with input-axis as rows, output-axis as cols.
    assert_data(&r.data, &[(1.0, 0.0), (0.0, 0.0), (0.0, 0.0), (1.0, 0.0)]);
}

// ---- Disconnected components -----------------------------------------------

#[test]
fn disconnected_components_outer_producted() {
    // 2 isolated Z spiders, no edges. Each has degree 0 → arity 0 →
    // scalar z_spider(0, φ) = 1 + e^{iφ}. For φ=0 each is 1+1=2.
    // Result: outer product of two scalars = product = 2·2 = 4.
    let json = r#"{
        "nodes": [
            {"id":"a","data":{"label":"","vertexType":"z"}},
            {"id":"b","data":{"label":"","vertexType":"z"}}
        ],
        "edges": []
    }"#;
    let r = compute(json);
    assert_eq!(r.shape, Vec::<usize>::new()); // scalars × scalars = scalar
    assert_relative_eq!(r.data[0].0, 4.0, epsilon = 1e-10);
}

#[test]
fn dangling_boundary_contributes_identity_axis() {
    // A single `input` with no edges → degree 0 → dangling. Contributes
    // a length-2 identity tensor [1, 0] as an open axis. Result shape
    // [2], input_count = 1.
    let json = r#"{
        "nodes": [
            {"id":"in","data":{"label":"","vertexType":"input"}}
        ],
        "edges": []
    }"#;
    let r = compute(json);
    assert_eq!(r.shape, vec![2]);
    assert_eq!(r.input_count, 1);
    assert_eq!(r.output_count, 0);
    assert_data(&r.data, &[(1.0, 0.0), (0.0, 0.0)]);
}
