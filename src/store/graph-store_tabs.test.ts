// Tab-system tests for the Zustand graph store: per-tab graphs + undo trees,
// the stash/swap handoff on switch, save/hydrate of the tabs wrapper, and the
// shared clipboard. Conventions mirror graph-store.test.ts: hit the store
// directly, reset a baseline in beforeEach, clear the temporal stack.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeEmptyTabRecord, useGraphStore } from "./graph-store";
import { makeVertexWith as makeVertex, makeEdge } from "@/test-utils/factories";

vi.mock("@/lib/download", () => ({
  openTextFileWithPicker: vi.fn(),
  saveTextFileWithPicker: vi.fn(),
}));

import { saveTextFileWithPicker } from "@/lib/download";

function resetStore() {
  const tab = makeEmptyTabRecord("Tab 1", null);
  useGraphStore.setState({
    title: "Tab 1",
    createdAt: tab.createdAt,
    nodes: [],
    edges: [],
    tabs: [tab],
    activeTabId: tab.id,
    mode: "select",
    hasHydrated: false,
    pendingEdgeSources: [],
    selectedVertexType: "z",
    selectedEdgeKind: "default",
    confirmDialogue: null,
    isHelpOpen: false,
    isExportOpen: false,
    isPropertiesOpen: false,
    clipboard: null,
    validationErrors: {},
  });
  useGraphStore.temporal.getState().clear();
  vi.mocked(saveTextFileWithPicker).mockReset();
}

beforeEach(resetStore);

// Seed a second tab with content, keeping tab 1 active. Returns the ids.
function seedTwoTabs() {
  const state = useGraphStore.getState();
  const firstId = state.activeTabId;
  const second = makeEmptyTabRecord("Tab 2", null);
  useGraphStore.setState({
    tabs: [
      state.tabs[0],
      { ...second, nodes: [makeVertex("b1")], edges: [] },
    ],
  });
  return { firstId, secondId: second.id };
}

describe("addTab", () => {
  it("appends a fresh empty tab and activates it", () => {
    const firstId = useGraphStore.getState().activeTabId;
    useGraphStore.getState().addTab();

    const state = useGraphStore.getState();
    expect(state.tabs).toHaveLength(2);
    const added = state.tabs[1];
    expect(added.name).toBe("Tab 2");
    expect(added.nodes).toEqual([]);
    expect(added.edges).toEqual([]);
    expect(state.activeTabId).toBe(added.id);
    // Root slices mirror the new active tab.
    expect(state.nodes).toEqual([]);
    expect(state.title).toBe("Tab 2");
    // The outgoing tab's record holds the pre-switch graph.
    expect(state.tabs[0].id).toBe(firstId);
  });

  it("defaults new tab names to the next 'Tab N' slot", () => {
    useGraphStore.getState().addTab();
    useGraphStore.getState().addTab();
    expect(useGraphStore.getState().tabs.map((t) => t.name)).toEqual([
      "Tab 1",
      "Tab 2",
      "Tab 3",
    ]);
  });

  it("picks a name that skips non-'Tab N' names but reuses freed numbers", () => {
    useGraphStore.getState().renameTab(
      useGraphStore.getState().activeTabId,
      "Research notes",
    );
    useGraphStore.getState().addTab();
    expect(useGraphStore.getState().tabs[1].name).toBe("Tab 1");
  });

  it("does not create an undo entry in the new tab", () => {
    useGraphStore.getState().addVertexAt({ x: 0, y: 0 });
    useGraphStore.getState().addTab();
    expect(useGraphStore.temporal.getState().pastStates).toHaveLength(0);
  });
});

