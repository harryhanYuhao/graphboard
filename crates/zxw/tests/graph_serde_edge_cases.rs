// crates/zxw/tests/graph_serde_edge_cases.rs
//
// Edge-case probe for the `GraphSlice` serde contract and the `wasm`
// module's compute-path logic. Mirrors `tests/graph_serde.rs` conventions
// (`serde_json::from_str` / `to_string`, `assert_eq`, `matches!`) but
// does NOT duplicate its cases — each test here pins exactly one extra
// behavior that the sibling file leaves implicit.
//
// Contract source of truth:
//   - Rust structs:    `crates/zxw/src/graph.rs`
//   - TS wire shape:   `src/lib/graph/types.ts` (`GraphNodeRecord`,
//                      `GraphEdgeRecord`, `VertexType`)
//   - Handle meaning:  `src/lib/graph/serialization.ts` (`handleIdToIndex`:
//                      0 = top, 1 = bottom; absent => default).
//
// Run:
//   cargo test -p zxw --test graph_serde_edge_cases
//   cargo test -p zxw --test graph_serde_edge_cases --features wasm
//
// The wasm-gated tests at the bottom of this file exercise the
// `zxw::wasm` shim's plain-Rust-callable functions (`ping`,
// `compute_api_version`). The `JsValue`-taking `compute_tensor` cannot
// be tested without a JS runtime and is intentionally not exercised here.

use zxw::{
    FrontendGraphEdgeRecord, FrontendGraphNodeRecord, FrontendGraphSlice, FrontendVertexData,
    VertexType,
};

// ---- small helpers ---------------------------------------------------------
//
// Centralizing the round-trip + error-fragment assertions keeps each test
// one-liner and the failure messages uniform. Error-fragment matching
// follows `tests/graph_serde.rs::rejects_unknown_vertex_type`: serde's
// exact wording is unstable, so we match on a stable substring rather
// than the full message.

/// Helper: assert the JSON fails to deserialize as `GraphSlice`.
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
// `source_handle` / `target_handle` are `Option<u32>` with
// `#[serde(default, skip_serializing_if = "Option::is_none")]`. The TS
// side (`handleIdToIndex`) only ever emits absent or 0/1; everything
// else here is a robustness probe of the Rust deserializer.

// 1. `sourceHandle: null` (explicit JSON null) vs absent.
//
// serde treats an explicit `null` for an `Option<T>` field as `None`
// (the deserializer's `deserialize_option` short-circuits on null). The
// TS serializer never emits null (it omits the field — see
// `handleIdToIndex` returning `undefined`), so a null on the wire is
// technically out-of-contract, but serde accepts it rather than
// erroring. Pin that behavior: explicit null => `None`, no error.
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

// 2. `sourceHandle: "0"` (string instead of number).
//
// u32 does not coerce from string; serde_json rejects with "invalid
// type: string ... expected u32". Pin the error.
#[test]
fn string_handle_value_is_rejected() {
    let json = r#"{"nodes": [], "edges": [{"id": "e", "source": "a", "target": "b", "sourceHandle": "0"}]}"#;
    assert_rejects(json, "u32");
}

// 3. `sourceHandle: -1` (negative).
//
// The task brief speculates "-1 round-trips intact (compute layer
// ignores the value in v1)". That premise is wrong: the field is typed
// `Option<u32>`, and u32 rejects negatives at deserialization time
// BEFORE the compute layer ever sees it. (This is already pinned in
// `tests/graph_serde.rs::negative_and_large_handle_indices_deserialize`;
// we re-pin `-1` explicitly here so the contract is locally obvious.)
// NOT a bug — the type is intentionally `u32`, so negative is correctly
// rejected.
#[test]
fn negative_handle_minus_one_is_rejected() {
    let json = r#"{"nodes": [], "edges": [{"id": "e", "source": "a", "target": "b", "sourceHandle": -1}]}"#;
    assert_rejects(json, "u32");
}

// 4. `sourceHandle: 4294967296` (u32::MAX + 1, overflow).
//
// Above the u32 range; serde_json rejects with "invalid value: integer
// ... expected u32". Pin the error.
#[test]
fn handle_value_above_u32_max_is_rejected() {
    let json = r#"{"nodes": [], "edges": [{"id": "e", "source": "a", "target": "b", "sourceHandle": 4294967296}]}"#;
    assert_rejects(json, "u32");
}

// 5. `sourceHandle: 0.5` (float).
//
// serde_json's integer deserializer rejects floats with "invalid type:
// floating point ... expected u32". Note serde_json does NOT silently
// truncate 0.5 to 0. Pin the error.
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

