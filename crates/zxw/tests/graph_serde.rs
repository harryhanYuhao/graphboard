// crates/zxw/tests/graph_serde.rs
//
// Round-trip test for the `GraphSlice` serde model. The Rust structs
// in `src/graph.rs` must deserialize the exact JSON payload the
// frontend's `projectDocument()` emits (see
// `src/lib/graph/serialization.ts`): nested `data` wrapper,
// camelCase fields, optional numeric handle indices. A regression in
// any of those (e.g. dropping `#[serde(rename_all = "camelCase")]`,
// flattening `data`, or making handles required) fails this test.
//
// The payload below mirrors what crosses the WASM boundary in Phase 5:
// only `doc.graph`, never `doc.view`.

use zxw::{GraphEdgeRecord, GraphSlice, GraphNodeRecord, VertexType};

/// Hand-written payload matching `projectDocument()` output exactly.
/// Includes: nested `data`, every `vertexType` spelling, edges with and
/// without handle indices (the absent-field case is meaningful —
/// `None` on the Rust side, not `Some(0)`).
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
    let slice: GraphSlice =
        serde_json::from_str(FRONTEND_PAYLOAD).expect("frontend payload must deserialize");

    assert_eq!(slice.nodes.len(), 6);
    assert_eq!(slice.nodes[0].id, "z1");
    assert_eq!(slice.nodes[0].data.label, "\\pi/4");
    assert_eq!(slice.nodes[0].data.vertex_type, VertexType::Z);

    // Every vertex-type spelling round-trips through the lowercase
    // serde rename.
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
    let slice: GraphSlice =
        serde_json::from_str(FRONTEND_PAYLOAD).expect("deserialize");
    // e1 has no handle fields at all → both ends None.
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
    // Deserialize → re-serialize → deserialize again, and check the
    // second pass sees the same values. Catches asymmetric serde
    // attributes (e.g. `serialize_with` without a matching `deserialize_with`).
    let once: GraphSlice = serde_json::from_str(FRONTEND_PAYLOAD).unwrap();
    let json = serde_json::to_value(&once).unwrap();
    let twice: GraphSlice = serde_json::from_value(json).unwrap();

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
    // When we *re-serialize* an edge whose handles are None, the JSON
    // should omit the fields (skip_serializing_if), matching the
    // frontend's emitted shape. An edge that never had handles shouldn't
    // sprout `"sourceHandle": null` on the way back out.
    let edge = GraphEdgeRecord {
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
    // Sanity-check the field names compile against the public API —
    // catches accidental renames a downstream caller would hit.
    let _node = GraphNodeRecord {
        id: "n".into(),
        data: zxw::VertexData {
            label: "label".into(),
            vertex_type: VertexType::Empty,
        },
    };
}

// ---- Negative cases: malformed input must fail loudly ---------------------
//
// These guard the WASM boundary. If serde silently accepts a payload the
// frontend can't actually emit (or a stale schema from an old deploy),
// the compute layer will run on garbage and produce nonsense tensors
// that are very hard to debug. Better to refuse at deserialization.

#[test]
fn rejects_unknown_vertex_type() {
    // The eight lowercase spellings are the only valid values. A typo
    // or a future type ("t") must surface as a deserialization error,
    // not deserialize to a default variant.
    let bad = r#"{ "nodes": [{ "id": "x", "data": { "label": "", "vertexType": "t" } }], "edges": [] }"#;
    let result: Result<GraphSlice, _> = serde_json::from_str(bad);
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
    // The TS contract uses camelCase (`vertexType`), and serde's
    // `rename_all` does NOT accept the original snake_case field name
    // unless explicitly allowed. A payload carrying `vertex_type` must
    // be rejected — otherwise a stale payload schema slips through and
    // every node silently deserializes with an empty label.
    let bad = r#"{ "nodes": [{ "id": "x", "data": { "label": "hi", "vertex_type": "z" } }], "edges": [] }"#;
    let result: Result<GraphSlice, _> = serde_json::from_str(bad);
    assert!(
        result.is_err(),
        "snake_case `vertex_type` field should be rejected (camelCase only), got: {:?}",
        result
    );
}

