// crates/zxw/src/tensor.rs
//
// Dense complex tensor, the workhorse of the compute layer. Wraps an
// `ndarray::ArrayD<Complex<f64>>` and provides the small surface the
// contraction algorithm (Phase 4) and the per-vertex builders (Phase 3)
// need: construction, element access, two-axis contraction, and a
// builder-friendly `apply_2x2_to_axis` for basis changes (used to derive
// `x_spider` from `z_spider`, etc.).
//
// Why a wrapper and not raw `ArrayD<Complex<f64>>`? Two reasons:
//   1. The contraction and basis-change routines are non-trivial and
//      benefit from being methods on a named type, with the shape
//      invariants checked in one place.
//   2. The Phase 4 contraction loop and the Phase 5 WASM boundary both
//      want a single, opaque type rather than exposing ndarray's
//      dimensionality generics everywhere.
//
// `contract(a, b, (i, j))` removes axis `i` of `a` and axis `j` of `b`,
// summing their product — the single primitive Phase 4's edge-walk needs.
//
// We hand-roll the contraction inner loop rather than calling
// `ndarray::linalg::dot` because `Complex<f64>` does not implement
// `ndarray::LinalgScalar`, and pulling in `ndarray-linalg` would add a
// BLAS dependency that's hostile to the WASM build target. The
// straightforward triple loop is O(M·N·K) and is more than fast enough
// for the graphs v1 targets (≤ ~30 legs; see plan §5.2).

use ndarray::{ArrayD, IxDyn};
use num_complex::Complex;
use std::fmt;

pub type Cplx = Complex<f64>;

#[derive(Debug, Clone)]
pub struct Tensor {
    pub data: ArrayD<Cplx>,
}

impl Tensor {
    /// Build from an already-shaped array. The argument's element type
    /// must be `Complex<f64>`; the wrapper just owns it.
    pub fn from_array(data: ArrayD<Cplx>) -> Self {
        Self { data }
    }

    /// Scalar tensor (rank 0). The multiplicative identity lives here.
    pub fn scalar(c: Cplx) -> Self {
        Self {
            data: ArrayD::from_shape_vec(IxDyn(&[]), vec![c]).unwrap(),
        }
    }

    /// All-zeros tensor of the given shape.
    pub fn zeros(shape: &[usize]) -> Self {
        Self {
            data: ArrayD::zeros(IxDyn(shape)),
        }
    }

    pub fn shape(&self) -> &[usize] {
        self.data.shape()
    }

    pub fn rank(&self) -> usize {
        self.data.ndim()
    }

    /// Immutable element access by multi-index. Panics on out-of-range
    /// (caller's invariant; we never construct from external indices).
    pub fn get(&self, idx: &[usize]) -> Cplx {
        self.data[IxDyn(idx)]
    }

    /// Mutable element access by multi-index.
    pub fn get_mut(&mut self, idx: &[usize]) -> &mut Cplx {
        &mut self.data[IxDyn(idx)]
    }

