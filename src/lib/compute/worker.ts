// src/lib/compute/worker.ts
//
// Web Worker that owns the WASM compute module. Runs in a dedicated
// thread (off the main UI thread), lazy-loads the wasm on first
// message, and services compute / cancel / version-check requests
// from the main thread.
//
// A worker keeps the UI responsive during contraction and makes progress /
// cancellation natural. See `doc/plans.md` §6.2.
//
// This file runs in a Worker context — no DOM, no React, no store. It
// only talks to the main thread via `postMessage` / `onmessage`.

import type { WorkerRequest, WorkerResponse } from "./types";
import { classifyComputeError } from "./errors";

// `self` in a Web Worker is a `WorkerGlobalScope`, not `Window`. The
// default DOM lib types `self` as `Window & typeof globalThis`, which
// doesn't have `onmessage`/`postMessage` with the worker signature.
// Cast to the worker-typed shape we actually use. (Adding `"WebWorker"`
// to tsconfig `lib` would fix this globally but would also change the
// type of `self` everywhere — too invasive for one file.)
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
      // `mod.default()` is the async init function wasm-bindgen
      // generates; calling it once fetches + instantiates the .wasm.
      // The `start` attribute on `init_panic_hook` makes it auto-run
      // during instantiation, so panics surface as console.error from
      // here on.
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
        // Load failure — surface as an error reply (the main thread
        // treats any non-version-ok response during the handshake as
        // a worker-init failure).
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

        // Wrap postMessage in a plain function we hand to Rust as the
        // `onProgress` callback. The Rust side calls it with
        // `(current, total)`; we relay both to the main thread tagged
        // with the requestId so the UI can update the right progress
        // bar (only one in-flight in v1, but the requestId keeps the
        // protocol future-proof).
        const onProgress = (contracted: number, total: number) => {
          ctx.postMessage({
            type: "progress",
            requestId,
            contracted,
            total,
          } satisfies WorkerResponse);
        };

        // `compute_tensor` throws synchronously on a structural error
        // (ComputeError), so the try/catch around it surfaces those as
        // `error` replies. Per-spider parse failures are NOT thrown —
        // they end up on `result.warnings`.
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
      // v1 soft cancel: the main-thread client discards the result of
      // the cancelled requestId and the worker runs to completion.
      // Full cooperative cancellation (the Rust progress callback
      // returning a `Result` that unwinds the contraction) is a
      // Phase 6 enhancement — see `doc/plans.md` §6.2 "Cooperative
      // cancellation (future enhancement)".
      break;
    }
  }
};
