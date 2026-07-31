// Compute wrapper tests. The Worker is mocked via `vi.stubGlobal("Worker")`
// so CI stays JS-only. The mock captures `postMessage` calls and exposes a
// `dispatch` helper to feed `WorkerResponse` messages back. `index.ts`
// caches the worker promise at module scope, so each test re-imports the
// module freshly via `vi.resetModules()` + dynamic `import()`.

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

  /** Deliver a WorkerResponse as if it came from the worker. */
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

/** Fresh module import + mock worker setup; returns the computeTensor fn. */
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

    // The first postMessage is the version-check.
    await waitForPosts(worker, 1);
    expect(worker.posted[0]).toEqual({ type: "version-check" });

    // Reply with the version the wrapper expects (from the built wasm's package.json).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const wasmPkg: { version: string } = require("../../../public/wasm/zxw/package.json");
    worker.dispatch({ type: "version-ok", version: wasmPkg.version });

    // The compute request then lands.
    await waitForPosts(worker, 2);
    expect(worker.posted[1].type).toBe("compute");
    if (worker.posted[1].type !== "compute") throw new Error("unreachable");
    expect(worker.posted[1].graph).toBe(EMPTY_GRAPH);
    const requestId = worker.posted[1].requestId;
    expect(typeof requestId).toBe("string");

    // Reply with a result — the promise resolves with it.
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

    // Finish the call so the promise settles cleanly.
    worker.dispatch({ type: "result", requestId, result: SAMPLE_RESULT });
    await expect(promise).resolves.toEqual(SAMPLE_RESULT);
  });

  it("rejects with AbortError when signal is already aborted", async () => {
    const computeTensor = await freshModule();

    const controller = new AbortController();
    controller.abort();
    // Message is "Computation cancelled", which doesn't contain "AbortError".
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

    // Reply with a wrong version.
    worker.dispatch({ type: "version-ok", version: "999.999.999" });
    await expect(promise).rejects.toThrow(/version mismatch/i);
  });

  it("retries with a fresh worker after version mismatch (cached-rejection fix)", async () => {
    // A failed init resets the module-level `workerPromise` to null, so a
    // second call spawns a new worker rather than rejecting from the cache.
    const computeTensor = await freshModule();

    // First call: wrong version → rejection.
    const promise1 = computeTensor(EMPTY_GRAPH);
    await vi.waitFor(() => expect(MockWorker.lastInstance).not.toBeNull());
    const worker1 = MockWorker.lastInstance!;
    await waitForPosts(worker1, 1);
    worker1.dispatch({ type: "version-ok", version: "999.999.999" });
    await expect(promise1).rejects.toThrow(/version mismatch/i);

    // Second call: must spawn a new worker (not reuse the rejected one).
    const promise2 = computeTensor(EMPTY_GRAPH);
    await vi.waitFor(() => {
      expect(MockWorker.lastInstance).not.toBeNull();
      expect(MockWorker.lastInstance).not.toBe(worker1);
    });
    const worker2 = MockWorker.lastInstance!;
    await waitForPosts(worker2, 1);

    // Reply with the correct version — the call proceeds and resolves.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const wasmPkg: { version: string } = require("../../../public/wasm/zxw/package.json");
    worker2.dispatch({ type: "version-ok", version: wasmPkg.version });
    await waitForPosts(worker2, 2);
    expect(worker2.posted[1].type).toBe("compute");
    if (worker2.posted[1].type !== "compute") throw new Error("unreachable");
    const requestId = worker2.posted[1].requestId;

    worker2.dispatch({ type: "result", requestId, result: SAMPLE_RESULT });
    await expect(promise2).resolves.toEqual(SAMPLE_RESULT);
  });
});