    /// Contract `self` (axis `axis_a`) with `other` (axis `axis_b`),
    /// returning a new tensor whose axes are `[self's other axes...,
    /// other's other axes...]`. Consumes both inputs.
    ///
    /// Mathematically: `result[i..., j...] = Σ_k self[i..., k] * other[j..., k]`
    /// (after moving `axis_a`/`axis_b` to the last position of each).
    ///
    /// Panics on mismatched contracted-axis lengths — that's a programmer
    /// bug in the builder / contraction code, not a runtime input error.
    pub fn contract(self, other: Self, axis_a: usize, axis_b: usize) -> Tensor {
        let a = self.data;
        let b = other.data;

        let contracted_len = a.shape()[axis_a];
        assert_eq!(
            contracted_len,
            b.shape()[axis_b],
            "contract: axis lengths differ ({axis_a} of self is {}, {axis_b} of other is {})",
            contracted_len,
            b.shape()[axis_b]
        );

        // Move the contracted axis to the *last* position of each tensor
        // (via permutation), so the data lays out as [free axes...,
        // contracted]. Then we can flatten to (M, K) and (N, K) and do a
        // straight GEMM-shaped triple loop.
        let a_perm = move_axis_to_last(a.ndim(), axis_a);
        let b_perm = move_axis_to_last(b.ndim(), axis_b);
        let a = a.permuted_axes(a_perm);
        let b = b.permuted_axes(b_perm);

        let a_shape = a.shape();
        let b_shape = b.shape();
        let m: usize = a_shape[..a_shape.len() - 1].iter().product();
        let n: usize = b_shape[..b_shape.len() - 1].iter().product();
        let k = contracted_len;

        // Flatten to 2D for the matmul. `to_shape` is a reshaping view
        // that reuses the same buffer; we clone into owned at the end.
        let a_mat = a
            .to_shape((m, k))
            .expect("contract: reshape a to (M,K)")
            .to_owned();
        let b_mat = b
            .to_shape((n, k))
            .expect("contract: reshape b to (N,K)")
            .to_owned();

        let mut out = ndarray::Array2::from_elem((m, n), Cplx::new(0.0, 0.0));
        for i in 0..m {
            for j in 0..n {
                let mut acc = Cplx::new(0.0, 0.0);
                for t in 0..k {
                    acc += a_mat[(i, t)] * b_mat[(j, t)];
                }
                out[(i, j)] = acc;
            }
        }

        // Reshape back to the concatenated free-shape.
        let mut out_shape: Vec<usize> = a_shape[..a_shape.len() - 1].to_vec();
        out_shape.extend_from_slice(&b_shape[..b_shape.len() - 1]);
        let out_arr = out
            .into_shape(IxDyn(&out_shape))
            .expect("contract: reshape (M,N) back to free axes");
        Tensor { data: out_arr }
    }

    /// Contract `self` (axis `axis_a`) with `other` (axis `axis_b`),
    /// returning a new tensor whose axes are `[self's other axes...,
    /// other's other axes...]`. Consumes both inputs.
    ///
    /// Mathematically: `result[i..., j...] = Σ_k self[i..., k] * other[j..., k]`
    /// (after moving `axis_a`/`axis_b` to the last position of each).
    ///
    /// Panics on mismatched contracted-axis lengths — that's a programmer
    /// bug in the builder / contraction code, not a runtime input error.
    pub fn trace(self, axis_a: usize, axis_b: usize) -> Tensor {
        let a = self.data;

        let contracted_len = a.shape()[axis_a];
        assert_eq!(
            contracted_len,
            a.shape()[axis_b],
            "contract: axis lengths differ ({axis_a} of self is {}, {axis_b} of other is {})",
            contracted_len,
            a.shape()[axis_b]
        );

        // Move the contracted axis to the *last* position of each tensor
        // so the data lays out as [free axes...,
        // axix_a, axix_b].
        // This is for GEMM-shaped triple loop.
        let mut a_perm: Vec<usize> = (0..a.ndim())
            .filter(|&i| i != axis_a && i != axis_b)
            .collect();
        a_perm.push(axis_a);
        a_perm.push(axis_b);
        let a = a.permuted_axes(a_perm);

        let a_shape = a.shape();
        let m: usize = a_shape[..a_shape.len() - 2].iter().product();
        let k = contracted_len;

        // Flatten to 2D for the matmul. `to_shape` is a reshaping view
        // that reuses the same buffer; we clone into owned at the end.
        let a_mat = a
            .to_shape((m, k, k))
            .expect("contract: reshape a to (M,K,K)")
            .to_owned();

        let mut out: ndarray::Array1<Cplx> = ndarray::Array1::from_elem(m, Cplx::new(0.0, 0.0));
        for i in 0..m {
            let mut acc = Cplx::new(0.0, 0.0);
            for t in 0..k {
                acc += a_mat[(i, t, t)];
                out[i] = acc;
            }
        }

        // Reshape back to the concatenated free-shape.
        let out_shape: Vec<usize> = a_shape[..a_shape.len() - 2].to_vec();
        let out_arr = out
            .into_shape(IxDyn(&out_shape))
            .expect("contract: reshape (M,N) back to free axes");
        Tensor { data: out_arr }
    }

