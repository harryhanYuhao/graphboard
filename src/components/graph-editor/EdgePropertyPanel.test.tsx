// EdgePropertyPanel contract: shows exactly when one edge is selected, the
// kind selector switches the edge kind through the store, and it hides on
// zero / multi-edge selection. Mirrors VertexPropertyPanel's test surface.

import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useGraphStore } from "@/store/graph-store";
import { EdgePropertyPanel } from "./EdgePropertyPanel";
import { makeEdgeWith, makeVertexWith } from "@/test-utils/factories";

function resetStore() {
  useGraphStore.setState({
    title: "Untitled Graph",
    createdAt: "2025-01-01T00:00:00.000Z",
    nodes: [],
    edges: [],
    mode: "select",
    hasHydrated: false,
    pendingEdgeSources: [],
    selectedVertexType: "z",
    confirmDialogue: null,
    isHelpOpen: false,
    clipboard: null,
    validationErrors: {},
  });
  useGraphStore.temporal.getState().clear();
}

beforeEach(resetStore);

describe("EdgePropertyPanel", () => {
  it("renders null when no edge is selected", () => {
    useGraphStore.setState({
      nodes: [makeVertexWith("a"), makeVertexWith("b")],
      edges: [makeEdgeWith("e1", "a", "b")],
    });
    const { container } = render(<EdgePropertyPanel />);
    expect(container.firstChild).toBeNull();
  });

  it("renders null when more than one edge is selected", () => {
    useGraphStore.setState({
      nodes: [makeVertexWith("a"), makeVertexWith("b")],
      edges: [
        makeEdgeWith("e1", "a", "b", { selected: true }),
        makeEdgeWith("e2", "a", "b", { selected: true }),
      ],
    });
    const { container } = render(<EdgePropertyPanel />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the kind selector with Default active for a selected default edge", () => {
    useGraphStore.setState({
      nodes: [makeVertexWith("a"), makeVertexWith("b")],
      edges: [makeEdgeWith("e1", "a", "b", { selected: true })],
    });
    render(<EdgePropertyPanel />);
    expect(screen.getByText("Edge")).toBeTruthy();
    const defaultBtn = screen.getByRole("button", { name: "Default" });
    const dashedBtn = screen.getByRole("button", { name: "Dashed blue" });
    const dashedLightBtn = screen.getByRole("button", { name: "Dashed light" });
    expect(defaultBtn).toBeTruthy();
    expect(dashedBtn).toBeTruthy();
    expect(dashedLightBtn).toBeTruthy();
    expect(defaultBtn.getAttribute("aria-pressed")).toBe("true");
    expect(dashedBtn.getAttribute("aria-pressed")).toBe("false");
    expect(dashedLightBtn.getAttribute("aria-pressed")).toBe("false");
  });

  it("switches the edge kind through the store on click", () => {
    useGraphStore.setState({
      nodes: [makeVertexWith("a"), makeVertexWith("b")],
      edges: [makeEdgeWith("e1", "a", "b", { selected: true })],
    });
    render(<EdgePropertyPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Dashed blue" }));
    expect(useGraphStore.getState().edges[0]?.data?.kind).toBe("dashed_blue");
    expect(
      screen.getByRole("button", { name: "Dashed blue" }).getAttribute(
        "aria-pressed",
      ),
    ).toBe("true");
    expect(
      screen.getByRole("button", { name: "Default" }).getAttribute(
        "aria-pressed",
      ),
    ).toBe("false");
  });

  it("switches to the dashed-light kind through the store on click", () => {
    useGraphStore.setState({
      nodes: [makeVertexWith("a"), makeVertexWith("b")],
      edges: [makeEdgeWith("e1", "a", "b", { selected: true })],
    });
    render(<EdgePropertyPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Dashed light" }));
    expect(useGraphStore.getState().edges[0]?.data?.kind).toBe("dashed_light");
    expect(
      screen.getByRole("button", { name: "Dashed light" }).getAttribute(
        "aria-pressed",
      ),
    ).toBe("true");
    expect(
      screen.getByRole("button", { name: "Default" }).getAttribute(
        "aria-pressed",
      ),
    ).toBe("false");
  });

  it("shows the endpoints as read-only context", () => {
    useGraphStore.setState({
      nodes: [makeVertexWith("a"), makeVertexWith("b")],
      edges: [makeEdgeWith("e1", "a", "b", { selected: true })],
    });
    render(<EdgePropertyPanel />);
    expect(screen.getByText("a → b")).toBeTruthy();
  });

  it("drops below the vertex panel when a vertex is also selected", () => {
    useGraphStore.setState({
      nodes: [makeVertexWith("a", { selected: true }), makeVertexWith("b")],
      edges: [makeEdgeWith("e1", "a", "b", { selected: true })],
    });
    const { container } = render(<EdgePropertyPanel />);
    expect(container.firstChild).not.toBeNull();
    expect(
      container.querySelector(".top-\\[36rem\\]"),
    ).toBeTruthy();
  });
});
