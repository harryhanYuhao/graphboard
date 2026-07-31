// crates/zxw/tests/contraction_edge_cases.rs
//
// Edge-case probes for `compute_tensor`. Each test pins ONE behavior
// (self-loop bookkeeping, boundary-degree rules, H-box arity rejection,
// disconnected-component outer-producting, malformed-graph defenses) and
// is named for it. Expected values are noted inline; where spec and
// math disagree, the test asserts the correct math. Conventions mirror
// `tests/contraction.rs`.

use approx::assert_relative_eq;
use std::cell::RefCell;
use zxw::{compute_tensor, ComputeError, FrontendGraphSlice};

/// Parse JSON, run `compute_tensor`, return the result. Panics on error.
fn compute(json: &str) -> zxw::TensorResult {
    let graph: FrontendGraphSlice = serde_json::from_str(json).expect("test graph JSON must parse");
    compute_tensor(&graph, None).expect("compute_tensor should succeed")
}

/// Like `compute`, but expects a `ComputeError`.
fn compute_err(json: &str) -> ComputeError {
    let graph: FrontendGraphSlice = serde_json::from_str(json).expect("test graph JSON must parse");
    compute_tensor(&graph, None).expect_err("compute_tensor should error")
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
        let _ = i;
        assert_relative_eq!(a.0, e.0, epsilon = 1e-10);
        assert_relative_eq!(a.1, e.1, epsilon = 1e-10);
    }
}

// ============================================================================
// 1. Direct boundary-to-boundary edge
// ============================================================================

#[test]
fn boundary_to_boundary_edge_is_rejected_not_panicked() {
    // An edge directly joining input↔output (no tensor vertex between them)
    // has no tensor to contract. Surfaces as a structured
    // `BoundaryToBoundaryEdge` error rather than guessing a semantics.
    let json = r#"{
        "nodes": [
            {"id":"in","data":{"label":"","vertexType":"input"}},
            {"id":"out","data":{"label":"","vertexType":"output"}}
        ],
        "edges": [
            {"id":"e1","source":"in","target":"out"}
        ]
    }"#;
    let err = compute_err(json);
    match err {
        ComputeError::BoundaryToBoundaryEdge { edge_id, from, to } => {
            assert_eq!(edge_id, "e1");
            assert_eq!(from, "in");
            assert_eq!(to, "out");
        }
        other => panic!("expected BoundaryToBoundaryEdge, got {other:?}"),
    }
}

// ============================================================================
// 2. Isolated z-spider, phase π/2 → scalar 1+i
// ============================================================================

#[test]
fn isolated_z_spider_phase_pi_over_2_is_one_plus_i() {
    // Degree 0 → scalar 1 + e^{iπ/2} = 1 + i. (Sibling test covers π and 0.)
    let json = r#"{
        "nodes": [{"id":"z","data":{"label":"\\pi/2","vertexType":"z"}}],
        "edges": []
    }"#;
    let r = compute(json);
    assert_eq!(r.shape, Vec::<usize>::new());
    assert_relative_eq!(r.data[0].0, 1.0, epsilon = 1e-10);
    assert_relative_eq!(r.data[0].1, 1.0, epsilon = 1e-10);
}

// ============================================================================
// 3. Self-loop on an isolated vertex → trace = 1 + e^{iφ}
// ============================================================================

#[test]
fn self_loop_z_spider_phase_pi_is_zero() {
    // Self-loop → arity 2 → trace = 1 + e^{iπ} = 0.
    let json = r#"{
        "nodes": [{"id":"z","data":{"label":"\\pi","vertexType":"z"}}],
        "edges": [{"id":"s","source":"z","target":"z"}]
    }"#;
    let r = compute(json);
    assert_eq!(r.shape, Vec::<usize>::new());
    assert_relative_eq!(r.data[0].0, 0.0, epsilon = 1e-10);
    assert_relative_eq!(r.data[0].1, 0.0, epsilon = 1e-10);
}