    /// Outer product: `out[i..., j...] = self[i...] * other[j...]`. The
    /// result shape is `self.shape() ++ other.shape()` — no axes are
    /// contracted. Consumes both inputs.
    ///
    /// Used by the contraction layer to combine disconnected components
    /// (plan §5.6) into one result tensor. Mathematically the identity
    /// element is the scalar `1` (a rank-0 tensor), so reducing an empty
    /// list of components returns `Tensor::scalar(1)`.
    pub fn outer_product(self, other: Self) -> Tensor {
        let a = self.data;
        let b = other.data;
        let a_shape: Vec<usize> = a.shape().to_vec();
        let b_shape: Vec<usize> = b.shape().to_vec();

        // ndarray doesn't have a direct outer-product op, but the result
        // is just every entry of `a` times every entry of `b`. The
        // simplest correct impl: flatten both, allocate the concatenated
        // flat buffer, fill entry-by-entry, then reshape back. Output
        // sizes in v1 are tiny (small graphs, few open legs), so O(M·N)
        // is fine.
        let a_total: usize = a_shape.iter().product::<usize>();
        let b_total: usize = b_shape.iter().product::<usize>();
        let a_flat = a
            .to_shape((a_total,))
            .expect("outer_product: flatten a")
            .to_owned();
        let b_flat = b
            .to_shape((b_total,))
            .expect("outer_product: flatten b")
            .to_owned();

        let mut out_flat =
            ndarray::Array1::from_elem(a_total * b_total, Cplx::new(0.0, 0.0));
        for i in 0..a_total {
            for j in 0..b_total {
                out_flat[i * b_total + j] = a_flat[i] * b_flat[j];
            }
        }

        let mut out_shape: Vec<usize> = a_shape;
        out_shape.extend_from_slice(&b_shape);
        let out_arr = out_flat
            .into_shape(IxDyn(&out_shape))
            .expect("outer_product: reshape back");
        Tensor { data: out_arr }
    }

    /// Permute the axes of `self` by `perm`. `perm[k]` is the old axis
    /// that becomes axis `k` in the result. Thin named wrapper around
    /// ndarray's `permuted_axes` so callers in `contraction.rs` don't
    /// pull ndarray into scope directly.
    ///
    /// Used by the contraction layer for the §5.4 final partition: the
    /// inputs→outputs→neutral axis reorder is a permutation applied
    /// after the edge-walk finishes.
    pub fn permuted_axes(self, perm: &[usize]) -> Tensor {
        // ndarray's `permuted_axes` takes a slice of axis indices; we
        // adapt our `&[usize]` to the `IxDyn`-shaped argument it wants.
        let perm_dyn = IxDyn(perm);
        Tensor { data: self.data.permuted_axes(perm_dyn) }
    }

    /// Apply a 2×2 matrix `m` to one axis of `self`, in place along that
    /// axis. Used by the per-vertex builders to derive X-basis tensors
    /// (X spider = H applied to each leg of the Z spider) and to conjugate
    /// box builders. The axis must have length 2 — the only arity our
    /// binary-valued ZXW generators produce per leg.
    ///
    /// Convention: `result[..., j', ...] = Σ_j m[j', j] * self[..., j, ...]`,
    /// i.e. `m`'s rows are the new basis vectors expressed in the old
    /// basis. This matches the standard "matrix acts on a leg" rule.
    pub fn apply_2x2_to_axis(&mut self, axis: usize, m: [[Cplx; 2]; 2]) {
        assert!(
            self.data.shape()[axis] == 2,
            "apply_2x2_to_axis: axis {} has length {} (need 2)",
            axis,
            self.data.shape()[axis]
        );

        let shape = self.data.shape().to_vec();
        let total: usize = shape.iter().product();
        // Row-major layout (ndarray default): the LAST axis varies
        // fastest. The stride of `axis` is the product of all axis
        // lengths *after* it — i.e. the number of flat-buffer elements
        // between "the same position on the next page of `axis`".
        let axis_stride: usize = shape[axis + 1..].iter().product();
        let suffix_len = axis_stride;
        let prefix_len = total / (2 * axis_stride);

        // Flatten to a 1D buffer we can rewrite in place. For each
        // (prefix, suffix) position, the two old entries at offsets
        // (base, base + axis_stride) are combined into two new entries
        // via m. Missing any (prefix, suffix) pair silently leaves old
        // data in place — the kind of bug that breaks `H·z·H = z`
        // round-trips but passes rank-1 unit tests, so the round-trip
        // test in tests/tensor_correctness.rs is the real guard.
        let mut buf = self
            .data
            .clone()
            .into_shape(IxDyn(&[total]))
            .expect("apply_2x2: flatten");
        for prefix in 0..prefix_len {
            for suffix in 0..suffix_len {
                let base = prefix * (2 * axis_stride) + suffix;
                let old0 = buf[base];
                let old1 = buf[base + axis_stride];
                buf[base] = m[0][0] * old0 + m[0][1] * old1;
                buf[base + axis_stride] = m[1][0] * old0 + m[1][1] * old1;
            }
        }
        self.data = buf
            .into_shape(IxDyn(&shape))
            .expect("apply_2x2: reshape back");
    }
}

