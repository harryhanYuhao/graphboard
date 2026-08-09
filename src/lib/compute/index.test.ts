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
  private messageListeners = new Set<Listener>();
  private errorListeners = new Set<Listener>();

  constructor() {
    MockWorker.lastInstance = this;
  }

  postMessage(msg: WorkerRequest) {
    this.posted.push(msg);
  }

  // Kind-aware like a real Worker: an `error` listener must NOT receive
  // dispatched message events (the wrapper's handshake onerror guard).
  addEventListener(kind: string, fn: Listener) {
    (kind === "error" ? this.errorListeners : this.messageListeners).add(fn);
  }

  removeEventListener(kind: string, fn: Listener) {
    (kind === "error" ? this.errorListeners : this.messageListeners).delete(fn);
  }

  terminate() {
    this.messageListeners.clear();
    this.errorListeners.clear();
  }

  /** Deliver a WorkerResponse as if it came from the worker. */
  dispatch(msg: WorkerResponse) {
    for (const fn of this.messageListeners) {
      fn({ data: msg } as MessageEvent<WorkerResponse>);
    }
  }

  /** Fire the worker `error` event (e.g. the script threw at eval). */
  fireError(event: ErrorEvent) {
    for (const fn of this.errorListeners) {
      fn(event as unknown as MessageEvent<WorkerResponse>);
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

  it("rejects with AbortError when the signal aborts during worker init", async () => {
    const computeTensor = await freshModule();
    const controller = new AbortController();

    const promise = computeTensor(EMPTY_GRAPH, { signal: controller.signal });
    await vi.waitFor(() => expect(MockWorker.lastInstance).not.toBeNull());
    const worker = MockWorker.lastInstance!;
    await waitForPosts(worker, 1); // handshake posted, not yet answered

    // Abort while the handshake is still in flight — the one-shot `abort`
    // event fires before the wrapper can attach its listener, so only the
    // post-await re-check catches it.
    controller.abort();
    // Complete the handshake so getWorker resolves; the post-await check
    // must then refuse to post the compute.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const wasmPkg: { version: string } = require("../../../public/wasm/zxw/package.json");
    worker.dispatch({ type: "version-ok", version: wasmPkg.version });

    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(worker.posted.filter((m) => m.type === "compute")).toHaveLength(0);
  });

  it("rejects when the worker fires an error during the handshake, then recovers on the next call", async () => {
    const computeTensor = await freshModule();

    const promise = computeTensor(EMPTY_GRAPH);
    await vi.waitFor(() => expect(MockWorker.lastInstance).not.toBeNull());
    const firstWorker = MockWorker.lastInstance!;
    await waitForPosts(firstWorker, 1);

    // Worker script threw at eval → `error` event, no handshake reply.
    firstWorker.fireError({ message: "bad wasm import" } as ErrorEvent);
    await expect(promise).rejects.toThrow(/Worker failed to start/);

    // The failed worker must not be cached: the next call spawns a fresh
    // one and works normally.
    const retry = computeTensor(EMPTY_GRAPH);
    await vi.waitFor(() => expect(MockWorker.lastInstance).not.toBe(firstWorker));
    const secondWorker = MockWorker.lastInstance!;
    await waitForPosts(secondWorker, 1);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const wasmPkg: { version: string } = require("../../../public/wasm/zxw/package.json");
    secondWorker.dispatch({ type: "version-ok", version: wasmPkg.version });
    await waitForPosts(secondWorker, 2);
    if (secondWorker.posted[1].type !== "compute") throw new Error("unreachable");
    const requestId = secondWorker.posted[1].requestId;
    secondWorker.dispatch({ type: "result", requestId, result: SAMPLE_RESULT });
    await expect(retry).resolves.toEqual(SAMPLE_RESULT);
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
