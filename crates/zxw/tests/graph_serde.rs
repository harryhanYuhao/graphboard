// crates/zxw/tests/graph_serde.rs
//
// Round-trip test for the `GraphSlice` serde model. The Rust structs must
// deserialize the exact JSON the frontend emits: nested `data` wrapper,
// camelCase fields, optional handle indices. A regression in any of those
// (dropping `rename_all`, flattening `data`, making handles required) fails.

use zxw::{FrontendGraphEdgeRecord, FrontendGraphNodeRecord, FrontendGraphSlice, VertexType};

/// Hand-written payload matching `projectDocument()` output: nested `data`,
/// every `vertexType` spelling, edges with and without handle indices (the
/// absent-field case deserializes to `None`, not `Some(0)`).
const FRONTEND_PAYLOAD: &str = r#"{
  "nodes": [
    { "id": "z1",   "data": { "label": "\\pi/4", "vertexType": "z" } },
    { "id": "h1",   "data": { "label": "",        "vertexType": "h" } },
    { "id": "w1",   "data": { "label": "W",       "vertexType": "w" } },
    { "id": "and1", "data": { "label": "",        "vertexType": "and" } },
    { "id": "zb1",  "data": { "label": "0",       "vertexType": "zbox" } },
    { "id": "xb1",  "data": { "label": "$\\pi$",  "vertexType": "xbox" } }
  ],
  "edges": [
    { "id": "e1", "source": "z1", "target": "h1" },
    { "id": "e2", "source": "h1", "target": "w1", "sourceHandle": 1, "targetHandle": 0 }
  ]
}"#;

#[test]
fn deserializes_frontend_payload_with_camel_case_and_nested_data() {
    let slice: FrontendGraphSlice =
        serde_json::from_str(FRONTEND_PAYLOAD).expect("frontend payload must deserialize");

    assert_eq!(slice.nodes.len(), 6);
    assert_eq!(slice.nodes[0].id, "z1");
    assert_eq!(slice.nodes[0].data.label, "\\pi/4");
    assert_eq!(slice.nodes[0].data.vertex_type, VertexType::Z);

    // Every vertex-type spelling round-trips through the lowercase rename.
    let types: Vec<VertexType> = slice.nodes.iter().map(|n| n.data.vertex_type).collect();
    assert_eq!(
        types,
        vec![
            VertexType::Z,
            VertexType::H,
            VertexType::W,
            VertexType::And,
            VertexType::Zbox,
            VertexType::Xbox,
        ]
    );
}

#[test]
fn absent_handle_fields_become_none_not_zero() {
    let slice: FrontendGraphSlice = serde_json::from_str(FRONTEND_PAYLOAD).expect("deserialize");
    // e1 has no handle fields → both ends None.
    let e1 = &slice.edges[0];
    assert_eq!(e1.id, "e1");
    assert_eq!(e1.source_handle, None);
    assert_eq!(e1.target_handle, None);

    // e2 carries explicit indices → Some(...).
    let e2 = &slice.edges[1];
    assert_eq!(e2.source_handle, Some(1));
    assert_eq!(e2.target_handle, Some(0));
}

#[test]
fn reserialize_round_trips_through_the_struct() {
    // Deserialize → re-serialize → deserialize, checking the second pass
    // sees the same values. Catches asymmetric serde attributes.
    let once: FrontendGraphSlice = serde_json::from_str(FRONTEND_PAYLOAD).unwrap();
    let json = serde_json::to_value(&once).unwrap();
    let twice: FrontendGraphSlice = serde_json::from_value(json).unwrap();

    assert_eq!(once.nodes.len(), twice.nodes.len());
    for (a, b) in once.nodes.iter().zip(twice.nodes.iter()) {
        assert_eq!(a.id, b.id);
        assert_eq!(a.data.label, b.data.label);
        assert_eq!(a.data.vertex_type, b.data.vertex_type);
    }
    for (a, b) in once.edges.iter().zip(twice.edges.iter()) {
        assert_eq!(a.source_handle, b.source_handle);
        assert_eq!(a.target_handle, b.target_handle);
    }
}

