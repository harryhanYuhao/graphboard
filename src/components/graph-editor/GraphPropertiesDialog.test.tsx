// Pins the graph-properties dialog: reads stats from the store, and the
// vertex-count row expands into a per-vertex-type breakdown (and back).

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useGraphStore } from "@/store/graph-store";
import { makeEdge, makeVertex, makeVertexWith } from "@/test-utils/factories";
import { GraphPropertiesDialog } from "./GraphPropertiesDialog";

// 3 vertices (2 z, 1 x) connected as a path: degrees 1 / 2 / 1.
function seedGraph() {
  useGraphStore.setState({
    nodes: [
      makeVertex("a"),
      makeVertexWith("b", { data: { vertexType: "x" } }),
      makeVertex("c"),
    ],
    edges: [makeEdge("e1", "a", "b"), makeEdge("e2", "b", "c")],
  });
}

function rowValue(label: string): HTMLElement {
  const labelEl = screen.getByText(label);
  return within(labelEl.closest("div") as HTMLElement).getByText(/\d+/);
}

describe("GraphPropertiesDialog", () => {
  beforeEach(() => {
    useGraphStore.getState().reset();
  });

  it("shows vertex/edge counts and min/max degree", () => {
    seedGraph();
    render(<GraphPropertiesDialog isOpen onClose={vi.fn()} />);

    // Vertices row is a button whose accessible name includes the count.
    expect(screen.getByRole("button", { name: /Vertices/ })).toHaveTextContent(
      "3",
    );
    expect(rowValue("Edges")).toHaveTextContent("2");
    expect(rowValue("Min degree")).toHaveTextContent("1");
    expect(rowValue("Max degree")).toHaveTextContent("2");
  });

  it("shows zeros for an empty graph", () => {
    render(<GraphPropertiesDialog isOpen onClose={vi.fn()} />);

    expect(screen.getByRole("button", { name: /Vertices/ })).toHaveTextContent(
      "0",
    );
    expect(rowValue("Edges")).toHaveTextContent("0");
    expect(rowValue("Min degree")).toHaveTextContent("0");
    expect(rowValue("Max degree")).toHaveTextContent("0");
  });

  it("expands the vertex count into per-type counts, and collapses on re-click", () => {
    seedGraph();
    render(<GraphPropertiesDialog isOpen onClose={vi.fn()} />);

    const verticesButton = screen.getByRole("button", { name: /Vertices/ });
    fireEvent.click(verticesButton);

    const list = screen.getByRole("list");
    const zRow = within(list).getByText("Z spider").closest("li") as HTMLElement;
    const xRow = within(list).getByText("X spider").closest("li") as HTMLElement;
    expect(within(zRow).getByText("2")).toBeInTheDocument();
    expect(within(xRow).getByText("1")).toBeInTheDocument();
    // Absent types are listed with a zero count.
    const wRow = within(list).getByText("W node").closest("li") as HTMLElement;
    expect(within(wRow).getByText("0")).toBeInTheDocument();

    fireEvent.click(verticesButton);
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("closes on Escape", () => {
    seedGraph();
    const onClose = vi.fn();
    render(<GraphPropertiesDialog isOpen onClose={onClose} />);

    // Focus lands on the close button (on open); keydown bubbles to the
    // dialog card where the Escape handler lives.
    fireEvent.keyDown(document.activeElement as HTMLElement, {
      key: "Escape",
    });
    expect(onClose).toHaveBeenCalled();
  });
});