#[test]
fn self_loop_z_spider_phase_pi_over_2_is_one_plus_i() {
    // Same shape, φ=π/2 → trace = 1 + i.
    let json = r#"{
        "nodes": [{"id":"z","data":{"label":"\\pi/2","vertexType":"z"}}],
        "edges": [{"id":"s","source":"z","target":"z"}]
    }"#;
    let r = compute(json);
    assert_eq!(r.shape, Vec::<usize>::new());
    assert_relative_eq!(r.data[0].0, 1.0, epsilon = 1e-10);
    assert_relative_eq!(r.data[0].1, 1.0, epsilon = 1e-10);
}

// ============================================================================
// 4. Two self-loops on one vertex → 1 + e^{iφ} (NOT 1 + e^{2iφ})
// ============================================================================
//
// Double-tracing z_spider(4, φ) (trace sums the diagonal, not multiplies)
// yields 1 + e^{iφ} — a trace is a sum over the diagonal, not a product.

#[test]
fn two_self_loops_z_spider_phase_zero_is_two() {
    // z_spider(4, 0) double-traced → 1 + 1 = 2.
    let json = r#"{
        "nodes": [{"id":"z","data":{"label":"","vertexType":"z"}}],
        "edges": [
            {"id":"s1","source":"z","target":"z"},
            {"id":"s2","source":"z","target":"z"}
        ]
    }"#;
    let r = compute(json);
    assert_eq!(r.shape, Vec::<usize>::new());
    assert_relative_eq!(r.data[0].0, 2.0, epsilon = 1e-10);
    assert_relative_eq!(r.data[0].1, 0.0, epsilon = 1e-10);
}

#[test]
fn two_self_loops_z_spider_phase_pi_is_zero() {
    // z_spider(4, π) double-traced → 1 + (-1) = 0.
    let json = r#"{
        "nodes": [{"id":"z","data":{"label":"\\pi","vertexType":"z"}}],
        "edges": [
            {"id":"s1","source":"z","target":"z"},
            {"id":"s2","source":"z","target":"z"}
        ]
    }"#;
    let r = compute(json);
    assert_eq!(r.shape, Vec::<usize>::new());
    assert_relative_eq!(r.data[0].0, 0.0, epsilon = 1e-10);
    assert_relative_eq!(r.data[0].1, 0.0, epsilon = 1e-10);
}

// ============================================================================
// 5. Self-loop + regular edge mix → no double-counting of legs
// ============================================================================

#[test]
fn self_loop_plus_regular_edge_consumes_correct_leg_count() {
    // z1 (arity 3: self-loop traces 2 legs + 1 regular edge to z2) and
    // z2 (arity 2: regular edge to z1 + output). All φ=0. The
    // self-loop's trace on z1 leaves a [1,1] vector; contracting with
    // z2=I leaves the output axis → result [1, 1], shape [2].
    let json = r#"{
        "nodes": [
            {"id":"z1","data":{"label":"","vertexType":"z"}},
            {"id":"z2","data":{"label":"","vertexType":"z"}},
            {"id":"o","data":{"label":"","vertexType":"output"}}
        ],
        "edges": [
            {"id":"s","source":"z1","target":"z1"},
            {"id":"e","source":"z1","target":"z2"},
            {"id":"b","source":"z2","target":"o"}
        ]
    }"#;
    let r = compute(json);
    assert_eq!(r.shape, vec![2]);
    assert_eq!(r.output_count, 1);
    assert_eq!(r.input_count, 0);
    assert_data(&r.data, &[(1.0, 0.0), (1.0, 0.0)]);
}

// ============================================================================
// 6. Self-loop on a boundary → BoundaryDegreeViolation
// ============================================================================

