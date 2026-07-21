// src/lib/compute/index.ts
//
// Browser-side wrapper around the Rust/WASM compute layer. Today this
// only exposes the Phase 2 `ping()` smoke-test entry point — enough to
// prove the wasm pipeline (fetch → instantiate → call) works end-to-end
// from a button click before the real compute engine (Phase 4/5) lands.
//
// Phase 5 will replace the body of this module with a Web Worker that
// owns the wasm instance and exposes `computeTensor(graph, callbacks)`
// (see `doc/plans.md` §6.3). The lazy-load + cached-promise pattern
// here is deliberately the shape that worker wrapper will grow into,
// so the call sites (GraphToolbar) don't change.
//
// `public/wasm/zxw/` is served as a static asset by Next.js. The `@/*`
// alias maps to `src/*`, so we use a relative path to reach it.

// The wasm module's default export is the async init function; calling
// it once fetches + instantiates the `.wasm` binary. The named exports
// (`ping`, and later `compute_tensor`) are only callable after init
// resolves. We cache the init promise so repeated clicks don't
// re-fetch.

type WasmModule = typeof import("../../../public/wasm/zxw/zxw.js");

let wasmPromise: Promise<WasmModule> | null = null;

async function loadWasm(): Promise<WasmModule> {
  if (!wasmPromise) {
    wasmPromise = (async () => {
      // Dynamic import so the ~13KB wasm binary + glue is only fetched
      // on first Compute click, not at page load.
      const mod = await import("../../../public/wasm/zxw/zxw.js");
      await mod.default(); // fetch + instantiate the .wasm artifact
      return mod;
    })();
  }
  return wasmPromise;
}

/**
 * Phase 2 smoke test: round-trip a literal through the wasm module.
 * Returns `"pong"` on success. Throws if the wasm binary can't be
 * loaded or `ping` is missing (e.g. the deployed artifact is stale).
 *
 * The Compute button calls this to verify the pipeline before the real
 * `compute_tensor` entry point exists.
 */
export async function pingWasm(): Promise<string> {

  // For testing
  const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
  await sleep(1000);

  const wasm = await loadWasm();
  if (typeof wasm.ping !== "function") {
    throw new Error(
      "Loaded WASM module does not export `ping`. The deployed artifact " +
      "may be stale — rebuild with `pnpm build:wasm`.",
    );
  }
  return wasm.ping();
}
