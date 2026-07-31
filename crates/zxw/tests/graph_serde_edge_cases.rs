// crates/zxw/tests/graph_serde_edge_cases.rs
//
// Edge-case probes for the `GraphSlice` serde contract (and the wasm
// compute-path functions under `--features wasm`). Mirrors graph_serde.rs
// but pins behaviors that file leaves implicit. Error-fragment matching
// uses a stable substring (serde's exact wording is unstable).

use zxw::{
    FrontendGraphEdgeRecord, FrontendGraphNodeRecord, FrontendGraphSlice, FrontendVertexData,
    VertexType,
};

// ---- small helpers ---------------------------------------------------------

/// Assert the JSON fails to deserialize, naming the expected error fragment.
#[track_caller]
fn assert_rejects(json: &str, fragment: &str) {
    let result: Result<FrontendGraphSlice, _> = serde_json::from_str(json);
    assert!(
        result.is_err(),
        "expected deserialization to fail (fragment: {fragment:?}), got: {result:?}"
    );
    let err = result.unwrap_err().to_string().to_lowercase();
    assert!(
        err.contains(&fragment.to_lowercase()),
        "error should mention {fragment:?}, got: {err}"
    );
}

/// Helper: assert the JSON deserializes as `GraphSlice`.
#[track_caller]
fn assert_accepts(json: &str) -> FrontendGraphSlice {
    serde_json::from_str::<FrontendGraphSlice>(json)
        .unwrap_or_else(|e| panic!("expected deserialization to succeed, got: {e}"))
}

// ============================================================================
// §1  Edge handle edge cases
// ============================================================================
//
// Handles are `Option<u32>` with `#[serde(default, skip_serializing_if =
// "Option::is_none")]`. The TS side only emits absent or 0/1; the rest
// here are robustness probes of the Rust deserializer.

// 1. Explicit `null` → `None` (serde short-circuits on null for Option<T>).
#[test]
fn explicit_null_handle_deserializes_as_none() {
    let json = r#"{
        "nodes": [{"id": "a", "data": {"label": "", "vertexType": "z"}}],
        "edges": [{"id": "e", "source": "a", "target": "a", "sourceHandle": null, "targetHandle": null}]
    }"#;
    let slice = assert_accepts(json);
    assert_eq!(slice.edges[0].source_handle, None);
    assert_eq!(slice.edges[0].target_handle, None);
}

// 2. String handle → rejected (u32 won't coerce from string).
#[test]
fn string_handle_value_is_rejected() {
    let json = r#"{"nodes": [], "edges": [{"id": "e", "source": "a", "target": "b", "sourceHandle": "0"}]}"#;
    assert_rejects(json, "u32");
}

// 3. `-1` → rejected. The field is `Option<u32>`, which rejects negatives
// at deserialize time (before the compute layer sees it).
#[test]
fn negative_handle_minus_one_is_rejected() {
    let json = r#"{"nodes": [], "edges": [{"id": "e", "source": "a", "target": "b", "sourceHandle": -1}]}"#;
    assert_rejects(json, "u32");
}

// 4. Above u32 range → rejected (overflow).
#[test]
fn handle_value_above_u32_max_is_rejected() {
    let json = r#"{"nodes": [], "edges": [{"id": "e", "source": "a", "target": "b", "sourceHandle": 4294967296}]}"#;
    assert_rejects(json, "u32");
}

// 5. Float handle → rejected (no silent truncation).
#[test]
fn fractional_handle_value_is_rejected() {
    let json = r#"{"nodes": [], "edges": [{"id": "e", "source": "a", "target": "b", "sourceHandle": 0.5}]}"#;
    assert_rejects(json, "u32");
}

// ============================================================================
// §2  VertexType case-sensitivity & spelling
// ============================================================================

// 6. `vertexType: "Z"` (uppercase). Lowercase-only per `rename_all =
// "lowercase"`; serde reports an "unknown variant" error.
#[test]
fn uppercase_vertex_type_z_is_rejected() {
    let json = r#"{"nodes": [{"id": "a", "data": {"label": "", "vertexType": "Z"}}], "edges": []}"#;
    assert_rejects(json, "unknown variant");
}

// 7. `vertexType: "ZBOX"` (all caps).
#[test]
fn all_caps_vertex_type_zbox_is_rejected() {
    let json =
        r#"{"nodes": [{"id": "a", "data": {"label": "", "vertexType": "ZBOX"}}], "edges": []}"#;
    assert_rejects(json, "unknown variant");
}

// 8. `vertexType: "z-box"` (with dash).
#[test]
fn dashed_vertex_type_is_rejected() {
    let json =
        r#"{"nodes": [{"id": "a", "data": {"label": "", "vertexType": "z-box"}}], "edges": []}"#;
    assert_rejects(json, "unknown variant");
}