#[test]
fn self_loop_on_output_boundary_is_rejected() {
    // A self-loop gives the boundary degree 2 (> 1) → rejection.
    let json = r#"{
        "nodes": [{"id":"o","data":{"label":"","vertexType":"output"}}],
        "edges": [{"id":"s","source":"o","target":"o"}]
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

// ============================================================================
// 6b. Self-loop on an arity-0 builder (empty) — rank/degree mismatch guard
// ============================================================================
//
// `empty()` is always rank-0; a self-loop pushes its degree to 2 while the
// tensor stays rank 0. The mismatch is caught at build time and surfaced as
// `DegreeOverflow` rather than panicking in `Tensor::trace`.

#[test]
fn self_loop_on_empty_node_is_rejected_not_panicked() {
    let json = r#"{
        "nodes": [{"id":"e","data":{"label":"","vertexType":"empty"}}],
        "edges": [{"id":"s","source":"e","target":"e"}]
    }"#;
    let err = compute_err(json);
    match err {
        ComputeError::DegreeOverflow {
            vertex_id,
            vertex_type,
            degree,
            max,
        } => {
            assert_eq!(vertex_id, "e");
            assert_eq!(vertex_type, zxw::VertexType::Empty);
            assert_eq!(degree, 2, "self-loop → degree 2");
            assert_eq!(max, 0, "empty() builder has rank 0");
        }
        other => panic!("expected DegreeOverflow, got {other:?}"),
    }
}

// ============================================================================
// 7-9. H-box arity violations: degree 0, 1, 4
// ============================================================================

#[test]
fn hbox_degree_zero_is_rejected_with_arity_zero() {
    // Isolated H-box (degree 0) → HBoxArity { arity: 0 }.
    let json = r#"{
        "nodes": [{"id":"h","data":{"label":"","vertexType":"h"}}],
        "edges": []
    }"#;
    let err = compute_err(json);
    match err {
        ComputeError::HBoxArity { vertex_id, arity } => {
            assert_eq!(vertex_id, "h");
            assert_eq!(arity, 0);
        }
        other => panic!("expected HBoxArity, got {other:?}"),
    }
}

#[test]
fn hbox_degree_one_is_rejected_with_arity_one() {
    // H-box with one edge → degree 1 → HBoxArity { arity: 1 }.
    let json = r#"{
        "nodes": [
            {"id":"h","data":{"label":"","vertexType":"h"}},
            {"id":"z","data":{"label":"","vertexType":"z"}}
        ],
        "edges": [{"id":"e","source":"h","target":"z"}]
    }"#;
    let err = compute_err(json);
    match err {
        ComputeError::HBoxArity { vertex_id, arity } => {
            assert_eq!(vertex_id, "h");
            assert_eq!(arity, 1);
        }
        other => panic!("expected HBoxArity, got {other:?}"),
    }
}

#[test]
fn hbox_degree_four_is_rejected_with_arity_four() {
    // H-box with four edges → degree 4 → HBoxArity { arity: 4 }.
    let json = r#"{
        "nodes": [
            {"id":"h","data":{"label":"","vertexType":"h"}},
            {"id":"a","data":{"label":"","vertexType":"z"}},
            {"id":"b","data":{"label":"","vertexType":"z"}},
            {"id":"c","data":{"label":"","vertexType":"z"}},
            {"id":"d","data":{"label":"","vertexType":"z"}}
        ],
        "edges": [
            {"id":"e1","source":"a","target":"h"},
            {"id":"e2","source":"b","target":"h"},
            {"id":"e3","source":"c","target":"h"},
            {"id":"e4","source":"d","target":"h"}
        ]
    }"#;
    let err = compute_err(json);
    match err {
        ComputeError::HBoxArity { vertex_id, arity } => {
            assert_eq!(vertex_id, "h");
            assert_eq!(arity, 4);
        }
        other => panic!("expected HBoxArity, got {other:?}"),
    }
}

// ============================================================================
// 10. Boundary degree > 1 via parallel edges
// ============================================================================