describe("switchTab", () => {
  it("swaps the root slices to the target tab and mirrors its name", () => {
    const { secondId } = seedTwoTabs();
    useGraphStore.getState().switchTab(secondId);

    const state = useGraphStore.getState();
    expect(state.activeTabId).toBe(secondId);
    expect(state.nodes.map((n) => n.id)).toEqual(["b1"]);
    expect(state.title).toBe("Tab 2");
    expect(state.createdAt).toBe(
      state.tabs.find((t) => t.id === secondId)?.createdAt,
    );
  });

  it("resets transient work-in-progress (mode, pending sources, validation errors)", () => {
    const { secondId } = seedTwoTabs();
    useGraphStore.setState({
      mode: "add-edge",
      pendingEdgeSources: ["a"],
    });
    useGraphStore.getState().setValidationErrors([
      { kind: "w-input-count", message: "x", vertexId: "w1" },
    ]);

    useGraphStore.getState().switchTab(secondId);

    const state = useGraphStore.getState();
    expect(state.mode).toBe("select");
    expect(state.pendingEdgeSources).toEqual([]);
    expect(state.validationErrors).toEqual({});
  });

  it("is a no-op for the already-active tab and for unknown ids", () => {
    const { firstId } = seedTwoTabs();
    const before = useGraphStore.getState();
    useGraphStore.getState().switchTab(firstId);
    useGraphStore.getState().switchTab("does-not-exist");
    expect(useGraphStore.getState().activeTabId).toBe(before.activeTabId);
    expect(useGraphStore.getState().nodes).toBe(before.nodes);
  });

  it("does not push the switch itself onto the undo stack", () => {
    const { secondId } = seedTwoTabs();
    useGraphStore.getState().addVertexAt({ x: 0, y: 0 });
    expect(useGraphStore.temporal.getState().pastStates).toHaveLength(1);

    useGraphStore.getState().switchTab(secondId);
    // The incoming tab starts with an empty tree; the switch added nothing.
    expect(useGraphStore.temporal.getState().pastStates).toHaveLength(0);
    // Undo in the new tab stays a no-op.
    useGraphStore.temporal.getState().undo();
    expect(useGraphStore.getState().nodes.map((n) => n.id)).toEqual(["b1"]);
  });

  it("stashes the outgoing tab's undo tree and restores it on return", () => {
    const { secondId } = seedTwoTabs();
    useGraphStore.getState().addVertexAt({ x: 0, y: 0 });
    useGraphStore.getState().addVertexAt({ x: 24, y: 0 });
    expect(useGraphStore.getState().nodes).toHaveLength(2);

    // Move to tab 2 and make its own history.
    useGraphStore.getState().switchTab(secondId);
    useGraphStore.getState().addVertexAt({ x: 0, y: 24 });
    expect(useGraphStore.getState().nodes).toHaveLength(2);
    expect(useGraphStore.temporal.getState().pastStates).toHaveLength(1);

    // Back to tab 1: its two undo steps are intact.
    useGraphStore.getState().switchTab(
      useGraphStore.getState().tabs[0].id,
    );
    expect(useGraphStore.temporal.getState().pastStates).toHaveLength(2);
    useGraphStore.temporal.getState().undo();
    expect(useGraphStore.getState().nodes).toHaveLength(1);

    // Tab 2 is untouched by tab 1's undo.
    useGraphStore.getState().switchTab(secondId);
    expect(useGraphStore.getState().nodes).toHaveLength(2);
    expect(useGraphStore.temporal.getState().pastStates).toHaveLength(1);
  });

  it("keeps selection per tab (selected flags ride with the tab records)", () => {
    const { secondId } = seedTwoTabs();
    useGraphStore.setState({
      nodes: [makeVertex("a", { selected: true })],
    });
    useGraphStore.getState().switchTab(secondId);
    expect(useGraphStore.getState().nodes[0].selected).toBe(false);

    useGraphStore.getState().switchTab(
      useGraphStore.getState().tabs[0].id,
    );
    expect(useGraphStore.getState().nodes[0].selected).toBe(true);
  });
});

