// crates/zxw/tests/contraction_edge_cases.rs
//
// Edge-case probe suite for `compute_tensor` (plan §5.6). Each test
// targets ONE behavior — self-loop bookkeeping, boundary-degree rules,
// H-box arity rejection, disconnected-component outer-producting,
// malformed-graph defenses, etc. — and is named for that behavior.
//
// Hand-derived expected values are commented inline. Where the spec's
// stated value disagrees with the math, the test asserts the *correct*
// math and the discrepancy is flagged in the report (NOT fixed here).
//
// Conventions mirror `tests/contraction.rs` exactly: JSON graph
// literals, the re-declared `compute` / `compute_err` / `assert_data`
// helpers, `approx::assert_relative_eq!` for floats.

use approx::assert_relative_eq;
use std::cell::RefCell;
use zxw::{compute_tensor, ComputeError, FrontendGraphSlice};

/// Helper: parse a JSON graph payload, run `compute_tensor`, return the
/// `TensorResult`. Panics on parse or compute errors so test bodies
/// stay focused on values.
fn compute(json: &str) -> zxw::TensorResult {
    let graph: FrontendGraphSlice = serde_json::from_str(json).expect("test graph JSON must parse");
    compute_tensor(&graph, None).expect("compute_tensor should succeed")
}

/// Helper: like `compute`, but expects a `ComputeError`. Returns it so
/// the test can assert on the variant.
fn compute_err(json: &str) -> ComputeError {
    let graph: FrontendGraphSlice = serde_json::from_str(json).expect("test graph JSON must parse");
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
        let _ = i;
    }
}

// ============================================================================
// 1. Direct boundary-to-boundary edge (CONFIRMED BUG — kept green via #[ignore])
// ============================================================================