#[test]
fn boundary_degree_two_via_parallel_multi_edge_is_rejected() {
    // Two parallel edges to one output → degree counts both → 2 → reject.
    let json = r#"{
        "nodes": [
            {"id":"o","data":{"label":"","vertexType":"output"}},
            {"id":"z","data":{"label":"","vertexType":"z"}}
        ],
        "edges": [
            {"id":"e1","source":"z","target":"o"},
            {"id":"e2","source":"z","target":"o"}
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

// ============================================================================
// 11. Two parallel edges through a tensor (finite-value sanity)
// ============================================================================

#[test]
fn two_parallel_edges_through_tensor_with_boundaries_computes() {
    // input → z1 →(2 parallel)→ z2 → output. Sanity: shape [2,2] and every
    // entry finite (the sibling test doesn't check finiteness uniformly).
    let json = r#"{
        "nodes": [
            {"id":"i","data":{"label":"","vertexType":"input"}},
            {"id":"z1","data":{"label":"","vertexType":"z"}},
            {"id":"z2","data":{"label":"","vertexType":"z"}},
            {"id":"o","data":{"label":"","vertexType":"output"}}
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
    for (re, im) in &r.data {
        assert!(re.is_finite(), "re not finite: {re}");
        assert!(im.is_finite(), "im not finite: {im}");
    }
}

// ============================================================================
// 12. Duplicate edge ids (same id string, different endpoints)
// ============================================================================

#[test]
fn duplicate_edge_ids_are_tolerated_by_compute() {
    // The compute layer indexes edges by POSITION, not id (ids only ride
    // on error variants), so duplicate ids compute normally. Chain
    // z1 — z2 — z3 with both edges named "dup" → fully contracted scalar 2.
    let json = r#"{
        "nodes": [
            {"id":"z1","data":{"label":"","vertexType":"z"}},
            {"id":"z2","data":{"label":"","vertexType":"z"}},
            {"id":"z3","data":{"label":"","vertexType":"z"}}
        ],
        "edges": [
            {"id":"dup","source":"z1","target":"z2"},
            {"id":"dup","source":"z2","target":"z3"}
        ]
    }"#;
    let r = compute(json);
    assert_eq!(r.shape, Vec::<usize>::new());
    assert_eq!(r.input_count, 0);
    assert_eq!(r.output_count, 0);
    assert_relative_eq!(r.data[0].0, 2.0, epsilon = 1e-10);
}

// ============================================================================
// 13. Empty-string node id
// ============================================================================

#[test]
fn empty_string_node_id_computes_normally() {
    // "" is a legal id (HashMap key + diagnostics both accept it). An
    // isolated z-spider named "" computes like any other → scalar 2.
    let json = r#"{
        "nodes": [{"id":"","data":{"label":"","vertexType":"z"}}],
        "edges": []
    }"#;
    let r = compute(json);
    assert_eq!(r.shape, Vec::<usize>::new());
    assert_relative_eq!(r.data[0].0, 2.0, epsilon = 1e-10);
}

// ============================================================================
// 14. Duplicate node ids (two nodes share an id)
// ============================================================================

#[test]
fn duplicate_node_id_is_rejected_not_silently_clobbered() {
    // Node id is the graph's identity contract (union-find, `groups`,
    // `node_index` all key on it). A duplicate is rejected up front as
    // `DuplicateNodeId` rather than silently clobbering the HashMap.
    let json = r#"{
        "nodes": [
            {"id":"z","data":{"label":"","vertexType":"z"}},
            {"id":"z","data":{"label":"","vertexType":"z"}}
        ],
        "edges": []
    }"#;
    let err = compute_err(json);
    match err {
        ComputeError::DuplicateNodeId { vertex_id } => {
            assert_eq!(vertex_id, "z");
        }
        other => panic!("expected DuplicateNodeId, got {other:?}"),
    }
}

// ============================================================================
// 15. z-spider ── x-spider with one boundary leg each → identity matrix
// ============================================================================
//
// input → z(0) → x(0) → output. Both legs of each are arity-2; x_spider is
// z_spider with H per leg, and for z=diag(1,1) that yields x(0)=I (H·H=I).
// So z·x = I·I = I, with the boundary legs as the two open axes.

#[test]
fn z_spider_to_x_spider_with_boundaries_is_identity_matrix() {
    let json = r#"{
        "nodes": [
            {"id":"i","data":{"label":"","vertexType":"input"}},
            {"id":"z","data":{"label":"","vertexType":"z"}},
            {"id":"x","data":{"label":"","vertexType":"x"}},
            {"id":"o","data":{"label":"","vertexType":"output"}}
        ],
        "edges": [
            {"id":"e1","source":"i","target":"z"},
            {"id":"e2","source":"z","target":"x"},
            {"id":"e3","source":"x","target":"o"}
        ]
    }"#;
    let r = compute(json);
    assert_eq!(r.shape, vec![2, 2]);
    assert_eq!(r.input_count, 1);
    assert_eq!(r.output_count, 1);
    assert_data(&r.data, &[(1.0, 0.0), (0.0, 0.0), (0.0, 0.0), (1.0, 0.0)]);
}