// 9. `vertexType: "boundary"` (made-up type).
#[test]
fn fabricated_vertex_type_boundary_is_rejected() {
    let json =
        r#"{"nodes": [{"id": "a", "data": {"label": "", "vertexType": "boundary"}}], "edges": []}"#;
    assert_rejects(json, "unknown variant");
}

// 10. `vertexType: ""` (empty string).
#[test]
fn empty_string_vertex_type_is_rejected() {
    let json = r#"{"nodes": [{"id": "a", "data": {"label": "", "vertexType": ""}}], "edges": []}"#;
    assert_rejects(json, "unknown variant");
}

// 30. Case-sensitivity table for all 10 vertex types.
//
// graph_serde.rs covers the lowercase happy path; this pins that every
// uppercase/camelCase spelling is rejected.
#[test]
fn all_vertex_types_are_lowercase_only() {
    // (lowercase-valid, rejected spellings)
    let table: &[(&str, &[&str])] = &[
        ("z", &["Z", "Z-spider"]),
        ("empty", &["Empty", "EMPTY"]),
        ("x", &["X"]),
        ("w", &["W"]),
        ("h", &["H"]),
        ("zbox", &["Zbox", "ZBox", "ZBOX"]),
        ("xbox", &["Xbox", "XBox", "XBOX"]),
        ("and", &["And", "AND", "AND-gate"]),
        ("input", &["Input", "INPUT"]),
        ("output", &["Output", "OUTPUT"]),
    ];

    for (valid, rejected_spellings) in table {
        // Lowercase round-trips.
        let good = format!(
            r#"{{"nodes":[{{"id":"n","data":{{"label":"","vertexType":"{}"}}}}],"edges":[]}}"#,
            valid
        );
        assert_accepts(&good);

        // Every rejected spelling fails.
        for bad in *rejected_spellings {
            let json = format!(
                r#"{{"nodes":[{{"id":"n","data":{{"label":"","vertexType":"{}"}}}}],"edges":[]}}"#,
                bad
            );
            let result: Result<FrontendGraphSlice, _> = serde_json::from_str(&json);
            assert!(
                result.is_err(),
                "vertexType {:?} should be rejected (only {:?} is valid), got: {:?}",
                bad,
                valid,
                result
            );
        }
    }
}

// ============================================================================
// §3  `data` wrapper & field presence
// ============================================================================

// 11. Missing `data` wrapper (flat `{id, label, vertexType}`).
//
// Re-pinned here because the flat shape is the most likely accidental
// regression (a refactor flattening `data`).
#[test]
fn flat_node_without_data_wrapper_is_rejected() {
    let json = r#"{"nodes": [{"id": "x", "label": "hi", "vertexType": "z"}], "edges": []}"#;
    assert_rejects(json, "data");
}

// 12. `data: null` → rejected (struct field, not Option).
#[test]
fn null_data_wrapper_is_rejected() {
    let json = r#"{"nodes": [{"id": "a", "data": null}], "edges": []}"#;
    assert_rejects(json, "vertexdata");
}

// 13. `data: {}` → "missing field `label`" (first missing required field).
#[test]
fn empty_data_object_is_rejected() {
    let json = r#"{"nodes": [{"id": "a", "data": {}}], "edges": []}"#;
    assert_rejects(json, "missing field");
}

// 14. Extra field inside `data` → silently ignored (no deny_unknown_fields).
#[test]
fn extra_field_inside_data_is_ignored() {
    let json = r#"{"nodes": [{"id": "a", "data": {"label": "l", "vertexType": "z", "extra": 42}}], "edges": []}"#;
    let slice = assert_accepts(json);
    assert_eq!(slice.nodes[0].data.label, "l");
    assert_eq!(slice.nodes[0].data.vertex_type, VertexType::Z);
}

// 15. Extra field at node level → ignored (TS may carry `selected`, etc.).
#[test]
fn extra_field_at_node_level_is_ignored() {
    let json = r#"{"nodes": [{"id": "a", "data": {"label": "", "vertexType": "z"}, "selected": true, "position": {"x": 1, "y": 2}}], "edges": []}"#;
    let slice = assert_accepts(json);
    assert_eq!(slice.nodes[0].id, "a");
}

// 16. Missing `label` → rejected (empty string is valid, absent is not).
#[test]
fn missing_label_field_is_rejected() {
    let json = r#"{"nodes": [{"id": "a", "data": {"vertexType": "z"}}], "edges": []}"#;
    assert_rejects(json, "missing field `label`");
}

// 17. `label: null`.
#[test]
fn null_label_is_rejected() {
    let json =
        r#"{"nodes": [{"id": "a", "data": {"label": null, "vertexType": "z"}}], "edges": []}"#;
    assert_rejects(json, "expected a string");
}