describe("switchAdjacentTab", () => {
  it("steps forward and backward between tabs", () => {
    const { firstId, secondId } = seedTwoTabs();
    useGraphStore.getState().switchAdjacentTab(1);
    expect(useGraphStore.getState().activeTabId).toBe(secondId);
    useGraphStore.getState().switchAdjacentTab(-1);
    expect(useGraphStore.getState().activeTabId).toBe(firstId);
  });

  it("is a no-op at the ends (no wrap-around)", () => {
    useGraphStore.getState().switchAdjacentTab(-1);
    expect(useGraphStore.getState().activeTabId).toBe(
      useGraphStore.getState().tabs[0].id,
    );
  });
});

describe("renameTab", () => {
  it("renames the tab and mirrors the root title when active", () => {
    const id = useGraphStore.getState().activeTabId;
    useGraphStore.getState().renameTab(id, "  My board  ");
    const state = useGraphStore.getState();
    expect(state.tabs[0].name).toBe("My board");
    expect(state.title).toBe("My board");
  });

  it("renames an inactive tab without touching the root title", () => {
    const { secondId } = seedTwoTabs();
    useGraphStore.getState().renameTab(secondId, "Other");
    const state = useGraphStore.getState();
    expect(state.tabs[1].name).toBe("Other");
    expect(state.title).toBe("Tab 1");
  });

  it("ignores empty/whitespace-only names", () => {
    const id = useGraphStore.getState().activeTabId;
    useGraphStore.getState().renameTab(id, "   ");
    expect(useGraphStore.getState().tabs[0].name).toBe("Tab 1");
  });

  it("does not push an undo entry (not a graph mutation)", () => {
    useGraphStore.getState().addVertexAt({ x: 0, y: 0 });
    const baseline = useGraphStore.temporal.getState().pastStates.length;
    useGraphStore
      .getState()
      .renameTab(useGraphStore.getState().activeTabId, "Renamed");
    expect(useGraphStore.temporal.getState().pastStates.length).toBe(baseline);
  });
});

describe("closeTab", () => {
  it("closes an empty non-active tab silently", () => {
    const { firstId, secondId } = seedTwoTabs();
    useGraphStore.setState({
      tabs: useGraphStore
        .getState()
        .tabs.map((t) => (t.id === secondId ? { ...t, nodes: [] } : t)),
    });
    useGraphStore.getState().closeTab(secondId);
    const state = useGraphStore.getState();
    expect(state.tabs.map((t) => t.id)).toEqual([firstId]);
    expect(state.confirmDialogue).toBeNull();
  });

  it("closing the active tab switches to the left neighbour", () => {
    const { secondId } = seedTwoTabs();
    useGraphStore.getState().switchTab(secondId);
    // Empty the active tab so the close is silent.
    useGraphStore.setState({ nodes: [] });
    useGraphStore.getState().closeTab(secondId);

    const state = useGraphStore.getState();
    expect(state.tabs.map((t) => t.id)).toEqual([
      useGraphStore.getState().tabs[0].id,
    ]);
    expect(state.activeTabId).toBe(state.tabs[0].id);
    expect(state.title).toBe("Tab 1");
  });

  it("asks for confirmation before closing a non-empty tab, then closes on confirm", () => {
    const { secondId } = seedTwoTabs();
    useGraphStore.getState().switchTab(secondId);
    // tab 2 holds node b1 → non-empty.
    useGraphStore.getState().closeTab(secondId);

    expect(useGraphStore.getState().confirmDialogue).not.toBeNull();
    expect(useGraphStore.getState().tabs).toHaveLength(2); // not closed yet

    useGraphStore.getState().confirmDialogue!.onConfirm();
    const state = useGraphStore.getState();
    expect(state.tabs).toHaveLength(1);
    expect(state.activeTabId).toBe(state.tabs[0].id);
    expect(state.confirmDialogue).toBeNull();
  });

  it("replaces the last tab with a fresh empty one (never zero tabs)", () => {
    const id = useGraphStore.getState().activeTabId;
    useGraphStore.setState({ nodes: [] });
    useGraphStore.getState().closeTab(id);

    const state = useGraphStore.getState();
    expect(state.tabs).toHaveLength(1);
    expect(state.tabs[0].id).not.toBe(id);
    expect(state.tabs[0].name).toBe("Tab 1");
    expect(state.activeTabId).toBe(state.tabs[0].id);
    expect(state.nodes).toEqual([]);
    // The replacement carries no undo history.
    expect(useGraphStore.temporal.getState().pastStates).toHaveLength(0);
  });

  it("ignores unknown tab ids", () => {
    useGraphStore.getState().closeTab("nope");
    expect(useGraphStore.getState().tabs).toHaveLength(1);
    expect(useGraphStore.getState().confirmDialogue).toBeNull();
  });
});