#[test]
fn empty_edge_handles_omitted_when_none() {
    // Re-serializing an edge with None handles must omit the fields
    // (skip_serializing_if), matching the frontend's shape — never
    // `"sourceHandle": null`.
    let edge = FrontendGraphEdgeRecord {
        id: "x".into(),
        source: "s".into(),
        target: "t".into(),
        source_handle: None,
        target_handle: None,
    };
    let json = serde_json::to_string(&edge).unwrap();
    assert!(
        !json.contains("sourceHandle"),
        "None handles must be omitted, got: {json}"
    );
    assert!(
        !json.contains("targetHandle"),
        "None handles must be omitted, got: {json}"
    );
}

#[test]
fn struct_can_be_built_and_named_directly() {
    // Sanity-check field names compile against the public API.
    let _node = FrontendGraphNodeRecord {
        id: "n".into(),
        data: zxw::FrontendVertexData {
            label: "label".into(),
            vertex_type: VertexType::Empty,
            order: None,
        },
    };
}

// ---- Negative cases: malformed input must fail loudly ---------------------

#[test]
fn rejects_unknown_vertex_type() {
    // Only the lowercase spellings are valid; an unknown type ("t") must
    // error, not fall back to a default variant.
    let bad =
        r#"{ "nodes": [{ "id": "x", "data": { "label": "", "vertexType": "t" } }], "edges": [] }"#;
    let result: Result<FrontendGraphSlice, _> = serde_json::from_str(bad);
    assert!(
        result.is_err(),
        "unknown vertex type 't' should be rejected, got: {:?}",
        result
    );
    let err = result.unwrap_err().to_string().to_lowercase();
    assert!(
        err.contains("unknown") || err.contains("vertextype") || err.contains("t"),
        "error should name the offending field/variant, got: {err}"
    );
}

#[test]
fn rejects_snake_case_vertex_type_field() {
    // The wire contract is camelCase; snake_case `vertex_type` must be
    // rejected (else a stale schema silently gives every node an empty label).
    let bad = r#"{ "nodes": [{ "id": "x", "data": { "label": "hi", "vertex_type": "z" } }], "edges": [] }"#;
    let result: Result<FrontendGraphSlice, _> = serde_json::from_str(bad);
    assert!(
        result.is_err(),
        "snake_case `vertex_type` field should be rejected (camelCase only), got: {:?}",
        result
    );
}

#[test]
fn rejects_missing_data_wrapper() {
    // The nested `data` wrapper is load-bearing. A flat node must fail,
    // else a refactor flattening `data` silently loses every label.
    let flat = r#"{ "nodes": [{ "id": "x", "label": "hi", "vertexType": "z" }], "edges": [] }"#;
    let result: Result<FrontendGraphSlice, _> = serde_json::from_str(flat);
    assert!(result.is_err(), "flat node (no `data`) must be rejected");
}

#[test]
fn rejects_node_missing_id() {
    // `id` is required (the contraction algorithm's edge join key).
    let bad = r#"{ "nodes": [{ "data": { "label": "", "vertexType": "z" } }], "edges": [] }"#;
    let result: Result<FrontendGraphSlice, _> = serde_json::from_str(bad);
    assert!(result.is_err(), "node without id must be rejected");
}

#[test]
fn rejects_edge_missing_endpoints() {
    // Edges must name both `source` and `target`.
    let no_target = r#"{ "nodes": [], "edges": [{ "id": "e", "source": "a" } ]}"#;
    let result: Result<FrontendGraphSlice, _> = serde_json::from_str(no_target);
    assert!(result.is_err(), "edge without target must be rejected");
}

// ---- Edge cases on valid input --------------------------------------------

