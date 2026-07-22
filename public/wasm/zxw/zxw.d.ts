/* tslint:disable */
/* eslint-disable */

/**
 * Return the crate version string. The frontend asserts it matches the
 * expected value (read from the built wasm's `package.json`) before
 * calling any compute function
 */
export function compute_api_version(): string;

/**
 * Compute the tensor represented by a ZXW graph.
 *
 * `input` is a JS object matching the `GraphSlice` shape (camelCase,
 * nested `data` wrapper — see `src/graph.rs`). `on_progress`, if
 * supplied, is called after each edge contraction with
 * `(contracted_so_far, total_edges)`.
 *
 * Returns a JS object matching `TensorResult` (camelCase fields). On a
 * structural `ComputeError` (corrupt graph, boundary degree > 1, …)
 * the result is thrown as a JS `Error` with the message from the
 * Rust-side `Display` impl.
 *
 * Per-spider phase-parse failures are NOT errors here — they're caught
 * inside `zxw::compute_tensor` and surface as `warnings` on the
 * returned `TensorResult` (plan §5.5).
 */
export function compute_tensor(input: any, on_progress?: Function | null): any;

/**
 * Install the panic hook on module instantiation. `#[wasm_bindgen(start)]`
 * makes the JS glue call this automatically when the `.wasm` instantiates,
 * so callers never have to remember it. Without the hook a panic (e.g. an
 * ndarray bounds error mid-contraction) silently aborts the worker
 */
export function init_panic_hook(): void;

/**
 * Trivial round-trip smoke test.
 * Used by `scripts/ping-wasm.mts` to confirm the wasm pipeline is
 * healthy end-to-end.
 */
export function ping(): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly compute_api_version: () => [number, number];
    readonly compute_tensor: (a: any, b: number) => [number, number, number];
    readonly init_panic_hook: () => void;
    readonly ping: () => [number, number];
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