// ============================================================================
// 16. on_progress fires once with (1,1) for a single self-loop
// ============================================================================

#[test]
fn on_progress_fires_once_with_one_one_for_single_self_loop() {
    // A self-loop is one edge in `graph.edges` → callback fires once (1, 1).
    let json = r#"{
        "nodes": [{"id":"z","data":{"label":"","vertexType":"z"}}],
        "edges": [{"id":"s","source":"z","target":"z"}]
    }"#;
    let graph: FrontendGraphSlice = serde_json::from_str(json).expect("test graph JSON must parse");
    let calls: RefCell<Vec<(usize, usize)>> = RefCell::new(Vec::new());
    let cb = |done: usize, total: usize| {
        calls.borrow_mut().push((done, total));
    };
    compute_tensor(&graph, Some(&cb)).expect("compute should succeed");
    let calls = calls.into_inner();
    assert_eq!(calls, vec![(1, 1)]);
}

// ============================================================================
// 17. Three disconnected z-spiders, all phase 0 → scalar 8
// ============================================================================

#[test]
fn three_disconnected_z_spiders_zero_phase_is_eight() {
    // Each isolated z(0) = 2; three outer-producted → 2·2·2 = 8.
    let json = r#"{
        "nodes": [
            {"id":"a","data":{"label":"","vertexType":"z"}},
            {"id":"b","data":{"label":"","vertexType":"z"}},
            {"id":"c","data":{"label":"","vertexType":"z"}}
        ],
        "edges": []
    }"#;
    let r = compute(json);
    assert_eq!(r.shape, Vec::<usize>::new());
    assert_relative_eq!(r.data[0].0, 8.0, epsilon = 1e-10);
}

// ============================================================================
// 18. Only boundary nodes, no tensor vertices
// ============================================================================

#[test]
fn two_dangling_inputs_outer_product_to_basis_state_tensor() {
    // Two dangling inputs each contribute a [1,0] axis → outer product
    // shape [2,2], only the (0,0) entry non-zero.
    let json = r#"{
        "nodes": [
            {"id":"i1","data":{"label":"","vertexType":"input"}},
            {"id":"i2","data":{"label":"","vertexType":"input"}}
        ],
        "edges": []
    }"#;
    let r = compute(json);
    assert_eq!(r.shape, vec![2, 2]);
    assert_eq!(r.input_count, 2);
    assert_eq!(r.output_count, 0);
    assert_data(&r.data, &[(1.0, 0.0), (0.0, 0.0), (0.0, 0.0), (0.0, 0.0)]);
}

#[test]
fn mixed_input_output_dangling_both_outer_product() {
    // Dangling input + dangling output → shape [2,2] (input axis first),
    // data [1, 0, 0, 0].
    let json = r#"{
        "nodes": [
            {"id":"i","data":{"label":"","vertexType":"input"}},
            {"id":"o","data":{"label":"","vertexType":"output"}}
        ],
        "edges": []
    }"#;
    let r = compute(json);
    assert_eq!(r.shape, vec![2, 2]);
    assert_eq!(r.input_count, 1);
    assert_eq!(r.output_count, 1);
    assert_data(&r.data, &[(1.0, 0.0), (0.0, 0.0), (0.0, 0.0), (0.0, 0.0)]);
}

// ============================================================================
// 19. ComputeError variants carry correct fields
// ============================================================================