// 18. `label: 123` (number not string).
#[test]
fn numeric_label_is_rejected() {
    let json =
        r#"{"nodes": [{"id": "a", "data": {"label": 123, "vertexType": "z"}}], "edges": []}"#;
    assert_rejects(json, "expected a string");
}

// ============================================================================
// §4  `id` field
// ============================================================================

// 19. `id: 123` (number not string).
#[test]
fn numeric_id_is_rejected() {
    let json = r#"{"nodes": [{"id": 123, "data": {"label": "", "vertexType": "z"}}], "edges": []}"#;
    assert_rejects(json, "expected a string");
}

// 20. `id: ""` → accepted (no non-empty validation at the type level;
// whether the compute layer handles an empty join key is its concern).
#[test]
fn empty_string_id_deserializes() {
    let json = r#"{"nodes": [{"id": "", "data": {"label": "", "vertexType": "z"}}], "edges": []}"#;
    let slice = assert_accepts(json);
    assert_eq!(slice.nodes[0].id, "");
}

// 21. Duplicate `id` → accepted (no uniqueness check at the type level;
// the compute layer may collide, but that's its concern).
#[test]
fn duplicate_node_ids_deserialize() {
    let json = r#"{"nodes": [
        {"id": "a", "data": {"label": "", "vertexType": "z"}},
        {"id": "a", "data": {"label": "", "vertexType": "x"}}
    ], "edges": []}"#;
    let slice = assert_accepts(json);
    assert_eq!(slice.nodes.len(), 2);
    assert_eq!(slice.nodes[0].id, "a");
    assert_eq!(slice.nodes[1].id, "a");
}

// ============================================================================
// §5  Whole-slice structural shape
// ============================================================================

// 22. Empty `nodes` with non-empty `edges` → deserializes fine (no
// cross-field validation; the compute layer raises VertexNotFound later).
#[test]
fn empty_nodes_with_edges_deserializes() {
    let json = r#"{"nodes": [], "edges": [{"id": "e", "source": "a", "target": "b"}]}"#;
    let slice = assert_accepts(json);
    assert!(slice.nodes.is_empty());
    assert_eq!(slice.edges.len(), 1);
}

// 23. `nodes` absent → rejected (Vec with no `#[serde(default)]`).
#[test]
fn missing_nodes_field_is_rejected() {
    let json = r#"{"edges": []}"#;
    assert_rejects(json, "missing field `nodes`");
}

// 24. `edges` absent → rejected (same reason).
#[test]
fn missing_edges_field_is_rejected() {
    let json = r#"{"nodes": []}"#;
    assert_rejects(json, "missing field `edges`");
}

// 25. Top-level JSON array → rejected (serde tries a struct-from-sequence).
#[test]
fn top_level_json_array_is_rejected() {
    let json = r#"[]"#;
    assert_rejects(json, "GraphSlice");
}

// 26. Top-level JSON scalars → rejected with an "invalid type" naming GraphSlice.
#[test]
fn top_level_json_integer_is_rejected() {
    assert_rejects("42", "GraphSlice");
}