// 30. Explicit case-sensitivity table for all 10 vertex types.
//
// `tests/graph_serde.rs::all_ten_vertex_types_round_trip` covers the
// lowercase happy path; this test pins that every uppercase / camelCase
// spelling is rejected. One test, all 10, to keep the table compact.
#[test]
fn all_vertex_types_are_lowercase_only() {
    // Each entry: (lowercase-valid, at-least-one-rejected-spelling).
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
// Re-pinned explicitly here even though
// `tests/graph_serde.rs::rejects_missing_data_wrapper` covers it — the
// flat shape is the single most likely accidental regression (a
// refactor flattening `data`), so it deserves its own clearly-named
// test in this file.
#[test]
fn flat_node_without_data_wrapper_is_rejected() {
    let json = r#"{"nodes": [{"id": "x", "label": "hi", "vertexType": "z"}], "edges": []}"#;
    assert_rejects(json, "data");
}

// 12. `data: null`.
//
// `Option`-free struct field; serde rejects null with "invalid type:
// null, expected struct VertexData".
#[test]
fn null_data_wrapper_is_rejected() {
    let json = r#"{"nodes": [{"id": "a", "data": null}], "edges": []}"#;
    assert_rejects(json, "vertexdata");
}

// 13. `data: {}` (empty data object).
//
// Both `label` and `vertexType` are required; serde reports "missing
// field `label`" (it short-circuits on the first missing field).
#[test]
fn empty_data_object_is_rejected() {
    let json = r#"{"nodes": [{"id": "a", "data": {}}], "edges": []}"#;
    assert_rejects(json, "missing field");
}

// 14. Extra unknown field inside `data`.
//
// serde's derived `Deserialize` ignores unknown fields by default (no
// `#[serde(deny_unknown_fields)]` anywhere in the chain). Pin that an
// extra key inside `data` is silently dropped, NOT an error.
#[test]
fn extra_field_inside_data_is_ignored() {
    let json = r#"{"nodes": [{"id": "a", "data": {"label": "l", "vertexType": "z", "extra": 42}}], "edges": []}"#;
    let slice = assert_accepts(json);
    assert_eq!(slice.nodes[0].data.label, "l");
    assert_eq!(slice.nodes[0].data.vertex_type, VertexType::Z);
}

// 15. Extra unknown field at node level.
//
// The TS payload sometimes carries extra runtime fields (e.g.
// `selected` from a pre-split document — see types.ts comment about the
// `selected`-persistence bug). serde ignores them. Pin accepted.
#[test]
fn extra_field_at_node_level_is_ignored() {
    let json = r#"{"nodes": [{"id": "a", "data": {"label": "", "vertexType": "z"}, "selected": true, "position": {"x": 1, "y": 2}}], "edges": []}"#;
    let slice = assert_accepts(json);
    assert_eq!(slice.nodes[0].id, "a");
}

// 16. Missing `label`.
//
// Empty string is valid (tested in `tests/graph_serde.rs`), but an
// absent field is a structural error.
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

// 20. `id: ""` (empty string id).
//
// serde accepts an empty string for `id` — there is no non-empty
// validation at the type level. Whether the compute layer later chokes
// on an empty join key is a separate (Phase 4) concern; here we only
// pin serde.
#[test]
fn empty_string_id_deserializes() {
    let json = r#"{"nodes": [{"id": "", "data": {"label": "", "vertexType": "z"}}], "edges": []}"#;
    let slice = assert_accepts(json);
    assert_eq!(slice.nodes[0].id, "");
}

// 21. Duplicate `id` values across two nodes.
//
// No uniqueness check at the type level — serde happily deserializes
// two nodes with the same id. The compute layer (Phase 4 vertex
// lookup) would later collide, but that is its problem, not serde's.
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

// 22. Empty `nodes` array with non-empty `edges`.
//
// serde has no cross-field validation, so this deserializes fine; the
// compute layer would later raise `VertexNotFound` (see `error.rs`).
// Pin serde-only success.
#[test]
fn empty_nodes_with_edges_deserializes() {
    let json = r#"{"nodes": [], "edges": [{"id": "e", "source": "a", "target": "b"}]}"#;
    let slice = assert_accepts(json);
    assert!(slice.nodes.is_empty());
    assert_eq!(slice.edges.len(), 1);
}

// 23. `nodes` absent entirely.
//
// `GraphSlice.nodes` is `Vec<_>` with no `#[serde(default)]`, so a
// missing field is an error.
#[test]
fn missing_nodes_field_is_rejected() {
    let json = r#"{"edges": []}"#;
    assert_rejects(json, "missing field `nodes`");
}

// 24. `edges` absent entirely.
//
// Same reasoning as above — no `#[serde(default)]` on `edges`. Pin
// rejected. (If the schema ever wants edges to be optional, that change
// needs an explicit `#[serde(default)]` on the field, and this test
// should be updated to match.)
#[test]
fn missing_edges_field_is_rejected() {
    let json = r#"{"nodes": []}"#;
    assert_rejects(json, "missing field `edges`");
}

// 25. Top-level JSON array instead of object.
//
// serde_json reports "invalid length 0, expected struct GraphSlice with
// 2 elements" (it tries to deserialize a struct from a sequence). Pin
// rejected.
#[test]
fn top_level_json_array_is_rejected() {
    let json = r#"[]"#;
    assert_rejects(json, "GraphSlice");
}

// 26. Top-level JSON scalars.
//
// Each of `42`, `"hi"`, `true` is rejected; serde_json reports an
// "invalid type" message naming `GraphSlice`.
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

// 29. Very long label (10000 chars).
//
// Confirms serde does not truncate; the parser/compute layer must see
// the same length the wire carried.
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

// 31. `GraphEdgeRecord` with `source == target` (self-loop).
//
// serde has no constraint against it; compute handles (or rejects) it
// later. Pin serde-only success and that the handles survive the trip.
#[test]
fn self_loop_edge_deserializes() {
    let json = r#"{"nodes": [{"id": "a", "data": {"label": "", "vertexType": "z"}}], "edges": [{"id": "e", "source": "a", "target": "a", "sourceHandle": 0, "targetHandle": 1}]}"#;
    let slice = assert_accepts(json);
    assert_eq!(slice.edges[0].source, "a");
    assert_eq!(slice.edges[0].target, "a");
    assert_eq!(slice.edges[0].source_handle, Some(0));
    assert_eq!(slice.edges[0].target_handle, Some(1));
}

// 32. Serialization produces stable key order.
//
// serde_json's derived `Serialize` for structs emits fields in
// declaration order (NOT sorted). Pin the exact byte layout of a node
// and an edge so a future field reorder is caught here, not in a
// subtle frontend deserialization regression. Two equivalent graphs
// re-serialize byte-identically.
#[test]
fn serialization_key_order_is_stable() {
    // Node: `id`, then `data` (which is `label`, then `vertexType`).
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

// 33. Round-trip an edge WITH handles — they must appear in re-serialized output.
//
// `tests/graph_serde.rs::empty_edge_handles_omitted_when_none` covers
// the None case (omitted); this pins the Some case (present) so the
// `skip_serializing_if` predicate is symmetric.
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

    // And the round-trip preserves them.
    let back: FrontendGraphEdgeRecord = serde_json::from_str(&json).unwrap();
    assert_eq!(back.source_handle, Some(0));
    assert_eq!(back.target_handle, Some(1));
}

// ============================================================================
// §8  WASM compute-path logic (gated behind `--features wasm`)
// ============================================================================
//
// The `#[wasm_bindgen]` macro does NOT change the underlying Rust
// signature — it only adds JS glue — so `ping` and `compute_api_version`
// are callable as plain Rust functions from a native test. Verified by
// probe before this file was written.
//
// `compute_tensor` takes `JsValue` + `Option<js_sys::Function>` and
// cannot be exercised without a JS runtime; it is intentionally not
// tested here. The serde-boundary tests in §1–§7 above ARE the
// contract `compute_tensor` depends on at its entry point.

#[cfg(feature = "wasm")]
mod wasm_tests {
    // 34. `ping()` returns "pong".
    //
    // The frontend's `scripts/ping-wasm.mts` uses this as the WASM
    // pipeline health check. The native-callable path returns the same
    // value the JS binding would.
    #[test]
    fn ping_returns_pong() {
        let s: String = zxw::wasm::ping();
        assert_eq!(s, "pong");
    }

    // 34b. `compute_api_version()` returns the crate version.
    //
    // The frontend asserts the wasm export matches the version in the
    // built `package.json` before calling any compute fn; this pins
    // that the export is driven by `env!("CARGO_PKG_VERSION")` so the
    // two stay in sync.
    #[test]
    fn compute_api_version_matches_crate_version() {
        let v: String = zxw::wasm::compute_api_version();
        assert_eq!(v, env!("CARGO_PKG_VERSION"));
        // Sanity: the crate is at 0.1.0 today; assert the literal too so
        // a Cargo.toml version bump without a matching export update
        // surfaces here rather than silently passing via env!.
        assert_eq!(v, "0.1.0");
    }

    // 35. The serde-wasm-bindgen boundary — SKIPPED without a browser.
    //
    // `compute_tensor` deserializes a `JsValue` via
    // `serde_wasm_bindgen::from_value`, which requires a JS object, not
    // a serde_json string. There is no native proxy that exercises the
    // same code path, so the wasm-boundary correctness is covered
    // indirectly by the serde_json tests in §1–§7 (serde-wasm-bindgen
    // delegates to the same derived `Deserialize`). A real browser test
    // would belong in `scripts/` (see `ping-wasm.mts`), not here.
}