#[test]
fn vertex_not_found_error_carries_offending_vertex_and_edge_ids() {
    // Source-side miss: both vertex_id and edge_id must match the payload.
    let json = r#"{
        "nodes": [{"id":"z","data":{"label":"","vertexType":"z"}}],
        "edges": [{"id":"edge-X","source":"missing","target":"z"}]
    }"#;
    let err = compute_err(json);
    match err {
        ComputeError::VertexNotFound { vertex_id, edge_id } => {
            assert_eq!(vertex_id, "missing");
            assert_eq!(edge_id, "edge-X");
        }
        other => panic!("expected VertexNotFound, got {other:?}"),
    }
}

#[test]
fn vertex_not_found_target_side_carries_target_vertex_id() {
    // Target-side miss: `vertex_id` is the missing target, not the source.
    let json = r#"{
        "nodes": [{"id":"z","data":{"label":"","vertexType":"z"}}],
        "edges": [{"id":"e7","source":"z","target":"nope"}]
    }"#;
    let err = compute_err(json);
    match err {
        ComputeError::VertexNotFound { vertex_id, edge_id } => {
            assert_eq!(vertex_id, "nope");
            assert_eq!(edge_id, "e7");
        }
        other => panic!("expected VertexNotFound, got {other:?}"),
    }
}

#[test]
fn hbox_arity_error_carries_vertex_id_and_arity_field() {
    // H-box with degree 5 → arity must equal 5.
    let json = r#"{
        "nodes": [
            {"id":"h","data":{"label":"","vertexType":"h"}},
            {"id":"a","data":{"label":"","vertexType":"z"}},
            {"id":"b","data":{"label":"","vertexType":"z"}},
            {"id":"c","data":{"label":"","vertexType":"z"}},
            {"id":"d","data":{"label":"","vertexType":"z"}},
            {"id":"e","data":{"label":"","vertexType":"z"}}
        ],
        "edges": [
            {"id":"e1","source":"a","target":"h"},
            {"id":"e2","source":"b","target":"h"},
            {"id":"e3","source":"c","target":"h"},
            {"id":"e4","source":"d","target":"h"},
            {"id":"e5","source":"e","target":"h"}
        ]
    }"#;
    let err = compute_err(json);
    match err {
        ComputeError::HBoxArity { vertex_id, arity } => {
            assert_eq!(vertex_id, "h");
            assert_eq!(arity, 5);
        }
        other => panic!("expected HBoxArity, got {other:?}"),
    }
}

#[test]
fn boundary_degree_violation_carries_vertex_id_and_degree_field() {
    // An output with 3 spider neighbours → degree 3.
    let json = r#"{
        "nodes": [
            {"id":"o","data":{"label":"","vertexType":"output"}},
            {"id":"z1","data":{"label":"","vertexType":"z"}},
            {"id":"z2","data":{"label":"","vertexType":"z"}},
            {"id":"z3","data":{"label":"","vertexType":"z"}}
        ],
        "edges": [
            {"id":"e1","source":"z1","target":"o"},
            {"id":"e2","source":"z2","target":"o"},
            {"id":"e3","source":"z3","target":"o"}
        ]
    }"#;
    let err = compute_err(json);
    match err {
        ComputeError::BoundaryDegreeViolation { vertex_id, degree } => {
            assert_eq!(vertex_id, "o");
            assert_eq!(degree, 3);
        }
        other => panic!("expected BoundaryDegreeViolation, got {other:?}"),
    }
}

#[test]
fn input_boundary_degree_violation_uses_input_vertex_id() {
    // On an `input` boundary: field carries the real boundary id, not a
    // hardcoded "output" string.
    let json = r#"{
        "nodes": [
            {"id":"in","data":{"label":"","vertexType":"input"}},
            {"id":"z1","data":{"label":"","vertexType":"z"}},
            {"id":"z2","data":{"label":"","vertexType":"z"}}
        ],
        "edges": [
            {"id":"e1","source":"in","target":"z1"},
            {"id":"e2","source":"in","target":"z2"}
        ]
    }"#;
    let err = compute_err(json);
    match err {
        ComputeError::BoundaryDegreeViolation { vertex_id, degree } => {
            assert_eq!(vertex_id, "in");
            assert_eq!(degree, 2);
        }
        other => panic!("expected BoundaryDegreeViolation, got {other:?}"),
    }
}
