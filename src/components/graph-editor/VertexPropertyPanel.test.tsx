import { describe, expect, it, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
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

describe("VertexPropertyPanel — phase / visual label / location commit wiring", () => {
  beforeEach(() => {
    useGraphStore.getState().reset();
    useGraphStore.setState({ validationErrors: {} });
  });

  it("commits the phase input to data.phase on blur", () => {
    useGraphStore.setState({
      nodes: [
        makeVertexWith("a", {
          selected: true,
          data: { phase: "old", vertexType: "z" },
        }),
      ],
    });
    render(<VertexPropertyPanel />);
    const phaseInput = screen.getByPlaceholderText("Phase expression");
    fireEvent.change(phaseInput, { target: { value: "\\pi/2" } });
    fireEvent.blur(phaseInput);
    expect(useGraphStore.getState().nodes[0].data.phase).toBe("\\pi/2");
  });

  it("commits the visual label input to the view slice on blur", () => {
    useGraphStore.setState({
      nodes: [
        makeVertexWith("a", {
          selected: true,
          label: "old",
          data: { vertexType: "z" },
        }),
      ],
    });
    render(<VertexPropertyPanel />);
    const labelInput = screen.getByPlaceholderText("Label ($...$ for math)");
    fireEvent.change(labelInput, { target: { value: "$\\alpha$" } });
    fireEvent.blur(labelInput);
    expect(useGraphStore.getState().nodes[0].label).toBe("$\\alpha$");
    // View-only: the graph slice is untouched.
    expect(useGraphStore.getState().nodes[0].data.phase).toBe("");
  });

  it("commits the label location select to the view slice", () => {
    useGraphStore.setState({
      nodes: [makeVertexWith("a", { selected: true, data: { vertexType: "z" } })],
    });
    render(<VertexPropertyPanel />);
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "right" },
    });
    expect(useGraphStore.getState().nodes[0].labelLocation).toBe("right");
  });
});