#[test]
fn empty_graph_slice_round_trips() {
    // `{ nodes: [], edges: [] }` deserializes to empty (not null) vectors
    // and re-serializes to canonical compact form.
    let empty = r#"{ "nodes": [], "edges": [] }"#;
    let slice: FrontendGraphSlice =
        serde_json::from_str(empty).expect("empty graph must deserialize");
    assert!(slice.nodes.is_empty());
    assert!(slice.edges.is_empty());

    // Canonical compact form on re-serialize.
    let back = serde_json::to_string(&slice).unwrap();
    assert_eq!(back, r#"{"nodes":[],"edges":[]}"#);
}

#[test]
fn all_ten_vertex_types_round_trip() {
    // Every `VertexType` variant (8 generators + input/output) in one
    // payload; a rename regression surfaces here with a clear name.
    let json = r#"{
      "nodes": [
        { "id": "n1", "data": { "label": "", "vertexType": "z" } },
        { "id": "n2", "data": { "label": "", "vertexType": "empty" } },
        { "id": "n3", "data": { "label": "", "vertexType": "x" } },
        { "id": "n4", "data": { "label": "", "vertexType": "w" } },
        { "id": "n5", "data": { "label": "", "vertexType": "h" } },
        { "id": "n6", "data": { "label": "", "vertexType": "zbox" } },
        { "id": "n7", "data": { "label": "", "vertexType": "xbox" } },
        { "id": "n8", "data": { "label": "", "vertexType": "and" } },
        { "id": "n9", "data": { "label": "", "vertexType": "input" } },
        { "id": "n10", "data": { "label": "", "vertexType": "output" } }
      ],
      "edges": []
    }"#;
    let slice: FrontendGraphSlice = serde_json::from_str(json).unwrap();
    assert_eq!(slice.nodes.len(), 10);
    let got: Vec<VertexType> = slice.nodes.iter().map(|n| n.data.vertex_type).collect();
    assert_eq!(
        got,
        vec![
            VertexType::Z,
            VertexType::Empty,
            VertexType::X,
            VertexType::W,
            VertexType::H,
            VertexType::Zbox,
            VertexType::Xbox,
            VertexType::And,
            VertexType::Input,
            VertexType::Output,
        ]
    );
}

#[test]
fn unicode_label_round_trips_intact() {
    // LaTeX labels (backslash, braces, π, ×, ÷, −, …) survive the
    // round-trip byte-for-byte so the parser sees the same string.
    let label = r#"$\pi \times 2 \div 4 - \alpha$"#;
    let json = format!(
        r#"{{"nodes":[{{"id":"x","data":{{"label":{lbl},"vertexType":"z"}}}}],"edges":[]}}"#,
        lbl = serde_json::to_string(label).unwrap()
    );
    let slice: FrontendGraphSlice = serde_json::from_str(&json).unwrap();
    assert_eq!(slice.nodes[0].data.label, label);
}

#[test]
fn negative_and_large_handle_indices_deserialize() {
    // Handles are `Option<u32>`: 0/1 works, negatives are rejected (u32
    // won't parse "-1") at deserialize time.
    let valid = r#"{
        "nodes": [{"id":"a","data":{"label":"","vertexType":"z"}},{"id":"b","data":{"label":"","vertexType":"z"}}],
        "edges": [{"id":"e","source":"a","target":"b","sourceHandle":0,"targetHandle":1}]
    }"#;
    let slice: FrontendGraphSlice = serde_json::from_str(valid).unwrap();
    assert_eq!(slice.edges[0].source_handle, Some(0));
    assert_eq!(slice.edges[0].target_handle, Some(1));

    let negative = r#"{
        "nodes": [],
        "edges": [{"id":"e","source":"a","target":"b","sourceHandle":-1}]
    }"#;
    assert!(
        serde_json::from_str::<FrontendGraphSlice>(negative).is_err(),
        "negative handle index must be rejected (u32)"
    );
}

#[test]
fn vertex_order_field_round_trips_and_defaults_to_none() {
    // `order`: present values deserialize, absent defaults to `None`
    // (back-compat), and `None` re-serializes with the field omitted.
    let json = r#"{
        "nodes": [
            {"id":"i0","data":{"label":"","vertexType":"input","order":0}},
            {"id":"i1","data":{"label":"","vertexType":"input","order":1}},
            {"id":"z","data":{"label":"","vertexType":"z"}}
        ],
        "edges": []
    }"#;
    let slice: FrontendGraphSlice = serde_json::from_str(json).unwrap();
    assert_eq!(slice.nodes[0].data.order, Some(0));
    assert_eq!(slice.nodes[1].data.order, Some(1));
    // Non-boundary / field-less nodes default to None.
    assert_eq!(slice.nodes[2].data.order, None);

    // Re-serializing None omits the key (skip_serializing_if).
    let out = serde_json::to_string(&slice).unwrap();
    assert!(
        out.contains(r#""order":0"#),
        "set order must serialize: {out}"
    );
    assert!(
        !out.contains(r#""order":null"#),
        "None order must be omitted, not null: {out}"
    );

    // Absent field → None (old documents load unchanged).
    let legacy = r#"{
        "nodes": [{"id":"i","data":{"label":"","vertexType":"input"}}],
        "edges": []
    }"#;
    let legacy_slice: FrontendGraphSlice = serde_json::from_str(legacy).unwrap();
    assert_eq!(legacy_slice.nodes[0].data.order, None);
}