/// Permutation that moves `axis` to the last position, preserving the
/// relative order of the others. E.g. for ndim=4, axis=1 → `[0, 2, 3, 1]`.
fn move_axis_to_last(ndim: usize, axis: usize) -> Vec<usize> {
    assert!(axis < ndim);
    let mut perm: Vec<usize> = (0..ndim).filter(|&i| i != axis).collect();
    perm.push(axis);
    perm
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::assert_eq_cplx;
    use std::f64::consts::{FRAC_PI_2, PI};

    fn c(re: f64, im: f64) -> Cplx {
        Cplx::new(re, im)
    }

    #[test]
    fn outer_product_shape_is_concatenation() {
        // (2,3) ⊗ (4,) → (2,3,4). Confirms the shape contract before
        // checking values.
        let a = Tensor::from_array(
            ndarray::ArrayD::from_elem(IxDyn(&[2, 3]), Cplx::new(1.0, 0.0)),
        );
        let b = Tensor::from_array(
            ndarray::ArrayD::from_elem(IxDyn(&[4]), Cplx::new(2.0, 0.0)),
        );
        let r = a.outer_product(b);
        assert_eq!(r.shape(), &[2, 3, 4]);
    }

    #[test]
    fn outer_product_entries_are_pairwise_products() {
        // (2,) ⊗ (2,) with distinguishable values. out[i, j] = a[i] * b[j].
        let a = Tensor::from_array(
            ndarray::arr1(&[c(1.0, 0.0), c(2.0, 0.0)]).into_dyn(),
        );
        let b = Tensor::from_array(
            ndarray::arr1(&[c(3.0, 0.0), c(4.0, 0.0)]).into_dyn(),
        );
        let r = a.outer_product(b);
        assert_eq!(r.shape(), &[2, 2]);
        assert_eq!(r.get(&[0, 0]), c(3.0, 0.0)); // 1·3
        assert_eq!(r.get(&[0, 1]), c(4.0, 0.0)); // 1·4
        assert_eq!(r.get(&[1, 0]), c(6.0, 0.0)); // 2·3
        assert_eq!(r.get(&[1, 1]), c(8.0, 0.0)); // 2·4
    }

    #[test]
    fn outer_product_scalar_identity() {
        // A scalar (rank-0) outer-product anything = the other operand
        // scaled by the scalar. This is the identity the empty-graph
        // reduction relies on (no components → scalar 1 → multiply by 1).
        let scalar_one = Tensor::scalar(c(1.0, 0.0));
        let v = Tensor::from_array(ndarray::arr1(&[c(5.0, 0.0), c(7.0, 0.0)]).into_dyn());
        let r = scalar_one.outer_product(v);
        assert_eq!(r.shape(), &[2]);
        assert_eq!(r.get(&[0]), c(5.0, 0.0));
        assert_eq!(r.get(&[1]), c(7.0, 0.0));
    }

    #[test]
    fn permuted_axes_swaps_two_axes_of_a_rank_2_tensor() {
        // Transpose: perm [1, 0] on [[1,2],[3,4]] → [[1,3],[2,4]].
        let t = Tensor::from_array(
            ndarray::arr2(&[[c(1., 0.), c(2., 0.)], [c(3., 0.), c(4., 0.)]]).into_dyn(),
        );
        let r = t.permuted_axes(&[1, 0]);
        assert_eq!(r.get(&[0, 0]), c(1., 0.));
        assert_eq!(r.get(&[0, 1]), c(3., 0.));
        assert_eq!(r.get(&[1, 0]), c(2., 0.));
        assert_eq!(r.get(&[1, 1]), c(4., 0.));
    }

    #[test]
    fn trace_simple_matrices() {
        use crate::nodes::{x_spider, z_spider};

        let z_2 = z_spider(2, 0.0);
        assert_eq_cplx!(c(2.0, 0.0), z_2.trace(0, 1).get(&[]));

        let z_2 = z_spider(2, PI);
        assert_eq_cplx!(c(0.0, 0.0), z_2.trace(0, 1).get(&[]));

        let z_2 = z_spider(2, FRAC_PI_2);
        assert_eq_cplx!(c(1.0, 1.0), z_2.trace(0, 1).get(&[]));

        let x_2 = x_spider(2, 0.0);
        assert_eq_cplx!(c(2.0, 0.0), x_2.trace(0, 1).get(&[]));

        let x_2 = x_spider(2, PI);
        assert_eq_cplx!(c(0.0, 0.0), x_2.trace(0, 1).get(&[]));
    }

    #[test]
    fn scalar_is_rank_zero() {
        let t = Tensor::scalar(c(1.0, 0.0));
        assert_eq!(t.rank(), 0);
        assert_eq!(t.shape(), &[] as &[usize]);
        assert_eq!(t.get(&[]), c(1.0, 0.0));
    }

    #[test]
    fn contract_collapses_one_axis_pair() {
        // a is 2×2 identity, b is a vector [5, 7]. Contract a's axis 1
        // with b's axis 0 → result [5, 7] (identity passes b through).
        let a_arr = ndarray::arr2(&[[c(1., 0.), c(0., 0.)], [c(0., 0.), c(1., 0.)]]);
        let a = Tensor::from_array(a_arr.into_dyn());
        let b_arr = ndarray::arr1(&[c(5., 0.), c(7., 0.)]);
        let b = Tensor::from_array(b_arr.into_dyn());
        let r = a.contract(b, 1, 0);
        assert_eq!(r.shape(), &[2]);
        assert_eq!(r.get(&[0]), c(5., 0.));
        assert_eq!(r.get(&[1]), c(7., 0.));
    }

    #[test]
    #[should_panic(expected = "axis lengths differ")]
    fn contract_mismatched_axis_lengths_panics() {
        let a = Tensor::zeros(&[2, 2]);
        let b = Tensor::zeros(&[3]);
        let _ = a.contract(b, 1, 0);
    }

    #[test]
    fn apply_2x2_to_axis_swaps_entries() {
        // [[0,1],[1,0]] applied to axis 0 of a (2,) vector [a, b] → [b, a].
        let mut t = Tensor::from_array(ndarray::arr1(&[c(1., 0.), c(2., 0.)]).into_dyn());
        let swap = [[c(0., 0.), c(1., 0.)], [c(1., 0.), c(0., 0.)]];
        t.apply_2x2_to_axis(0, swap);
        assert_eq!(t.get(&[0]), c(2., 0.));
        assert_eq!(t.get(&[1]), c(1., 0.));
    }

    #[test]
    fn apply_2x2_to_axis_handles_rank_2_both_columns() {
        // Apply the swap matrix to axis 0 of a 2×2 identity. Every column
        // should have its two entries swapped — axis 0 is the row axis.
        // Regression guard: an earlier impl missed (prefix, suffix)
        // pairs and only rewrote the first suffix position.
        let mut t = Tensor::from_array(
            ndarray::arr2(&[[c(1., 0.), c(2., 0.)], [c(3., 0.), c(4., 0.)]]).into_dyn(),
        );
        let swap = [[c(0., 0.), c(1., 0.)], [c(1., 0.), c(0., 0.)]];
        t.apply_2x2_to_axis(0, swap);
        assert_eq!(t.get(&[0, 0]), c(3., 0.), "row 0 col 0 swapped");
        assert_eq!(t.get(&[1, 0]), c(1., 0.), "row 1 col 0 swapped");
        assert_eq!(t.get(&[0, 1]), c(4., 0.), "row 0 col 1 swapped");
        assert_eq!(t.get(&[1, 1]), c(2., 0.), "row 1 col 1 swapped");
    }

    #[test]
    fn apply_2x2_to_axis_rank_3_axis_in_middle() {
        // Rank-3 shape (2,2,2), apply swap to axis 1 (the *middle* axis).
        // This is the axis-stride layout that the original buggy impl
        // got wrong: axis 1's stride is 1, and the (prefix, suffix)
        // iteration has to cover prefix ∈ [0,2) × suffix ∈ [0,1).
        //
        // Distinguishable values: entry [i,j,k] = 10i + j + k. After
        // swapping axis 1, each [i,*,k] pair flips, so [i,j,k] holds
        // what was at [i,1-j,k].
        let mut values = vec![c(0., 0.); 8];
        for i in 0..2 {
            for j in 0..2 {
                for k in 0..2 {
                    values[i * 4 + j * 2 + k] = c((10 * i + j + k) as f64, 0.);
                }
            }
        }
        let mut t = Tensor::from_array(
            ndarray::ArrayD::from_shape_vec(ndarray::IxDyn(&[2, 2, 2]), values).unwrap(),
        );
        let swap = [[c(0., 0.), c(1., 0.)], [c(1., 0.), c(0., 0.)]];
        t.apply_2x2_to_axis(1, swap);
        // After swap on axis 1: [i,j,k] should now hold old [i,1-j,k].
        for i in 0..2 {
            for j in 0..2 {
                for k in 0..2 {
                    let got = t.get(&[i, j, k]).re as usize;
                    let expected = 10 * i + (1 - j) + k;
                    assert_eq!(got, expected, "[{i},{j},{k}] wrong after axis-1 swap");
                }
            }
        }
    }

    #[test]
    #[should_panic(expected = "need 2")]
    fn apply_2x2_to_axis_rejects_non_binary_axis() {
        // apply_2x2 is only defined for length-2 axes (binary ZXW
        // generators). Applying to a (3,) axis should panic clearly
        // rather than mis-index.
        let mut t = Tensor::zeros(&[3]);
        let id = [[c(1., 0.), c(0., 0.)], [c(0., 0.), c(1., 0.)]];
        t.apply_2x2_to_axis(0, id);
    }

    #[test]
    fn contract_against_matrix_multiplication() {
        // contract(a, b, 1, 0) on two rank-2 tensors is exactly matrix
        // multiplication a·b when both are interpreted as 2×2 matrices.
        // Builds an explicit 2×2 product and compares to a hand-derived
        // matrix; catches transpose bugs in the permute→flatten→reshape
        // pipeline that the identity-vector test above wouldn't notice.
        let a = Tensor::from_array(
            ndarray::arr2(&[[c(1., 0.), c(2., 0.)], [c(3., 0.), c(4., 0.)]]).into_dyn(),
        );
        let b = Tensor::from_array(
            ndarray::arr2(&[[c(5., 0.), c(6., 0.)], [c(7., 0.), c(8., 0.)]]).into_dyn(),
        );
        let r = a.contract(b, 1, 0);
        assert_eq!(r.shape(), &[2, 2]);
        // a·b = [[1·5+2·7, 1·6+2·8],[3·5+4·7, 3·6+4·8]] = [[19,22],[43,50]]
        assert_eq!(r.get(&[0, 0]), c(19., 0.));
        assert_eq!(r.get(&[0, 1]), c(22., 0.));
        assert_eq!(r.get(&[1, 0]), c(43., 0.));
        assert_eq!(r.get(&[1, 1]), c(50., 0.));
    }

    #[test]
    fn contract_along_inner_axis_not_just_last() {
        // contract(a, b, 0, 1): contract axis 0 of a (a non-last axis)
        // with axis 1 of b. The permuted_axes path must move the
        // contracted axis to the end of each before flattening — getting
        // that permutation wrong silently transposes the result. Catch
        // it with distinguishable values.
        //
        // a = [[1, 2], [3, 4]] — contract axis 0 (the rows).
        // b = [[5, 6], [7, 8]] — contract axis 1 (the cols).
        // result[i, j] = Σ_k a[k, i] * b[j, k].
        //   [0,0] = a[0,0]·b[0,0] + a[1,0]·b[0,1] = 1·5 + 3·6 = 23
        //   [0,1] = a[0,0]·b[1,0] + a[1,0]·b[1,1] = 1·7 + 3·8 = 31
        //   [1,0] = a[0,1]·b[0,0] + a[1,1]·b[0,1] = 2·5 + 4·6 = 34
        //   [1,1] = a[0,1]·b[1,0] + a[1,1]·b[1,1] = 2·7 + 4·8 = 46
        let a = Tensor::from_array(
            ndarray::arr2(&[[c(1., 0.), c(2., 0.)], [c(3., 0.), c(4., 0.)]]).into_dyn(),
        );
        let b = Tensor::from_array(
            ndarray::arr2(&[[c(5., 0.), c(6., 0.)], [c(7., 0.), c(8., 0.)]]).into_dyn(),
        );
        let r = a.contract(b, 0, 1);
        assert_eq!(r.shape(), &[2, 2]);
        assert_eq!(r.get(&[0, 0]), c(23., 0.));
        assert_eq!(r.get(&[0, 1]), c(31., 0.));
        assert_eq!(r.get(&[1, 0]), c(34., 0.));
        assert_eq!(r.get(&[1, 1]), c(46., 0.));
    }

    #[test]
    fn contract_with_rank1_operand() {
        // (2,2) · (2,) → (2,): contract a rank-2 identity with a length-2
        // vector. The identity passes the vector through unchanged, which
        // is the simplest non-trivial contraction that exercises the
        // rank-reduction path (rank-2 + rank-1 → rank-1). Catches a
        // regression where contracting with a rank-1 operand mishandles
        // the "no free axes on one side" reshape.
        let id = Tensor::from_array(
            ndarray::arr2(&[[c(1., 0.), c(0., 0.)], [c(0., 0.), c(1., 0.)]]).into_dyn(),
        );
        // Two distinct complex values: (1+0i) and (2+5i).
        let v = Tensor::from_array(ndarray::arr1(&[c(1., 0.), c(2., 5.)]).into_dyn());
        let r = id.contract(v, 1, 0);
        assert_eq!(r.shape(), &[2]);
        // id · v: row 0 = 1·(1+0i) + 0·(2+5i) = (1+0i);
        //         row 1 = 0·(1+0i) + 1·(2+5i) = (2+5i).
        assert_eq!(r.get(&[0]), c(1., 0.));
        assert_eq!(r.get(&[1]), c(2., 5.));
    }

    #[test]
    fn move_axis_to_last_preserves_relative_order_of_others() {
        // Direct test of the permutation helper. The contracted axis
        // moves to the end; the others keep their original order.
        assert_eq!(move_axis_to_last(4, 0), vec![1, 2, 3, 0]);
        assert_eq!(move_axis_to_last(4, 1), vec![0, 2, 3, 1]);
        assert_eq!(move_axis_to_last(4, 3), vec![0, 1, 2, 3]);
        // Rank-1 edge case: the only axis is already last.
        assert_eq!(move_axis_to_last(1, 0), vec![0]);
    }

    // ---- trace: additional coverage ----------------------------------------

    #[test]
    fn trace_reduces_rank_by_two() {
        // trace of a rank-3 tensor over axes 0 and 2 → rank-1 result.
        // The contracted axes are "non-adjacent" so this exercises the
        // `move the two axes to the end` permutation beyond the trivial
        // adjacent case covered by `trace_simple_matrices`.
        //
        // Build a (2, 3, 2) tensor with distinguishable values:
        //   T[i, j, k] = (i + 1) * 100 + (j + 1) * 10 + (k + 1)
        // Trace over axes 0 and 2 (both length 2): result[j] = T[0,j,0] + T[1,j,1].
        //   result[0] = 111 + 212 = 323    (100+10+1) + (200+10+2)
        //   result[1] = 121 + 222 = 343    (100+20+1) + (200+20+2)
        //   result[2] = 131 + 232 = 363    (100+30+1) + (200+30+2)
        let mut values = vec![c(0., 0.); 12];
        for i in 0..2 {
            for j in 0..3 {
                for k in 0..2 {
                    let v = ((i + 1) * 100 + (j + 1) * 10 + (k + 1)) as f64;
                    values[i * 6 + j * 2 + k] = c(v, 0.);
                }
            }
        }
        let t = Tensor::from_array(
            ndarray::ArrayD::from_shape_vec(IxDyn(&[2, 3, 2]), values).unwrap(),
        );
        let r = t.trace(0, 2);
        assert_eq!(r.shape(), &[3], "rank-3 trace over two axes → rank-1");
        assert_eq!(r.get(&[0]), c(323., 0.));
        assert_eq!(r.get(&[1]), c(343., 0.));
        assert_eq!(r.get(&[2]), c(363., 0.));
    }

    #[test]
    #[should_panic(expected = "axis lengths differ")]
    fn trace_mismatched_axis_lengths_panics() {
        // Can't trace a (2, 3) tensor over axes 0 and 1 — lengths differ.
        let t = Tensor::zeros(&[2, 3]);
        let _ = t.trace(0, 1);
    }

    // ---- outer_product: rank ≥ 2 -------------------------------------------

    #[test]
    fn outer_product_rank_2_times_rank_2_yields_rank_4() {
        // (2,2) ⊗ (2,2) → (2,2,2,2). Check a few entries by hand.
        // a = [[1, 2], [3, 4]], b = [[10, 20], [30, 40]] (all real).
        // out[i, j, k, l] = a[i, j] * b[k, l].
        let a = Tensor::from_array(
            ndarray::arr2(&[[c(1., 0.), c(2., 0.)], [c(3., 0.), c(4., 0.)]]).into_dyn(),
        );
        let b = Tensor::from_array(
            ndarray::arr2(&[[c(10., 0.), c(20., 0.)], [c(30., 0.), c(40., 0.)]]).into_dyn(),
        );
        let r = a.outer_product(b);
        assert_eq!(r.shape(), &[2, 2, 2, 2]);
        // Spot-check: out[1, 0, 0, 1] = a[1,0] * b[0,1] = 3 * 20 = 60.
        assert_eq!(r.get(&[1, 0, 0, 1]), c(60., 0.));
        // out[0, 1, 1, 1] = a[0,1] * b[1,1] = 2 * 40 = 80.
        assert_eq!(r.get(&[0, 1, 1, 1]), c(80., 0.));
    }

    // ---- permuted_axes: rank-3 ---------------------------------------------

    #[test]
    fn permuted_axes_on_rank_3_cycles_axes() {
        // (2, 3, 4) with perm [2, 0, 1] → shape (4, 2, 3). Entry at
        // original [i, j, k] moves to new [k, i, j]. We can't easily
        // distinguish values without setting them, so this test just
        // confirms the shape contract — values are covered by the
        // contraction loop's end-to-end tests where permuted_axes is
        // actually used for the §5.4 partition.
        let t = Tensor::from_array(
            ndarray::ArrayD::from_elem(IxDyn(&[2, 3, 4]), c(0., 0.)),
        );
        let r = t.permuted_axes(&[2, 0, 1]);
        assert_eq!(r.shape(), &[4, 2, 3]);
    }

    // ---- contract: commutativity under axis relabeling ---------------------

    #[test]
    fn contract_is_anticommutative_in_axis_order_for_vectors() {
        // For two rank-1 vectors, contracting axis 0 of a with axis 0 of
        // b is just the dot product: a·b == b·a. Confirms the contract
        // primitive is symmetric for rank-1 inputs (a property the
        // contraction loop's `free_axes` bookkeeping implicitly relies
        // on when edges arrive in arbitrary source/target order).
        let a = Tensor::from_array(ndarray::arr1(&[c(1., 0.), c(2., 0.), c(3., 0.)]).into_dyn());
        let b = Tensor::from_array(ndarray::arr1(&[c(4., 0.), c(5., 0.), c(6., 0.)]).into_dyn());
        let ab = a.clone().contract(b.clone(), 0, 0);
        let ba = b.contract(a, 0, 0);
        // Both should be scalars = 1·4 + 2·5 + 3·6 = 32.
        assert_eq!(ab.shape(), &[] as &[usize]);
        assert_eq!(ba.shape(), &[] as &[usize]);
        assert_eq!(ab.get(&[]), c(32., 0.));
        assert_eq!(ba.get(&[]), c(32., 0.));
    }
}

impl fmt::Display for Tensor {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "{}", format!("{}", self.data))
    }
}
