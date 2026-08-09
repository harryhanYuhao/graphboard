// Browser-side wrapper around the Rust/WASM compute layer. Owns the
// Web Worker lifecycle, does a version handshake on first use, and
// exposes `computeTensor` as the single entry point.

import { nanoid } from "nanoid";
import type { GraphSlice } from "@/lib/graph/types";
import type { WorkerRequest, WorkerResponse } from "./types";
import type { TensorResult } from "./result-types";
import { classifyComputeError, ComputeError } from "./errors";

// Expected wasm version: read from the built wasm's `package.json`
// (`wasm-pack` emits it), so a Cargo.toml bump can't silently drift
// the handshake.
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
        // Refuse a stale cached .wasm whose JsValue contract no longer
        // matches this frontend build.
        const version = await new Promise<string>((resolve, reject) => {
          const onMsg = (e: MessageEvent<WorkerResponse>) => {
            const m = e.data;
            if (m.type === "version-ok") {
              cleanupHandshake();
              resolve(m.version);
            } else if (m.type === "error" && m.requestId === "version-check") {
              cleanupHandshake();
              reject(
                new ComputeError(
                  m.errorKind ?? classifyComputeError(m.error),
                  m.error,
                ),
              );
            }
          };
          // A worker that throws at eval (e.g. a bad wasm import) never posts
          // a handshake reply; without this the version promise would hang
          // forever and the compute dialog would spin indefinitely.
          const onError = (e: ErrorEvent) => {
            cleanupHandshake();
            reject(
              new ComputeError(
                "load-failed",
                `Worker failed to start: ${e.message ?? "unknown worker error"}`,
              ),
            );
          };
          const cleanupHandshake = () => {
            worker.removeEventListener("message", onMsg);
            worker.removeEventListener("error", onError);
          };
          worker.addEventListener("message", onMsg);
          worker.addEventListener("error", onError);
          worker.postMessage({ type: "version-check" } satisfies WorkerRequest);
        });

        if (version !== EXPECTED_WASM_VERSION) {
          throw new ComputeError(
            "version-mismatch",
            `WASM version mismatch: expected ${EXPECTED_WASM_VERSION}, ` +
              `got ${version}. Rebuild with \`pnpm build:wasm\` and refresh.`,
          );
        }

        return worker;
      } catch (err) {
        // Reset the memo so the next call retries; a cached rejected
        // promise would fail every subsequent call with no recovery.
        worker.terminate();
        workerPromise = null;
        throw err;
      }
    })();
  }
  return workerPromise;
}

// Terminate the warm worker on page unload.
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    if (workerPromise) {
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
   * `AbortError`; the worker keeps running (soft cancel — see `worker.ts`).
   */
  signal?: AbortSignal;
};

/**
 * Compute the tensor represented by a ZXW graph.
 *
 * Resolves with the `TensorResult` on success. Rejects on worker init
 * failure, structural graph invalidity (`ComputeError` from Rust), or
 * abort. Per-spider phase-parse failures do not reject — they surface
 * on `result.warnings`.
 */
export async function computeTensor(
  graph: GraphSlice,
  callbacks?: ComputeCallbacks,
): Promise<TensorResult> {
  const { signal, onProgress } = callbacks ?? {};

  // Skip the worker spawn (and the handshake await) if already aborted.
  if (signal?.aborted) {
    throw new DOMException("Computation cancelled", "AbortError");
  }

  const worker = await getWorker();

  // The signal may have aborted while the worker spawned / handshook: an
  // abort listener attached now would miss the one-shot `abort` event, so
  // the post-await check is what actually cancels that window.
  if (signal?.aborted) {
    throw new DOMException("Computation cancelled", "AbortError");
  }

  const requestId = nanoid();

  return new Promise<TensorResult>((resolve, reject) => {
    const onMessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      // `version-ok` is a handshake reply (no requestId); all compute
      // messages carry requestId. Check type first so TS narrows.
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
          reject(
            new ComputeError(
              msg.errorKind ?? classifyComputeError(msg.error),
              msg.error,
            ),
          );
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
