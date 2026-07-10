// crates/zxw/src/tensor.rs
//
// Tensor wrapper around `ndarray::ArrayD<Complex<f64>>` plus a single
// `contract(a, b, (axis_a, axis_b))` method. Phase 3 lands the
// implementation.