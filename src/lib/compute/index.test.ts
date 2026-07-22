// src/lib/compute/index.test.ts
//
// Unit tests for the compute wrapper. The Web Worker is mocked via
// `vi.stubGlobal("Worker", ...)` so CI stays JS-only (plan §9.4) — no
// need to stand up a real wasm build or worker thread.
//
// The mock captures `postMessage` calls so tests can assert the
// request shape, and exposes a `dispatch` helper so tests can deliver
// `WorkerResponse` messages back to the wrapper as if they came from
// the (real) worker.
//
// Module caching: `index.ts` caches the worker promise at module scope.
// Each test re-imports the module freshly via `vi.resetModules()` +
// dynamic `import()` so the cache resets between tests.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { GraphSlice } from "@/lib/graph/types";
import type { WorkerRequest, WorkerResponse } from "./types";
import type { TensorResult } from "./result-types";

// --- Mock worker -----------------------------------------------------------

type Listener = (e: MessageEvent<WorkerResponse>) => void;

class MockWorker {
  static lastInstance: MockWorker | null = null;
  posted: WorkerRequest[] = [];
  private listeners = new Set<Listener>();

  constructor() {
    MockWorker.lastInstance = this;
  }

  postMessage(msg: WorkerRequest) {
    this.posted.push(msg);
  }

  addEventListener(_kind: string, fn: Listener) {
    this.listeners.add(fn);
  }

  removeEventListener(_kind: string, fn: Listener) {
    this.listeners.delete(fn);
  }

  terminate() {
    this.listeners.clear();
  }

  /** Test helper: deliver a WorkerResponse as if it came from the worker. */
  dispatch(msg: WorkerResponse) {
    for (const fn of this.listeners) {
      fn({ data: msg } as MessageEvent<WorkerResponse>);
    }
  }
}

// --- Helpers ---------------------------------------------------------------

const EMPTY_GRAPH: GraphSlice = { nodes: [], edges: [] };

const SAMPLE_RESULT: TensorResult = {
  shape: [],
  data: [[1, 0]],
  warnings: [],
  inputCount: 0,
  outputCount: 0,
};

/** Wait for a worker to receive N posted messages. */
async function waitForPosts(worker: MockWorker, n: number) {
  for (let i = 0; i < 100; i++) {
    if (worker.posted.length >= n) return;
    await new Promise((r) => setTimeout(r, 1));
  }
  throw new Error(`timed out waiting for ${n} postMessage calls`);
}

/** Fresh module import + mock worker setup. Returns the computeTensor fn. */
async function freshModule() {
  vi.resetModules();
  vi.stubGlobal("Worker", MockWorker);
  MockWorker.lastInstance = null;
  const mod = await import("./index");
  return mod.computeTensor;
}

// --- Tests -----------------------------------------------------------------

describe("computeTensor", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("performs version handshake then posts a compute request", async () => {
    const computeTensor = await freshModule();

    const promise = computeTensor(EMPTY_GRAPH);
    await vi.waitFor(() => expect(MockWorker.lastInstance).not.toBeNull());
    const worker = MockWorker.lastInstance!;

    // The very first postMessage should be the version-check.
    await waitForPosts(worker, 1);
    expect(worker.posted[0]).toEqual({ type: "version-check" });

    // Reply with a version-ok. Use the same version the wrapper expects
    // (read from the built wasm's package.json).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const wasmPkg: { version: string } = require("../../../public/wasm/zxw/package.json");
    worker.dispatch({ type: "version-ok", version: wasmPkg.version });

    // Now the compute request should land.
    await waitForPosts(worker, 2);
    expect(worker.posted[1].type).toBe("compute");
    if (worker.posted[1].type !== "compute") throw new Error("unreachable");
    expect(worker.posted[1].graph).toBe(EMPTY_GRAPH);
    const requestId = worker.posted[1].requestId;
    expect(typeof requestId).toBe("string");

    // Reply with a result — the promise should resolve with it.
    worker.dispatch({ type: "result", requestId, result: SAMPLE_RESULT });
    await expect(promise).resolves.toEqual(SAMPLE_RESULT);
  });

  it("rejects when the worker reports an error", async () => {
    const computeTensor = await freshModule();

    const promise = computeTensor(EMPTY_GRAPH);
    await vi.waitFor(() => expect(MockWorker.lastInstance).not.toBeNull());
    const worker = MockWorker.lastInstance!;
    await waitForPosts(worker, 1);

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const wasmPkg: { version: string } = require("../../../public/wasm/zxw/package.json");
    worker.dispatch({ type: "version-ok", version: wasmPkg.version });
    await waitForPosts(worker, 2);
    if (worker.posted[1].type !== "compute") throw new Error("unreachable");
    const requestId = worker.posted[1].requestId;

    worker.dispatch({ type: "error", requestId, error: "boom" });
    await expect(promise).rejects.toThrow("boom");
  });

  it("forwards progress messages to onProgress", async () => {
    const computeTensor = await freshModule();

    const onProgress = vi.fn();
    const promise = computeTensor(EMPTY_GRAPH, { onProgress });
    await vi.waitFor(() => expect(MockWorker.lastInstance).not.toBeNull());
    const worker = MockWorker.lastInstance!;
    await waitForPosts(worker, 1);

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const wasmPkg: { version: string } = require("../../../public/wasm/zxw/package.json");
    worker.dispatch({ type: "version-ok", version: wasmPkg.version });
    await waitForPosts(worker, 2);
    if (worker.posted[1].type !== "compute") throw new Error("unreachable");
    const requestId = worker.posted[1].requestId;

    worker.dispatch({ type: "progress", requestId, contracted: 1, total: 3 });
    worker.dispatch({ type: "progress", requestId, contracted: 2, total: 3 });
    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress).toHaveBeenLastCalledWith(2, 3);

    // Finish the call so the promise settles and the test exits cleanly.
    worker.dispatch({ type: "result", requestId, result: SAMPLE_RESULT });
    await expect(promise).resolves.toEqual(SAMPLE_RESULT);
  });

  it("rejects with AbortError when signal is already aborted", async () => {
    const computeTensor = await freshModule();

    const controller = new AbortController();
    controller.abort();
    // The early-abort path rejects with a DOMException(name=AbortError,
    // message="Computation cancelled"). Check the name explicitly — the
    // message "Computation cancelled" doesn't contain "AbortError".
    await expect(
      computeTensor(EMPTY_GRAPH, { signal: controller.signal }),
    ).rejects.toThrow(/cancelled/i);
  });

  it("rejects with version mismatch when the deployed version differs", async () => {
    const computeTensor = await freshModule();

    const promise = computeTensor(EMPTY_GRAPH);
    await vi.waitFor(() => expect(MockWorker.lastInstance).not.toBeNull());
    const worker = MockWorker.lastInstance!;
    await waitForPosts(worker, 1);

    // Reply with a WRONG version.
    worker.dispatch({ type: "version-ok", version: "999.999.999" });
    await expect(promise).rejects.toThrow(/version mismatch/i);
  });
});
