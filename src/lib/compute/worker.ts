// Web Worker owning the WASM compute module. Lazy-loads the wasm on
// first message, services compute / cancel / version-check requests.
// No DOM, React, or store here — only `postMessage` / `onmessage`.

import type { WorkerRequest, WorkerResponse } from "./types";
import { classifyComputeError } from "./errors";

// `self` in a Worker is `WorkerGlobalScope`, but DOM lib types it as
// `Window`. Cast to the worker shape we use (adding `"WebWorker"` to
// tsconfig `lib` would be global, too invasive for one file).
const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
  postMessage: (msg: WorkerResponse) => void;
};

type WasmModule = typeof import("../../../public/wasm/zxw/zxw.js");

let wasmPromise: Promise<WasmModule> | null = null;

async function loadWasm(): Promise<WasmModule> {
  if (!wasmPromise) {
    wasmPromise = (async () => {
      const mod = await import("../../../public/wasm/zxw/zxw.js");
      // wasm-bindgen init: fetches + instantiates the .wasm and wires
      // the panic hook so panics surface as console.error.
      await mod.default();
      return mod;
    })();
  }
  return wasmPromise;
}

ctx.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  switch (msg.type) {
    case "version-check": {
      try {
        const w = await loadWasm();
        ctx.postMessage({
          type: "version-ok",
          version: w.compute_api_version(),
        } satisfies WorkerResponse);
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        ctx.postMessage({
          type: "error",
          requestId: "version-check",
          error,
          errorKind: classifyComputeError(error),
        } satisfies WorkerResponse);
      }
      break;
    }

    case "compute": {
      const requestId = msg.requestId;
      try {
        const w = await loadWasm();

        // Progress callback handed to Rust; relayed to the main thread
        // tagged with requestId so the UI updates the right run.
        const onProgress = (contracted: number, total: number) => {
          ctx.postMessage({
            type: "progress",
            requestId,
            contracted,
            total,
          } satisfies WorkerResponse);
        };

        // `compute_tensor` throws synchronously on structural errors
        // (surfaced as `error` replies); per-spider parse failures go
        // on `result.warnings` instead.
        const result = w.compute_tensor(msg.graph, onProgress);
        ctx.postMessage({
          type: "result",
          requestId,
          result: result as unknown as import("./result-types").TensorResult,
        } satisfies WorkerResponse);
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        ctx.postMessage({
          type: "error",
          requestId,
          error,
          errorKind: classifyComputeError(error),
        } satisfies WorkerResponse);
      }
      break;
    }

    case "cancel": {
      // Soft cancel: the main thread discards this requestId's result;
      // the worker runs to completion.
      break;
    }
  }
};
