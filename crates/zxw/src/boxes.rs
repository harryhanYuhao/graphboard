// crates/zxw/src/boxes.rs
//
// Z / X / H box tensor builders. See `doc/plans/zxw-compute-backend.md`
// §4.3 for the per-arity shape + non-zero-entry contract. Boxes need
// a multi-phase encoding to be useful — Phase 6.