describe("commitViewport", () => {
  it("records the viewport on the active tab only", () => {
    const { secondId } = seedTwoTabs();
    useGraphStore
      .getState()
      .commitViewport({ x: 10, y: -20, zoom: 1.5 });

    const tabs = useGraphStore.getState().tabs;
    expect(tabs[0].viewport).toEqual({ x: 10, y: -20, zoom: 1.5 });
    expect(tabs.find((t) => t.id === secondId)?.viewport).toBeNull();
  });

  it("does not push an undo entry", () => {
    useGraphStore.getState().addVertexAt({ x: 0, y: 0 });
    const baseline = useGraphStore.temporal.getState().pastStates.length;
    useGraphStore
      .getState()
      .commitViewport({ x: 1, y: 2, zoom: 3 });
    expect(useGraphStore.temporal.getState().pastStates.length).toBe(baseline);
  });
});

describe("clipboard is shared across tabs", () => {
  it("copy in one tab, paste into another", () => {
    const { secondId } = seedTwoTabs();
    useGraphStore.setState({
      nodes: [makeVertex("a", { selected: true })],
    });
    useGraphStore.getState().copySelected();
    expect(useGraphStore.getState().clipboard).not.toBeNull();

    useGraphStore.getState().switchTab(secondId);
    expect(useGraphStore.getState().clipboard).not.toBeNull();

    useGraphStore.getState().paste();
    const pasted = useGraphStore
      .getState()
      .nodes.filter((n) => n.id !== "b1");
    expect(pasted).toHaveLength(1);
    expect(pasted[0].id).not.toBe("a");
  });
});

describe("stale React Flow changes after a tab switch", () => {
  // React Flow emits `remove` changes for the ids that vanished from the
  // `nodes` prop when a switch swaps the whole graph. Those changes are
  // no-ops against the incoming tab's graph and must not create new
  // array references — otherwise every switch would land a spurious
  // entry on the incoming tab's undo stack.
  it("a stale 'remove' for the previous tab's node/edge ids is a no-op", () => {
    const { secondId } = seedTwoTabs();
    useGraphStore.setState({ nodes: [makeVertex("a1")] });
    useGraphStore.getState().switchTab(secondId);

    useGraphStore.getState().onNodesChange([{ id: "a1", type: "remove" }]);
    useGraphStore
      .getState()
      .onEdgesChange([{ id: "old-edge", type: "remove" }]);

    const state = useGraphStore.getState();
    expect(state.nodes.map((n) => n.id)).toEqual(["b1"]);
    expect(state.edges).toEqual([]);
    // No spurious undo entry from the no-op batch.
    expect(useGraphStore.temporal.getState().pastStates).toHaveLength(0);
  });

  it("a stale 'select' for the previous tab's node id is a no-op", () => {
    const { secondId } = seedTwoTabs();
    useGraphStore.setState({ nodes: [makeVertex("a1")] });
    useGraphStore.getState().switchTab(secondId);

    useGraphStore.getState().onNodesChange([
      { id: "a1", type: "select", selected: false },
    ]);
    const state = useGraphStore.getState();
    expect(state.nodes.map((n) => n.id)).toEqual(["b1"]);
    expect(state.nodes[0].selected).toBe(false);
    expect(useGraphStore.temporal.getState().pastStates).toHaveLength(0);
  });
});

