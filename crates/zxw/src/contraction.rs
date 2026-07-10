// crates/zxw/src/contraction.rs
//
// Naive sequential contraction algorithm (Phase 4). Uses a union-find
// of vertex → group with one Tensor per group. See
// `doc/plans/zxw-compute-backend.md` §5.