#[test]
fn boundary_to_boundary_edge_is_rejected_not_panicked() {
    // An edge directly connecting an `input` to an `output`, no tensor
    // vertex between them. Both endpoints are degree-1 boundaries, which
    // the boundary-degree rule (deg ≤ 1) explicitly ALLOWS — so the graph
    // passes the per-vertex checks. But an edge between two boundaries
    // has no tensor to contract, so the edge-walk used to take the
    // `src_is_boundary || tgt_is_boundary` branch, pick `tensor_id` = the
    // other boundary, and PANIC looking up a group that was never created.
    //
    // Fixed contract: surface it as a structured `BoundaryToBoundaryEdge`
    // error rather than guess a semantics (identity wire? zero matrix?).
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
// 2. Single z-spider, degree 0, phase π/2 → scalar 1+i (pinned)
// ============================================================================

#[test]
fn isolated_z_spider_phase_pi_over_2_is_one_plus_i() {
    // Degree 0 → arity 0 → scalar 1 + e^{iφ}. For φ = π/2: 1 + i.
    // (Existing test covers π and 0; this pins π/2 explicitly so the
    // imaginary half of the value is exercised.)
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
    // One z-spider, one self-loop → degree 2 → arity 2 → z_spider(2, π)
    // = diag(1, -1). Trace = 1 + (-1) = 0.
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
    // Same shape as above, φ = π/2 → trace = 1 + i.
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
// 4. Two self-loops on one vertex → double trace = 1 + e^{iφ}
// ============================================================================
//
// SPEC NOTE: the brief says "1 + e^{2iφ}". That derivation is WRONG.
// Correct math:
//   z_spider(4, φ): non-zero only at [0,0,0,0]=1 and [1,1,1,1]=e^{iφ}.
//   The contraction code traces axes (3,2) first then (1,0) (it pops
//   the two highest-indexed free legs each iteration).
//   trace over (3,2): result[i,j] = T[i,j,0,0] + T[i,j,1,1].
//     Non-zero only at (i,j)=(0,0)→1 and (1,1)→e^{iφ} → still z_spider(2,φ).
//   trace over (1,0): 1 + e^{iφ}.
// So the answer is 1 + e^{iφ}, NOT 1 + e^{2iφ}. (The "e^{2iφ}" in the
// brief seems to come from multiplying the two e^{iφ} factors together,
// but a trace is a SUM over the diagonal, not a product.) This test
// asserts the CORRECT value and flags the spec error in the report.

#[test]
fn two_self_loops_z_spider_phase_zero_is_two() {
    // z_spider(4, 0) double-traced → 1 + e^{0} = 2.
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
    // z_spider(4, π) double-traced → 1 + e^{iπ} = 1 + (-1) = 0.
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
    // z1 has: one self-loop (consumes 2 legs) + one regular edge to z2
    // (consumes 1 leg on each side). z1 degree = 3 → arity 3.
    // z2 has: one regular edge to z1 (consumes 1 leg) + one boundary
    // (consumes 1 leg). z2 degree = 2 → arity 2.
    //
    // After: z1's self-loop traces 2 of its 3 legs → 1 free leg remains
    // (a Neutral one). The regular edge contracts z1's last free leg with
    // one of z2's legs. z2's other leg is the boundary (output). Result
    // shape [2], output_count = 1.
    //
    // z1 = z_spider(3, 0): non-zero at [0,0,0]=1 and [1,1,1]=1.
    //   trace over (2,1): result[i] = T[i,0,0] + T[i,1,1]
    //     = (i=0: 1 + 0) , (i=1: 0 + 1) = [1, 1].
    // z2 = z_spider(2, 0): diag(1,1).
    // contract z1_result[leg0] with z2[leg0]: result[z2_leg1]
    //   = Σ_k z1_result[k] · z2[k, z2_leg1]
    //   = z1_result[0]·z2[0, z2_leg1] + z1_result[1]·z2[1, z2_leg1]
    //   z2 = diag(1,1), so this = z1_result[z2_leg1] = [1, 1].
    // Result vector (one output axis): [1, 1].
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
// 6. Self-loop on a boundary vertex → BoundaryDegreeViolation
// ============================================================================

#[test]
fn self_loop_on_output_boundary_is_rejected() {
    // An `output` with one self-loop. Self-loop counts as degree 2 (it
    // consumes two legs), and boundaries must have degree ≤ 1, so this
    // must surface as BoundaryDegreeViolation { degree: 2 }.
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
// 6b. Self-loop on an arity-0 builder (empty) — arity/rank mismatch guard
// ============================================================================
//
// `empty()` ignores its `arity` argument and always returns a rank-0
// scalar (1). Normally empty has degree 0 (no legs), so rank == degree
// and the contraction layer's `free_axes` bookkeeping (one entry per leg)
// lines up. But a self-loop pushes empty's degree to 2 while the tensor
// stays rank 0 — the `trace` over two non-existent axes then panics
// inside `Tensor::trace` (`tensor.rs:158`, indexing `a.shape()[1]` on a
// 0-dim array).
//
// Fixed contract: the rank/degree mismatch is caught at build time and
// surfaced as `DegreeOverflow` (semantically "more edges than tensor
// legs") instead of panicking downstream. The same guard would catch any
// future arity-ignoring builder wired into a self-loop.

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
    // Isolated H-box (degree 0) → must reject with HBoxArity { arity: 0 }.
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
    // H-box with one edge to a z-spider → degree 1 → HBoxArity { arity: 1 }.
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
// 10. Boundary degree > 1 via multi-edge (parallel edges)
// ============================================================================

#[test]
fn boundary_degree_two_via_parallel_multi_edge_is_rejected() {
    // One `output` connected to one z-spider by TWO parallel edges.
    // The output's degree counts both edges → degree 2 → must reject
    // with BoundaryDegreeViolation { degree: 2 }.
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
// 11. Two parallel edges input → tensor → output (sanity compute)
// ============================================================================

#[test]
fn two_parallel_edges_through_tensor_with_boundaries_computes() {
    // input → z1 → (2 parallel edges) → z2 → output. z1 degree 3, z2
    // degree 3. Sanity: shape [2,2], input_count 1, output_count 1, all
    // entries finite. (Existing `z_z_parallel_path_multi_edge` test
    // covers this exact graph but does NOT check finiteness uniformly;
    // this pins it explicitly.)
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
// 12. Duplicate edge ids (different endpoints, same id string)
// ============================================================================

#[test]
fn duplicate_edge_ids_are_tolerated_by_compute() {
    // The wire format does not forbid two edges sharing an `id` string.
    // The compute layer indexes edges by POSITION in `graph.edges`, not
    // by id (ids are only carried on error variants for diagnostics), so
    // duplicate ids should compute normally. Graph: z1 — z2 — z3 with
    // both edges named "dup".
    //
    // Degree bookkeeping: z1 has degree 1 (one edge to z2), z2 has
    // degree 2 (edges to z1 and z3), z3 has degree 1. So:
    //   z1 = z_spider(1, 0) = [1, 1]
    //   z2 = z_spider(2, 0) = diag(1, 1)
    //   z3 = z_spider(1, 0) = [1, 1]
    // Contract z1·z2 over one leg: result[j] = Σ_k z1[k]·z2[k,j]
    //   = 1·δ_{0,j} + 1·δ_{1,j} = [1, 1]  (arity 1).
    // Contract result·z3: scalar = Σ_k result[k]·z3[k] = 1·1 + 1·1 = 2.
    // All legs consumed → scalar 2.
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
    // An empty string is a legal `String`; the compute layer uses ids
    // only as HashMap keys and for error diagnostics, both of which
    // accept "". So a graph with one z-spider whose id is "" should
    // compute like any other isolated z-spider (scalar 2 for phase 0).
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
//
// SPEC NOTE: the brief suspects this is a bug where the second node
// clobbers the first in the `node_index` HashMap (true) and asks us to
// "surface it". Reading contraction.rs:139-145, the `node_index` map is
// built by inserting in `graph.nodes` order, so the LAST node with a
// given id wins. BUT the `degree` map, the union-find, the `groups` map,
// and the `id_to_order`/`order_to_id` vectors are ALL keyed by *index*
// (node_order), not by id — so the second node still gets its own slot
// in those structures. The net effect: an edge to id "z" resolves via
// `node_index` to the SECOND node's (order, type, label), but the
// union-find/group machinery treats both nodes as independent vertices.
//
// This is INCOHERENT (the lookup says one thing, the bookkeeping says
// another) and can produce wrong results silently. This test pins the
// current behavior — two z-spiders both named "z", fully contracted
// — so a future fix surfaces as a test diff. The test asserts the
// *expected* correct behavior (scalar = 2, the contraction of two
// isolated z_spider(0,0)=2 spiders outer-producted → 4) and is marked
// `#[ignore]` since current behavior diverges; see report for details.

#[test]
fn duplicate_node_id_is_rejected_not_silently_clobbered() {
    // Two z-spiders BOTH with id "z". Node ids are the graph's identity
    // contract — the union-find, the `groups` map, and the `node_index`
    // lookup all key on `id`. A duplicate used to silently clobber the
    // first in the HashMap while the union-find still tracked both by
    // index, leaving the data structures incoherent and returning a
    // wrong, smaller result (scalar 2 instead of 4) with no error.
    //
    // Fixed contract: reject as `DuplicateNodeId` up front, before any
    // tensor is built. (The frontend generates ids via `nanoid`, so this
    // is defense against a corrupt payload — but defense that fails
    // loudly instead of silently.)
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
// 15. z-spider ── x-spider with one boundary leg each → 2×2 matrix
// ============================================================================
//
// Graph: input → z(φ=0) → x(φ=0) → output.
//   z(2, 0) = diag(1, 1) — the "copy" tensor in the Z basis.
//   x(2, 0) = z(2,0) with H applied to each leg = H·diag(1,1)·H per the
//             basis-change rule = (1/2)·[[1,1],[1,1]] per leg... actually
//             x_spider is z_spider with H applied to EACH axis:
//               x[*,*] = Σ_{a,b} H[*,a]·z[a,b]·H[b,*].
//             For z = diag(1,1): x[i,j] = Σ_a H[i,a]·(Σ_b z[a,b]·H[b,j])
//                                          = Σ_a H[i,a]·H[a,j]   (since z[a,b]=δ_ab·1)
//                                          = (H·H)[i,j] = I[i,j] (H is self-inverse)
//             So x(2, 0) = the 2×2 identity! That makes the chain
//             z(2,0)·x(2,0) = I·I = I, and the boundary legs become the
//             two open axes → result is the 2×2 identity matrix.
//
// Sanity hand-check via the contract path: z has legs (in, mid1);
// x has legs (mid2, out). The internal edge contracts z[*,mid1] with
// x[mid2,*] (mid1 == mid2 = the contracted index k). Result:
//   M[in, out] = Σ_k z[in, k] · x[k, out] = Σ_k δ_{in,k} · δ_{k,out}
//              = δ_{in,out} = identity.

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
    // A self-loop is exactly one edge in `graph.edges`, so the edge-walk
    // runs one iteration and the callback fires once with (1, 1).
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
    // Each isolated z_spider(0, 0) = 1 + e^0 = 2. Three of them
    // outer-producted → 2 · 2 · 2 = 8.
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
    // Two `input` boundaries, no edges, no tensor vertices. Each is
    // degree-0 → dangling → contributes one open axis of value [1, 0].
    // Outer-producting the two gives shape [2, 2], input_count = 2,
    // data = [1, 0, 0, 0] (only the (0,0) entry is non-zero — both
    // axes are in the |0⟩ state).
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
    // One dangling input + one dangling output. input_count = 1,
    // output_count = 1, shape [2, 2] (input axis first per §5.4),
    // data = [1, 0, 0, 0].
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
// 19. ComputeError variants carry correct fields (systematic)
// ============================================================================

#[test]
fn vertex_not_found_error_carries_offending_vertex_and_edge_ids() {
    // VertexNotFound { vertex_id, edge_id }: both fields must match the
    // offending payload exactly. Source-side miss.
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
    // Target-side miss: the variant's `vertex_id` must be the *target*
    // (the one not in nodes), not the source.
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
    // HBoxArity { vertex_id, arity }: degree 5 H-box. arity must equal 5.
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
    // BoundaryDegreeViolation { vertex_id, degree }: an output with 3
    // distinct spider neighbours → degree 3.
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
    // Same variant, but on an `input` (not `output`) boundary, to pin
    // that the field carries the actual boundary id, not a hardcoded
    // "output" string.
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