#[test]
fn top_level_json_string_is_rejected() {
    assert_rejects(r#""hi""#, "GraphSlice");
}

#[test]
fn top_level_json_boolean_is_rejected() {
    assert_rejects("true", "GraphSlice");
}

// ============================================================================
// §6  String content round-trips
// ============================================================================

// 27. Empty `data.label` round-trips.
#[test]
fn empty_label_round_trips() {
    let json = r#"{"nodes": [{"id": "a", "data": {"label": "", "vertexType": "z"}}], "edges": []}"#;
    let slice = assert_accepts(json);
    assert_eq!(slice.nodes[0].data.label, "");
    let back = serde_json::to_string(&slice).unwrap();
    assert!(
        back.contains(r#""label":""#),
        "empty label must survive, got: {back}"
    );
}

// 28. Unicode in `id` (e.g. `"λ"`).
#[test]
fn unicode_id_round_trips_intact() {
    let json = r#"{"nodes": [{"id": "λ", "data": {"label": "", "vertexType": "z"}}], "edges": []}"#;
    let slice = assert_accepts(json);
    assert_eq!(slice.nodes[0].id, "λ");
    let back = serde_json::to_string(&slice).unwrap();
    let reparsed: FrontendGraphSlice = serde_json::from_str(&back).unwrap();
    assert_eq!(reparsed.nodes[0].id, "λ");
}

// 29. Very long label (10000 chars) → no truncation.
#[test]
fn very_long_label_round_trips_without_truncation() {
    let long = "x".repeat(10_000);
    let payload = format!(
        r#"{{"nodes":[{{"id":"a","data":{{"label":{},"vertexType":"z"}}}}],"edges":[]}}"#,
        serde_json::to_string(&long).unwrap()
    );
    let slice = assert_accepts(&payload);
    assert_eq!(slice.nodes[0].data.label.len(), 10_000);
    assert!(slice.nodes[0].data.label.chars().all(|c| c == 'x'));
}

// ============================================================================
// §7  Edge structural cases
// ============================================================================

// 31. `source == target` (self-loop) → accepted by serde; handles survive.
#[test]
fn self_loop_edge_deserializes() {
    let json = r#"{"nodes": [{"id": "a", "data": {"label": "", "vertexType": "z"}}], "edges": [{"id": "e", "source": "a", "target": "a", "sourceHandle": 0, "targetHandle": 1}]}"#;
    let slice = assert_accepts(json);
    assert_eq!(slice.edges[0].source, "a");
    assert_eq!(slice.edges[0].target, "a");
    assert_eq!(slice.edges[0].source_handle, Some(0));
    assert_eq!(slice.edges[0].target_handle, Some(1));
}

// 32. Serialization key order is stable (declaration order, not sorted).
//
// Pin the exact byte layout of a node/edge/slice so a field reorder is
// caught here; two structurally-identical slices re-serialize byte-identically.
#[test]
fn serialization_key_order_is_stable() {
    // Node: `id`, then `data` (`label`, then `vertexType`).
    let node = FrontendGraphNodeRecord {
        id: "z".into(),
        data: FrontendVertexData {
            label: "l".into(),
            vertex_type: VertexType::Z,
            order: None,
        },
    };
    assert_eq!(
        serde_json::to_string(&node).unwrap(),
        r#"{"id":"z","data":{"label":"l","vertexType":"z"}}"#
    );

    // Edge: `id`, `source`, `target`, then optional handles.
    let edge_with_handles = FrontendGraphEdgeRecord {
        id: "e".into(),
        source: "s".into(),
        target: "t".into(),
        source_handle: Some(0),
        target_handle: Some(1),
    };
    assert_eq!(
        serde_json::to_string(&edge_with_handles).unwrap(),
        r#"{"id":"e","source":"s","target":"t","sourceHandle":0,"targetHandle":1}"#
    );

    // Whole slice: `nodes`, then `edges`.
    let slice = FrontendGraphSlice {
        nodes: vec![],
        edges: vec![],
    };
    assert_eq!(
        serde_json::to_string(&slice).unwrap(),
        r#"{"nodes":[],"edges":[]}"#
    );

    // Two structurally-identical slices produce byte-identical output.
    let a = serde_json::to_string(&slice).unwrap();
    let b = serde_json::to_string(&FrontendGraphSlice {
        nodes: vec![],
        edges: vec![],
    })
    .unwrap();
    assert_eq!(a, b);
}

// 33. Round-trip an edge WITH handles — they must appear in output (the
// symmetric counterpart to the None case covered in graph_serde.rs).
#[test]
fn edge_with_handles_serializes_them() {
    let edge = FrontendGraphEdgeRecord {
        id: "e".into(),
        source: "s".into(),
        target: "t".into(),
        source_handle: Some(0),
        target_handle: Some(1),
    };
    let json = serde_json::to_string(&edge).unwrap();
    assert!(
        json.contains(r#""sourceHandle":0"#),
        "Some(0) handle must appear, got: {json}"
    );
    assert!(
        json.contains(r#""targetHandle":1"#),
        "Some(1) handle must appear, got: {json}"
    );

    // The round-trip preserves them.
    let back: FrontendGraphEdgeRecord = serde_json::from_str(&json).unwrap();
    assert_eq!(back.source_handle, Some(0));
    assert_eq!(back.target_handle, Some(1));
}

// ============================================================================
// §8  WASM compute-path logic (gated behind `--features wasm`)
// ============================================================================
//
// `#[wasm_bindgen]` only adds JS glue, so `ping` and `compute_api_version`
// are callable as plain Rust functions. `compute_tensor` takes `JsValue`
// and can't be tested without a JS runtime; its entry contract is covered
// indirectly by the serde_json tests in §1–§7.

#[cfg(feature = "wasm")]
mod wasm_tests {
    // 34. `ping()` returns "pong" (the frontend WASM health check).
    #[test]
    fn ping_returns_pong() {
        let s: String = zxw::wasm::ping();
        assert_eq!(s, "pong");
    }

    // 34b. `compute_api_version()` is driven by `env!("CARGO_PKG_VERSION")`.
    // Asserts the literal "0.1.0" too so a version bump surfaces here.
    #[test]
    fn compute_api_version_matches_crate_version() {
        let v: String = zxw::wasm::compute_api_version();
        assert_eq!(v, env!("CARGO_PKG_VERSION"));
        assert_eq!(v, "0.1.0");
    }

    // 35. The serde-wasm-bindgen boundary needs a JS runtime (JsValue, not a
    // serde_json string). Covered indirectly by §1–§7; a real browser test
    // belongs in `scripts/`.
}
