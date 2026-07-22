// src/lib/compute/index.ts
//
// Browser-side wrapper around the Rust/WASM compute layer. Owns the
// Web Worker lifecycle, performs a version handshake on first use,
// and exposes `computeTensor(graph, callbacks)` — the single entry
// point components call.
//
// Architecture (plan §6.3):
//   - Lazy worker spawn on first `computeTensor` call.
//   - Version handshake: refuse to call into a stale cached .wasm.
//   - `onProgress` + `AbortSignal` callback plumbing for the UI.
//   - Worker stays warm for subsequent calls; terminated on page
//     unload via `beforeunload`.
//
// The cached-rejection-bug fix: if init fails (worker load error,
// version mismatch), reset `workerPromise = null` so the next call
// retries instead of permanently rejecting — without this, every
// future call fails immediately with no recovery short of a reload.

import { nanoid } from "nanoid";
import type { GraphSlice } from "@/lib/graph/types";
import type { WorkerRequest, WorkerResponse } from "./types";
import type { TensorResult } from "./result-types";

// Source of truth for the expected wasm version: the built wasm's
// `package.json`. `wasm-pack` emits one at `public/wasm/zxw/package.json`
// on every build, so importing it directly keeps the frontend and the
// crate version locked — a `Cargo.toml` bump can't silently drift the
// handshake.
import wasmPkg from "../../../public/wasm/zxw/package.json";

const EXPECTED_WASM_VERSION = wasmPkg.version;

// ── Worker lifecycle ───────────────────────────────────────────────

let workerPromise: Promise<Worker> | null = null;

async function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const worker = new Worker(new URL("./worker.ts", import.meta.url), {
        type: "module",
      });

      try {
        // Version handshake. Fail early if the deployed .wasm doesn't
        // match what this frontend build expects — prevents subtle
        // serde_wasm_bindgen errors when a browser caches an old
        // .wasm after a deploy that changes the JsValue contract.
        const version = await new Promise<string>((resolve, reject) => {
          const onMsg = (e: MessageEvent<WorkerResponse>) => {
            const m = e.data;
            if (m.type === "version-ok") {
              worker.removeEventListener("message", onMsg);
              resolve(m.version);
            } else if (m.type === "error" && m.requestId === "version-check") {
              worker.removeEventListener("message", onMsg);
              reject(new Error(m.error));
            }
          };
          worker.addEventListener("message", onMsg);
          worker.postMessage({ type: "version-check" } satisfies WorkerRequest);
        });

        if (version !== EXPECTED_WASM_VERSION) {
          throw new Error(
            `WASM version mismatch: expected ${EXPECTED_WASM_VERSION}, ` +
              `got ${version}. Rebuild with \`pnpm build:wasm\` and refresh.`,
          );
        }

        return worker;
      } catch (err) {
        // Critical: reset the memo so the next `computeTensor` call
        // spins up a fresh worker instead of permanently rejecting.
        // (A rejected promise cached in `workerPromise` would fail
        // every subsequent call with no recovery.)
        worker.terminate();
        workerPromise = null;
        throw err;
      }
    })();
  }
  return workerPromise;
}

// Clean up on page unload. The worker is long-lived per page session;
// no need to terminate it between compute calls.
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    if (workerPromise) {
      // The promise may not have resolved yet; wait is unsafe in
      // beforeunload, so just nuke the worker reference and let GC
      // handle it. The browser will reap the worker thread on tab
      // close regardless.
      workerPromise.then((w) => w.terminate()).catch(() => {});
      workerPromise = null;
    }
  });
}

// ── Public API ─────────────────────────────────────────────────────

export type ComputeCallbacks = {
  /** Called after each edge is contracted: `(contracted, total)`. */
  onProgress?: (contracted: number, total: number) => void;
  /**
   * Abort to cancel the computation. The promise rejects with an
   * `AbortError`; the worker keeps running (v1 soft cancel — see
   * `worker.ts`).
   */
  signal?: AbortSignal;
};

/**
 * Compute the tensor represented by a ZXW graph.
 *
 * Resolves with the `TensorResult` (shape, values, warnings, boundary
 * counts) on success. Rejects with an `Error` if:
 *   - the worker can't be initialised (load failure, version mismatch),
 *   - the graph is structurally invalid (`ComputeError` from Rust), or
 *   - the caller aborted the `signal`.
 *
 * Per-spider phase-parse failures do NOT reject — they're caught on
 * the Rust side and surfaced on `result.warnings` (plan §5.5).
 */
export async function computeTensor(
  graph: GraphSlice,
  callbacks?: ComputeCallbacks,
): Promise<TensorResult> {
  const { signal, onProgress } = callbacks ?? {};

  // Early-abort short-circuit: skip the worker spawn entirely if the
  // caller already cancelled. Without this, the await on `getWorker`
  // (which waits for the version handshake) would block uselessly and
  // the rejection would come seconds later instead of immediately.
  if (signal?.aborted) {
    throw new DOMException("Computation cancelled", "AbortError");
  }

  const worker = await getWorker();
  const requestId = nanoid();

  return new Promise<TensorResult>((resolve, reject) => {
    const onMessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      // `version-ok` is a handshake reply (no requestId); the compute
      // protocol messages all carry requestId. Filter on the latter
      // *after* checking the type so TS narrows correctly.
      if (msg.type !== "version-ok" && msg.requestId !== requestId) {
        return;
      }

      switch (msg.type) {
        case "progress":
          onProgress?.(msg.contracted, msg.total);
          break;
        case "result":
          cleanup();
          resolve(msg.result);
          break;
        case "error":
          cleanup();
          reject(new Error(msg.error));
          break;
        case "version-ok":
          // Shouldn't arrive here (handled by getWorker's handshake),
          // but be defensive.
          break;
      }
    };

    const onAbort = () => {
      worker.postMessage({ type: "cancel", requestId } satisfies WorkerRequest);
      cleanup();
      reject(new DOMException("Computation cancelled", "AbortError"));
    };

    const cleanup = () => {
      worker.removeEventListener("message", onMessage);
      signal?.removeEventListener("abort", onAbort);
    };

    signal?.addEventListener("abort", onAbort, { once: true });
    worker.addEventListener("message", onMessage);
    worker.postMessage({ type: "compute", requestId, graph } satisfies WorkerRequest);
  });
}

// ── Legacy smoke test (kept for backward compat) ───────────────────
//
// The Phase 2 `ping()` smoke test. No longer used by the UI (the
// Compute button calls `computeTensor` now), but retained because
// `scripts/ping-wasm.mts` exercises the same path Node-side and the
// direct main-thread call is occasionally useful for debugging the
// wasm load separately from the worker protocol.

type WasmModule = typeof import("../../../public/wasm/zxw/zxw.js");
let directWasmPromise: Promise<WasmModule> | null = null;

async function loadWasmDirect(): Promise<WasmModule> {
  if (!directWasmPromise) {
    directWasmPromise = (async () => {
      const mod = await import("../../../public/wasm/zxw/zxw.js");
      await mod.default();
      return mod;
    })();
  }
  return directWasmPromise;
}

export async function pingWasm(): Promise<string> {
  const wasm = await loadWasmDirect();
  if (typeof wasm.ping !== "function") {
    throw new Error(
      "Loaded WASM module does not export `ping`. The deployed artifact " +
        "may be stale — rebuild with `pnpm build:wasm`.",
    );
  }
  return wasm.ping();
}
