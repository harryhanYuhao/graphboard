#[macro_export]
macro_rules! assert_eq_cplx {
    ($a:expr, $b:expr $(,)?) => {
        assert_eq_cplx!($a, $b, 1e-8_f64)
    };
    ($a:expr, $b:expr, $eps:expr $(,)?) => {{
        let a = $a;
        let b = $b;
        let eps = $eps;
        let diff = a - b;
        assert!(
            diff.norm() < eps,
            "assertion failed: |a - b| = {:?} >= {:?}\na = {:?}\nb = {:?}",
            diff.norm(),
            eps,
            a,
            b
        );
    }};
}
