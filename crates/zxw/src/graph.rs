// crates/zxw/src/graph.rs
//
// GraphSlice data model — the contract between the frontend (TS) and
// the Rust compute layer (serde JSON / serde_wasm_bindgen).
//
// Phase 3 lands the actual types: `GraphSlice { nodes, edges }`,
// `Node { id, vertex_type, label }`, `Edge { id, source, target }`.