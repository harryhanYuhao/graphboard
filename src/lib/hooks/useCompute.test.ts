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

  it("clears progress when surfacing a validation error", () => {
    useGraphStore.setState({
      nodes: [makeVertexWith("h", { data: { vertexType: "h" } })],
    });

    const { result } = renderHook(() => useCompute());
    act(() => result.current.requestCompute());

    expect(result.current.progress).toBeNull();
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
});
