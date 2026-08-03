import { describe, expect, it, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { useGraphStore } from "@/store/graph-store";
import { makeVertexWith } from "@/test-utils/factories";
import { VertexPropertyPanel } from "./VertexPropertyPanel";

// The panel reads `nodes` (filtering for the one selected vertex) and
// `validationErrors`. We drive both directly via the store.
function seedSelectedVertex(id: string, vertexType: string) {
  useGraphStore.setState({
    nodes: [makeVertexWith(id, { selected: true, data: { vertexType: vertexType as never } })],
  });
}

describe("VertexPropertyPanel — error block", () => {
  beforeEach(() => {
    useGraphStore.getState().reset();
    useGraphStore.setState({ validationErrors: {} });
  });

  it("shows error messages for the selected vertex", () => {
    seedSelectedVertex("w1", "w");
    useGraphStore.getState().setValidationErrors([
      { kind: "w-input-count", message: "must have exactly 1 input leg, got 0", vertexId: "w1" },
    ]);

    render(<VertexPropertyPanel />);
    expect(screen.getByText(/must have exactly 1 input leg/i)).toBeInTheDocument();
  });

  it("does NOT show errors belonging to a different vertex", () => {
    seedSelectedVertex("w1", "w");
    useGraphStore.getState().setValidationErrors([
      { kind: "h-box-arity", message: "other vertex error", vertexId: "h1" },
    ]);

    render(<VertexPropertyPanel />);
    expect(screen.queryByText(/other vertex error/i)).not.toBeInTheDocument();
  });

  it("hides the error block when the selected vertex has no errors", () => {
    seedSelectedVertex("w1", "w");
    useGraphStore.setState({ validationErrors: {} });

    render(<VertexPropertyPanel />);
    // The panel still renders (Type selector etc.) but no error text.
    expect(screen.queryByText(/must have/i)).not.toBeInTheDocument();
  });

  it("hides the whole panel when no vertex is selected", () => {
    useGraphStore.setState({
      nodes: [makeVertexWith("w1", { selected: false, data: { vertexType: "w" } })],
      validationErrors: {
        w1: [{ kind: "w-input-count", message: "error for unselected", vertexId: "w1" }],
      },
    });

    const { container } = render(<VertexPropertyPanel />);
    expect(container.firstChild).toBeNull();
  });

  it("clears the error block when errors are cleared after recompute", () => {
    seedSelectedVertex("w1", "w");
    useGraphStore.getState().setValidationErrors([
      { kind: "w-input-count", message: "lingering error", vertexId: "w1" },
    ]);

    const { rerender } = render(<VertexPropertyPanel />);
    expect(screen.getByText(/lingering error/i)).toBeInTheDocument();

    // Simulate a recompute that found no errors.
    act(() => {
      useGraphStore.getState().setValidationErrors([]);
    });
    rerender(<VertexPropertyPanel />);
    expect(screen.queryByText(/lingering error/i)).not.toBeInTheDocument();
  });

  it("shows multiple errors for one vertex", () => {
    seedSelectedVertex("w1", "w");
    useGraphStore.getState().setValidationErrors([
      { kind: "w-input-count", message: "input problem", vertexId: "w1" },
      { kind: "w-output-count", message: "output problem", vertexId: "w1" },
    ]);

    render(<VertexPropertyPanel />);
    expect(screen.getByText(/input problem/i)).toBeInTheDocument();
    expect(screen.getByText(/output problem/i)).toBeInTheDocument();
  });
});
