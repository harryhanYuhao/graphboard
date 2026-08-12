// EdgeKindMenu contract (mirrors VertexTypeMenu): hidden outside add-edge
// mode, lists every edge kind with its label, highlights the staged kind,
// and clicking stages it on the store.

import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useGraphStore } from "@/store/graph-store";
import { EdgeKindMenu } from "./EdgeKindMenu";

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

describe("EdgeKindMenu", () => {
  it("renders null outside add-edge mode", () => {
    const { container } = render(<EdgeKindMenu />);
    expect(container.firstChild).toBeNull();
  });

  it("lists every edge kind with Default active in add-edge mode", () => {
    useGraphStore.setState({ mode: "add-edge" });
    render(<EdgeKindMenu />);
    expect(screen.getByText("Edge kind")).toBeTruthy();
    const defaultBtn = screen.getByRole("button", { name: "Default" });
    const dashedBtn = screen.getByRole("button", { name: "Dashed blue" });
    const dashedLightBtn = screen.getByRole("button", { name: "Dashed light" });
    expect(defaultBtn).toBeTruthy();
    expect(dashedBtn).toBeTruthy();
    expect(dashedLightBtn).toBeTruthy();
    expect(defaultBtn.getAttribute("aria-pressed")).toBe("true");
  });

  it("stages the clicked kind as the selected edge kind", () => {
    useGraphStore.setState({ mode: "add-edge" });
    render(<EdgeKindMenu />);
    fireEvent.click(screen.getByRole("button", { name: "Dashed blue" }));
    expect(useGraphStore.getState().selectedEdgeKind).toBe("dashed_blue");
    expect(
      screen
        .getByRole("button", { name: "Dashed blue" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("stages the dashed-light kind on click", () => {
    useGraphStore.setState({ mode: "add-edge" });
    render(<EdgeKindMenu />);
    fireEvent.click(screen.getByRole("button", { name: "Dashed light" }));
    expect(useGraphStore.getState().selectedEdgeKind).toBe("dashed_light");
    expect(
      screen
        .getByRole("button", { name: "Dashed light" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });
});
