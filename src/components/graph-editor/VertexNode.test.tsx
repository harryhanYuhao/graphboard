import { describe, expect, it, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { ReactFlowProvider, type NodeProps } from "@xyflow/react";
import { useGraphStore } from "@/store/graph-store";
import type { VertexNode as VertexNodeType } from "@/lib/graph/types";
import { VertexNode } from "./VertexNode";

function renderWithFlow(ui: React.ReactElement) {
  return render(<ReactFlowProvider>{ui}</ReactFlowProvider>);
}

// Minimal NodeProps — VertexNode only reads id/data/selected.
function props(
  id: string,
  vertexType: string,
  selected = false,
): NodeProps<VertexNodeType> {
  return {
    id,
    data: { label: "", vertexType: vertexType as never },
    selected,
  } as NodeProps<VertexNodeType>;
}

describe("VertexNode — error rendering", () => {
  beforeEach(() => {
    useGraphStore.getState().reset();
    useGraphStore.setState({ validationErrors: {} });
  });

  it("renders on-canvas error text when the vertex has errors", () => {
    useGraphStore.setState({
      nodes: [],
      validationErrors: {
        w1: [
          { kind: "w-input-count", message: "needs 1 input", vertexId: "w1" },
        ],
      },
    });

    renderWithFlow(<VertexNode {...props("w1", "w")} />);
    expect(screen.getByText("needs 1 input")).toBeInTheDocument();
  });

  it("renders multiple error messages", () => {
    useGraphStore.setState({
      nodes: [],
      validationErrors: {
        w1: [
          { kind: "w-input-count", message: "input bad", vertexId: "w1" },
          { kind: "w-output-count", message: "output bad", vertexId: "w1" },
        ],
      },
    });

    renderWithFlow(<VertexNode {...props("w1", "w")} />);
    expect(screen.getByText("input bad")).toBeInTheDocument();
    expect(screen.getByText("output bad")).toBeInTheDocument();
  });

  it("renders no error text when the vertex has no errors", () => {
    useGraphStore.setState({
      nodes: [],
      validationErrors: {
        other: [{ kind: "w-input-count", message: "other's error", vertexId: "other" }],
      },
    });

    renderWithFlow(<VertexNode {...props("w1", "w")} />);
    expect(screen.queryByText("other's error")).not.toBeInTheDocument();
  });

  it("clears error text when errors are removed after recompute", () => {
    useGraphStore.setState({
      nodes: [],
      validationErrors: {
        w1: [{ kind: "w-input-count", message: "transient", vertexId: "w1" }],
      },
    });

    const { rerender } = renderWithFlow(<VertexNode {...props("w1", "w")} />);
    expect(screen.getByText("transient")).toBeInTheDocument();

    act(() => {
      useGraphStore.getState().setValidationErrors([]);
    });
    rerender(<ReactFlowProvider><VertexNode {...props("w1", "w")} /></ReactFlowProvider>);
    expect(screen.queryByText("transient")).not.toBeInTheDocument();
  });
});