describe("export exports the active tab only", () => {
  it("exportGraph('json') serializes the current tab's graph", async () => {
    const { secondId } = seedTwoTabs();
    useGraphStore.setState({
      nodes: [makeVertex("a1", { position: { x: 12, y: 12 } })],
      edges: [makeEdge("e1", "a1", "a1")],
    });
    useGraphStore.getState().switchTab(secondId);

    await useGraphStore.getState().exportGraph("json");

    const params = vi.mocked(saveTextFileWithPicker).mock.calls[0]?.[0];
    const parsed = JSON.parse(params?.contents ?? "");
    // Only tab 2's content, titled with the tab's name.
    expect(parsed.title).toBe("Tab 2");
    expect(parsed.graph.nodes.map((n: { id: string }) => n.id)).toEqual([
      "b1",
    ]);
    expect(parsed.graph.edges).toEqual([]);
  });
});

describe("save / hydrate round-trip of the tab workspace", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("persists every tab and restores them with the active tab intact", () => {
    const { secondId } = seedTwoTabs();
    useGraphStore.setState({
      nodes: [makeVertex("a1"), makeVertex("a2")],
      edges: [makeEdge("e1", "a1", "a2")],
    });
    useGraphStore.getState().renameTab(secondId, "Second board");
    useGraphStore.getState().save();

    // Wipe runtime state to prove hydrate repopulates from disk.
    useGraphStore.setState({ nodes: [], edges: [], tabs: [], activeTabId: "" });

    useGraphStore.getState().hydrate();
    const state = useGraphStore.getState();

    expect(state.tabs).toHaveLength(2);
    expect(state.tabs.map((t) => t.name)).toEqual(["Tab 1", "Second board"]);
    // Tab 1 was active at save time.
    expect(state.activeTabId).toBe(state.tabs[0].id);
    expect(state.nodes.map((n) => n.id).sort()).toEqual(["a1", "a2"]);
    expect(state.edges).toHaveLength(1);

    // Switch to the restored second tab.
    useGraphStore.getState().switchTab(state.tabs[1].id);
    expect(useGraphStore.getState().nodes.map((n) => n.id)).toEqual(["b1"]);
  });

  it("hydrate clears all undo trees (history is session-only)", () => {
    useGraphStore.getState().addVertexAt({ x: 0, y: 0 });
    useGraphStore.getState().save();
    useGraphStore.setState({ tabs: [], activeTabId: "" });
    useGraphStore.getState().hydrate();
    expect(useGraphStore.temporal.getState().pastStates).toHaveLength(0);
  });

  it("hydrate falls back to one empty tab when a tab's elements are malformed", () => {
    // A wrapper whose tab document passes the shape check but holds
    // `data: null` fails hydration — fail soft with a backup.
    localStorage.setItem(
      "graph-board-document",
      JSON.stringify({
        layout: "tabs",
        activeTabId: "t1",
        tabs: [
          {
            id: "t1",
            document: {
              schemaVersion: 2,
              id: "t1",
              title: "Broken",
              graph: { nodes: [{ id: "x", data: null }], edges: [] },
              view: { nodes: [{ id: "x", position: { x: 0, y: 0 } }], edges: [] },
              createdAt: "2025-01-01T00:00:00.000Z",
              updatedAt: "2025-01-01T00:00:00.000Z",
            },
          },
        ],
      }),
    );

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    useGraphStore.getState().hydrate();
    warn.mockRestore();

    const state = useGraphStore.getState();
    expect(state.tabs).toHaveLength(1);
    expect(state.nodes).toEqual([]);
    expect(state.hasHydrated).toBe(true);
    expect(localStorage.getItem("graph-board-document-backup")).not.toBeNull();
  });
});
