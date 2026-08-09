import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useGraphStore } from "@/store/graph-store";
import { ComputeError } from "@/lib/compute/errors";
import { useCompute } from "./useCompute";
import { makeVertexWith, makeEdge } from "@/test-utils/factories";

// Mock the worker entry so we can assert whether it's actually called.
// The real `computeTensor` spawns a Web Worker — unsuitable for jsdom.
const computeTensorMock = vi.fn();
vi.mock("@/lib/compute", () => ({
  computeTensor: (...args: unknown[]) => computeTensorMock(...args),
}));

describe("useCompute — validation gate", () => {
  beforeEach(() => {
    computeTensorMock.mockReset();
    // Start each test from an empty graph.
    useGraphStore.getState().reset();
  });

  it("does not call computeTensor when the graph is structurally invalid", () => {
    // W node with no input + no outputs → invalid.
    useGraphStore.setState({
      nodes: [makeVertexWith("w", { data: { vertexType: "w" } })],
    });

    const { result } = renderHook(() => useCompute());
    act(() => result.current.requestCompute());

    expect(computeTensorMock).not.toHaveBeenCalled();
  });

  it("surfaces the first validation error as a rejected ComputeError", async () => {
    useGraphStore.setState({
      nodes: [makeVertexWith("w", { data: { vertexType: "w" } })],
    });

    const { result } = renderHook(() => useCompute());
    act(() => result.current.requestCompute());

    expect(result.current.computeOpen).toBe(true);
    expect(result.current.computePromise).not.toBeNull();
    await expect(result.current.computePromise).rejects.toThrow(ComputeError);
    await expect(result.current.computePromise).rejects.toMatchObject({
      kind: "w-input-count",
    });
    // Errors are published to the store keyed by vertex id.
    expect(useGraphStore.getState().validationErrors.w).toBeDefined();
  });

  it("calls computeTensor when the graph is valid", () => {
    computeTensorMock.mockResolvedValue({
      shape: [],
      data: [[1, 0]],
      warnings: [],
      inputCount: 0,
      outputCount: 0,
    });
    useGraphStore.setState({
      nodes: [
        makeVertexWith("i", { data: { vertexType: "input" } }),
        makeVertexWith("w", { data: { vertexType: "w" } }),
        makeVertexWith("o0", { data: { vertexType: "output" } }),
        makeVertexWith("o1", { data: { vertexType: "output" } }),
      ],
      edges: [
        makeEdge("e1", "i", "w"),
        makeEdge("e2", "w", "o0"),
        makeEdge("e3", "w", "o1"),
      ],
    });

    const { result } = renderHook(() => useCompute());
    act(() => result.current.requestCompute());

    expect(computeTensorMock).toHaveBeenCalledTimes(1);
    expect(result.current.computeOpen).toBe(true);
    // A valid compute clears any prior errors.
    expect(useGraphStore.getState().validationErrors).toEqual({});
  });

  it("a subsequent valid compute clears errors from a prior invalid one", () => {
    computeTensorMock.mockResolvedValue({
      shape: [],
      data: [[1, 0]],
      warnings: [],
      inputCount: 0,
      outputCount: 0,
    });

    // First: invalid graph → errors published, worker not called.
    useGraphStore.setState({
      nodes: [makeVertexWith("w", { data: { vertexType: "w" } })],
    });
    const { result } = renderHook(() => useCompute());
    act(() => result.current.requestCompute());
    expect(computeTensorMock).not.toHaveBeenCalled();
    expect(useGraphStore.getState().validationErrors.w).toBeDefined();

    // Now fix the graph (give the W proper input + 2 outputs) and recompute.
    useGraphStore.setState({
      nodes: [
        makeVertexWith("i", { data: { vertexType: "input" } }),
        makeVertexWith("w", { data: { vertexType: "w" } }),
        makeVertexWith("o0", { data: { vertexType: "output" } }),
        makeVertexWith("o1", { data: { vertexType: "output" } }),
      ],
      edges: [
        makeEdge("e1", "i", "w"),
        makeEdge("e2", "w", "o0"),
        makeEdge("e3", "w", "o1"),
      ],
    });
    act(() => result.current.requestCompute());

    // The prior error is gone; the map is fully cleared.
    expect(useGraphStore.getState().validationErrors).toEqual({});
    expect(computeTensorMock).toHaveBeenCalledTimes(1);
  });

  it("clears progress when surfacing a validation error", () => {
    useGraphStore.setState({
      nodes: [makeVertexWith("h", { data: { vertexType: "h" } })],
    });

    const { result } = renderHook(() => useCompute());
    act(() => result.current.requestCompute());

    expect(result.current.progress).toBeNull();
  });

  it("second requestCompute aborts the first in-flight run", async () => {
    useGraphStore.setState({
      nodes: [
        makeVertexWith("i", { data: { vertexType: "input" } }),
        makeVertexWith("w", { data: { vertexType: "w" } }),
        makeVertexWith("o0", { data: { vertexType: "output" } }),
        makeVertexWith("o1", { data: { vertexType: "output" } }),
      ],
      edges: [
        makeEdge("e1", "i", "w"),
        makeEdge("e2", "w", "o0"),
        makeEdge("e3", "w", "o1"),
      ],
    });

    let capturedSignal: AbortSignal | null = null;
    computeTensorMock.mockImplementation((_graph, callbacks) => {
      capturedSignal = callbacks?.signal ?? null;
      return new Promise((_resolve, reject) => {
        callbacks?.signal?.addEventListener("abort", () =>
          reject(new DOMException("Computation cancelled", "AbortError")),
        );
      });
    });

    const { result } = renderHook(() => useCompute());
    act(() => result.current.requestCompute());
    const firstPromise = result.current.computePromise;
    const firstSignal = capturedSignal!;
    // The aborted promise is owned by the (mocked) dialog in real usage;
    // swallow the rejection here so it never becomes unhandled in the test.
    firstPromise?.catch(() => {});

    act(() => result.current.requestCompute());
    const secondPromise = result.current.computePromise;

    // The second request aborted the first run's controller.
    expect(firstSignal.aborted).toBe(true);
    await expect(firstPromise).rejects.toMatchObject({ name: "AbortError" });
    expect(secondPromise).not.toBe(firstPromise);
  });

  it("stale progress from a replaced run does not overwrite the current one", () => {
    useGraphStore.setState({
      nodes: [
        makeVertexWith("i", { data: { vertexType: "input" } }),
        makeVertexWith("w", { data: { vertexType: "w" } }),
        makeVertexWith("o0", { data: { vertexType: "output" } }),
        makeVertexWith("o1", { data: { vertexType: "output" } }),
      ],
      edges: [
        makeEdge("e1", "i", "w"),
        makeEdge("e2", "w", "o0"),
        makeEdge("e3", "w", "o1"),
      ],
    });

    const progressCallbacks: Array<(c: number, t: number) => void> = [];
    computeTensorMock.mockImplementation((_graph, callbacks) => {
      progressCallbacks.push(callbacks?.onProgress ?? (() => {}));
      return new Promise(() => {});
    });

    const { result } = renderHook(() => useCompute());
    act(() => result.current.requestCompute());
    const firstOnProgress = progressCallbacks[0];

    // A second request replaces the controller; the first run's progress
    // must then be dropped.
    act(() => result.current.requestCompute());
    act(() => firstOnProgress(7, 42));

    expect(result.current.progress).not.toEqual({ contracted: 7, total: 42 });
  });

  it("does not create an unhandled promise rejection on a validation error", async () => {
    // The rejection must be caught eagerly so it never becomes an
    // unhandled rejection (the dialog's `.catch` only attaches on the
    // next render, which can race with the microtask queue).
    useGraphStore.setState({
      nodes: [makeVertexWith("w", { data: { vertexType: "w" } })],
    });

    const unhandled: unknown[] = [];
    const handler = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", handler);

    try {
      const { result } = renderHook(() => useCompute());
      await act(async () => {
        result.current.requestCompute();
        // Flush microtasks so the rejection settles.
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(unhandled).toHaveLength(0);
    } finally {
      process.off("unhandledRejection", handler);
    }
  });

  // Regression: errors seeded into the store via setState (e.g. left over by
  // a previous mount) must be cleared on a valid compute. The validation
  // gate publishes [] BEFORE calling the worker, so no stale error can linger
  // even when the prior errors didn't come from a requestCompute call.
  it("a valid compute clears errors that were seeded directly in the store", () => {
    computeTensorMock.mockResolvedValue({
      shape: [],
      data: [[1, 0]],
      warnings: [],
      inputCount: 0,
      outputCount: 0,
    });
    useGraphStore.setState({
      nodes: [
        makeVertexWith("i", { data: { vertexType: "input" } }),
        makeVertexWith("w", { data: { vertexType: "w" } }),
        makeVertexWith("o0", { data: { vertexType: "output" } }),
        makeVertexWith("o1", { data: { vertexType: "output" } }),
      ],
      edges: [
        makeEdge("e1", "i", "w"),
        makeEdge("e2", "w", "o0"),
        makeEdge("e3", "w", "o1"),
      ],
      // Errors planted as if from an earlier, different compute.
      validationErrors: {
        w: [{ kind: "w-input-count", message: "stale", vertexId: "w" }],
      },
    });

    const { result } = renderHook(() => useCompute());
    act(() => result.current.requestCompute());

    expect(computeTensorMock).toHaveBeenCalledTimes(1);
    // Stale errors wiped before the worker was even called.
    expect(useGraphStore.getState().validationErrors).toEqual({});
  });

  // The validation gate clears errors BEFORE invoking the worker. So if
  // validation passes but the worker later rejects, the store stays empty —
  // no stale error lingers to mislead the user into thinking the structure
  // was the problem.
  it("a worker rejection (after valid validation) leaves the error map empty", async () => {
    computeTensorMock.mockRejectedValue(
      new ComputeError("unknown", "wasm exploded"),
    );
    useGraphStore.setState({
      nodes: [
        makeVertexWith("i", { data: { vertexType: "input" } }),
        makeVertexWith("w", { data: { vertexType: "w" } }),
        makeVertexWith("o0", { data: { vertexType: "output" } }),
        makeVertexWith("o1", { data: { vertexType: "output" } }),
      ],
      edges: [
        makeEdge("e1", "i", "w"),
        makeEdge("e2", "w", "o0"),
        makeEdge("e3", "w", "o1"),
      ],
    });

    const { result } = renderHook(() => useCompute());
    act(() => result.current.requestCompute());

    // Worker was called (validation passed), and the store is empty even
    // though the compute is about to fail.
    expect(computeTensorMock).toHaveBeenCalledTimes(1);
    expect(useGraphStore.getState().validationErrors).toEqual({});

    // Settle the rejection so it doesn't surface as an unhandled rejection
    // during this test (the dialog's `.catch` would do this in the app).
    await act(async () => {
      try {
        await result.current.computePromise;
      } catch {
        /* swallowed for test hygiene */
      }
    });
  });

  // The worker promise (line 91) is NOT pre-caught, unlike the validation
  // path which attaches `rejected.catch(() => {})` eagerly. This test pins
  // that the worker path doesn't surface as an unhandled rejection in the
  // app's normal lifecycle. NOTE: Node only fires `unhandledRejection` once
  // a rejected promise is GC'd with no handler. Here (and in the app) React
  // state holds `computePromise`, keeping it alive — so the rejection is
  // effectively absorbed by the held reference until the dialog's effect
  // attaches its `.catch`. This passes for that reason, not because the
  // promise is eagerly caught. The asymmetry vs the validation path is a
  // defense-in-depth smell worth noting, but not a live bug under this
  // holding-reference invariant.
  it("does not create an unhandled rejection when the worker rejects", async () => {
    computeTensorMock.mockRejectedValue(
      new ComputeError("unknown", "wasm exploded"),
    );
    useGraphStore.setState({
      nodes: [
        makeVertexWith("i", { data: { vertexType: "input" } }),
        makeVertexWith("w", { data: { vertexType: "w" } }),
        makeVertexWith("o0", { data: { vertexType: "output" } }),
        makeVertexWith("o1", { data: { vertexType: "output" } }),
      ],
      edges: [
        makeEdge("e1", "i", "w"),
        makeEdge("e2", "w", "o0"),
        makeEdge("e3", "w", "o1"),
      ],
    });

    const unhandled: unknown[] = [];
    const handler = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", handler);

    let result: ReturnType<typeof renderHook<ReturnType<typeof useCompute>>["result"]> | null = null;
    try {
      const rendered = renderHook(() => useCompute());
      result = rendered.result;
      await act(async () => {
        rendered.result.current.requestCompute();
        // Flush microtasks so any rejection settles before assertions.
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(unhandled).toHaveLength(0);
    } finally {
      // Drain the promise so later tests don't see the rejection.
      try {
        if (result) await result.current.computePromise;
      } catch {
        /* drained */
      }
      process.off("unhandledRejection", handler);
    }
  });
});
