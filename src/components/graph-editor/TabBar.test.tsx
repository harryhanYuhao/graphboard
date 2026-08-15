// TabBar behavioral contract: renders one chip per tab with the active
// highlight, switches on click, opens the inline rename on double-click
// (commit on Enter, cancel on Escape), closes on ×, and adds via "+".

import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { makeEmptyTabRecord, useGraphStore } from "@/store/graph-store";
import { TabBar } from "./TabBar";

function seedTabs() {
  const first = makeEmptyTabRecord("Tab 1", null);
  const second = makeEmptyTabRecord("Tab 2", null);
  useGraphStore.setState({
    title: "Tab 1",
    createdAt: first.createdAt,
    nodes: [],
    edges: [],
    tabs: [first, second],
    activeTabId: first.id,
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
  return { firstId: first.id, secondId: second.id };
}

beforeEach(seedTabs);

describe("TabBar", () => {
  it("renders a chip per tab with the active tab marked", () => {
    render(<TabBar />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(2);
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    expect(tabs[1].getAttribute("aria-selected")).toBe("false");
    expect(screen.getByText("Tab 1")).toBeTruthy();
    expect(screen.getByText("Tab 2")).toBeTruthy();
  });

  it("clicking an inactive chip switches the active tab", () => {
    const { secondId } = seedTabs();
    render(<TabBar />);
    fireEvent.click(screen.getByText("Tab 2"));
    expect(useGraphStore.getState().activeTabId).toBe(secondId);
  });

  it("double-clicking a chip opens the rename input; Enter commits", () => {
    render(<TabBar />);
    fireEvent.doubleClick(screen.getByText("Tab 1"));

    const input = screen.getByLabelText("Tab name");
    fireEvent.change(input, { target: { value: "Phase space" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(useGraphStore.getState().tabs[0].name).toBe("Phase space");
    expect(screen.getByText("Phase space")).toBeTruthy();
  });

  it("Escape cancels the rename without changing the name", () => {
    render(<TabBar />);
    fireEvent.doubleClick(screen.getByText("Tab 1"));

    const input = screen.getByLabelText("Tab name");
    fireEvent.change(input, { target: { value: "Nope" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(useGraphStore.getState().tabs[0].name).toBe("Tab 1");
  });

  it("clicking × closes an empty tab without confirmation", () => {
    render(<TabBar />);
    fireEvent.click(screen.getByRole("button", { name: "Close tab Tab 2" }));
    expect(useGraphStore.getState().tabs.map((t) => t.name)).toEqual([
      "Tab 1",
    ]);
    expect(useGraphStore.getState().confirmDialogue).toBeNull();
  });

  it("clicking + adds and activates a new tab", () => {
    render(<TabBar />);
    fireEvent.click(screen.getByRole("button", { name: "New tab" }));
    const state = useGraphStore.getState();
    expect(state.tabs).toHaveLength(3);
    expect(state.activeTabId).toBe(state.tabs[2].id);
  });
});