#[test]
fn rejects_missing_data_wrapper() {
    // The nested `data: { label, vertexType }` is load-bearing. A flat
    // node `{ id, label, vertexType }` (the shape an earlier sketch
    // proposed) must fail — without this check, a refactor that
    // flattens `data` would silently lose every label.
    let flat = r#"{ "nodes": [{ "id": "x", "label": "hi", "vertexType": "z" }], "edges": [] }"#;
    let result: Result<GraphSlice, _> = serde_json::from_str(flat);
    assert!(result.is_err(), "flat node (no `data`) must be rejected");
}

#[test]
fn rejects_node_missing_id() {
    // `id` is required — it's the join key the contraction algorithm
    // walks edges by. Missing it should fail at deserialize, not
    // surface as a panic deep inside Phase 4's vertex lookup.
    let bad = r#"{ "nodes": [{ "data": { "label": "", "vertexType": "z" } }], "edges": [] }"#;
    let result: Result<GraphSlice, _> = serde_json::from_str(bad);
    assert!(result.is_err(), "node without id must be rejected");
}

#[test]
fn rejects_edge_missing_endpoints() {
    // Edges must name both `source` and `target`. Missing either is a
    // structural error the compute layer can't recover from.
    let no_target = r#"{ "nodes": [], "edges": [{ "id": "e", "source": "a" } ]}"#;
    let result: Result<GraphSlice, _> = serde_json::from_str(no_target);
    assert!(result.is_err(), "edge without target must be rejected");
}

// ---- Edge cases on valid input --------------------------------------------

#[test]
fn empty_graph_slice_round_trips() {
    // The Phase 5 empty-graph path returns scalar 1 (plan §5.6). That
    // starts here: deserializing `{ nodes: [], edges: [] }` must
    // succeed and give empty (not null) vectors.
    let empty = r#"{ "nodes": [], "edges": [] }"#;
    let slice: GraphSlice =
        serde_json::from_str(empty).expect("empty graph must deserialize");
    assert!(slice.nodes.is_empty());
    assert!(slice.edges.is_empty());

    // Re-serialize: should produce the canonical compact form.
    let back = serde_json::to_string(&slice).unwrap();
    assert_eq!(back, r#"{"nodes":[],"edges":[]}"#);
}

#[test]
fn all_ten_vertex_types_round_trip() {
    // One payload exercising every `VertexType` variant — the eight ZXW
    // generators plus the two boundary markers (input/output). A
    // regression in any one variant's rename surfaces here with a clear
    // name.
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
    let slice: GraphSlice = serde_json::from_str(json).unwrap();
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
    // Labels can carry LaTeX (which includes backslash, braces, π, ×,
    // ÷, −, etc.). These must survive the JSON round-trip byte-for-byte
    // so the compute layer sees the same string the parser does.
    let label = r#"$\pi \times 2 \div 4 - \alpha$"#;
    let json = format!(
        r#"{{"nodes":[{{"id":"x","data":{{"label":{lbl},"vertexType":"z"}}}}],"edges":[]}}"#,
        lbl = serde_json::to_string(label).unwrap()
    );
    let slice: GraphSlice = serde_json::from_str(&json).unwrap();
    assert_eq!(slice.nodes[0].data.label, label);
}

#[test]
fn negative_and_large_handle_indices_deserialize() {
    // Handle indices are `Option<u32>`. The frontend only emits 0/1
    // today, but `u32` accepts the full unsigned range — and *rejects*
    // negatives. Verify both sides of that contract: a 0/1 payload
    // works, and a negative index is rejected (u32 won't parse "-1").
    let valid = r#"{
        "nodes": [{"id":"a","data":{"label":"","vertexType":"z"}},{"id":"b","data":{"label":"","vertexType":"z"}}],
        "edges": [{"id":"e","source":"a","target":"b","sourceHandle":0,"targetHandle":1}]
    }"#;
    let slice: GraphSlice = serde_json::from_str(valid).unwrap();
    assert_eq!(slice.edges[0].source_handle, Some(0));
    assert_eq!(slice.edges[0].target_handle, Some(1));

    let negative = r#"{
        "nodes": [],
        "edges": [{"id":"e","source":"a","target":"b","sourceHandle":-1}]
    }"#;
    assert!(
        serde_json::from_str::<GraphSlice>(negative).is_err(),
        "negative handle index must be rejected (u32)"
    );
}

