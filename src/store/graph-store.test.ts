// src/store/graph-store.test.ts
//
// Store-action tests. We don't mock the store; we hit it directly via
// `useGraphStore.setState` / `useGraphStore.getState` and assert on the
// resulting state shape. A `beforeEach` resets to a known baseline so
// tests don't leak into each other.
//
// `localStorage` is provided by jsdom. The store's `hydrate` action
// reads from it on first run; we never call `hydrate` in these tests so
// the baseline is whatever we set explicitly.

import { beforeEach, describe, expect, it } from "vitest";
import { useGraphStore } from "./graph-store";
import { EDGE_TYPES, type EditorMode } from "@/lib/graph/types";
import { makeEdge, makeVertexWith as makeVertex } from "@/test-utils/factories";

function resetStore() {
  useGraphStore.setState({
    title: "Untitled Graph",
    nodes: [],
    edges: [],
    mode: "select",
    hasHydrated: false,
    pendingEdgeSources: [],
    selectedVertexType: "z",
    confirmDialogue: null,
    isHelpOpen: false,
    clipboard: null,
  });
  // Clear the temporal (undo/redo) stack so past tests don't pollute
  // future ones via undo snapshots.
  useGraphStore.temporal.getState().clear();
}

beforeEach(resetStore);

describe("setMode", () => {
  it.each<[EditorMode]>([["select"], ["add-vertex"], ["add-edge"]])(
    "switches mode to %s",
    (next) => {
      useGraphStore.getState().setMode(next);
      expect(useGraphStore.getState().mode).toBe(next);
    },
  );

  it("clears pending edge sources when leaving add-edge", () => {
    useGraphStore.setState({ pendingEdgeSources: ["a", "b"], mode: "add-edge" });
    useGraphStore.getState().setMode("select");
    expect(useGraphStore.getState().pendingEdgeSources).toEqual([]);
  });

  it("auto-promotes currently selected vertices into pending sources on switch to add-edge", () => {
    useGraphStore.setState({
      nodes: [makeVertex("a", { selected: true }), makeVertex("b", { selected: false })],
    });
    useGraphStore.getState().setMode("add-edge");
    expect(useGraphStore.getState().pendingEdgeSources).toEqual(["a"]);
  });

  it("preserves prior pending sources when switching back to add-edge", () => {
    useGraphStore.setState({ pendingEdgeSources: ["x"], mode: "select" });
    useGraphStore.getState().setMode("add-edge");
    expect(useGraphStore.getState().pendingEdgeSources).toContain("x");
  });
});

describe("addVertexAt", () => {
  it("appends a new node at the given position", () => {
    useGraphStore.getState().addVertexAt({ x: 50, y: 75 });
    const nodes = useGraphStore.getState().nodes;
    expect(nodes).toHaveLength(1);
    expect(nodes[0].position).toEqual({ x: 50, y: 75 });
  });

  it("uses the currently selected vertex type", () => {
    useGraphStore.setState({ selectedVertexType: "x" });
    useGraphStore.getState().addVertexAt({ x: 0, y: 0 });
    expect(useGraphStore.getState().nodes[0].data.vertexType).toBe("x");
  });
});

describe("selectAll / clearSelection", () => {
  it("selectAll marks every node and edge selected", () => {
    useGraphStore.setState({
      nodes: [makeVertex("a"), makeVertex("b", { selected: true })],
      edges: [makeEdge("e1", "a", "b")],
    });
    useGraphStore.getState().selectAll();
    const { nodes, edges } = useGraphStore.getState();
    expect(nodes.every((n) => n.selected)).toBe(true);
    expect(edges.every((e) => e.selected)).toBe(true);
  });

  it("clearSelection marks every node and edge unselected", () => {
    useGraphStore.setState({
      nodes: [makeVertex("a", { selected: true })],
      edges: [
        { id: "e1", source: "a", target: "a", type: EDGE_TYPES.straightCenter, selected: true },
      ],
    });
    useGraphStore.getState().clearSelection();
    const { nodes, edges } = useGraphStore.getState();
    expect(nodes.every((n) => !n.selected)).toBe(true);
    expect(edges.every((e) => !e.selected)).toBe(true);
  });

  it("selectAll on an empty graph is a no-op shape-wise", () => {
    useGraphStore.getState().selectAll();
    expect(useGraphStore.getState().nodes).toEqual([]);
    expect(useGraphStore.getState().edges).toEqual([]);
  });
});

describe("copySelected / paste / cutSelected", () => {
  it("copySelected stores the selected subgraph in the clipboard", () => {
    useGraphStore.setState({
      nodes: [
        makeVertex("a", { selected: true }),
        makeVertex("b", { selected: true }),
        makeVertex("c"),
      ],
      edges: [makeEdge("e1", "a", "b")],
    });
    useGraphStore.getState().copySelected();
    const { clipboard } = useGraphStore.getState();
    expect(clipboard).not.toBeNull();
    expect(clipboard?.nodes.map((n) => n.id).sort()).toEqual(["a", "b"]);
    expect(clipboard?.edges).toHaveLength(1);
    expect(clipboard?.pasteCount).toBe(0);
  });

  it("paste adds nodes/edges to the canvas with fresh ids and marks them selected", () => {
    useGraphStore.setState({
      nodes: [makeVertex("a", { selected: true })],
      clipboard: {
        nodes: [makeVertex("a", { position: { x: 0, y: 0 } })],
        edges: [],
        pasteCount: 0,
      },
    });
    useGraphStore.getState().paste();
    const { nodes, clipboard } = useGraphStore.getState();
    expect(nodes).toHaveLength(2);
    expect(nodes[1].selected).toBe(true);
    expect(nodes[1].id).not.toBe("a");
    expect(clipboard?.pasteCount).toBe(1);
  });

  it("paste with an empty clipboard is a no-op", () => {
    useGraphStore.setState({ nodes: [makeVertex("a")] });
    useGraphStore.getState().paste();
    expect(useGraphStore.getState().nodes).toHaveLength(1);
  });

  it("cutSelected removes the original and fills the clipboard", () => {
    useGraphStore.setState({
      nodes: [makeVertex("a", { selected: true }), makeVertex("b")],
      edges: [],
    });
    useGraphStore.getState().cutSelected();
    const { nodes, clipboard } = useGraphStore.getState();
    expect(nodes.map((n) => n.id)).toEqual(["b"]);
    expect(clipboard?.nodes.map((n) => n.id)).toEqual(["a"]);
  });
});

describe("deleteSelected", () => {
  it("deletes selected nodes and their incident edges", () => {
    useGraphStore.setState({
      nodes: [makeVertex("a", { selected: true }), makeVertex("b")],
      edges: [makeEdge("e1", "a", "b")],
    });
    useGraphStore.getState().deleteSelected();
    const { nodes, edges } = useGraphStore.getState();
    expect(nodes.map((n) => n.id)).toEqual(["b"]);
    expect(edges).toHaveLength(0);
  });
});

describe("handleVertexClick (add-edge mode)", () => {
  beforeEach(() => {
    useGraphStore.setState({ mode: "add-edge" });
  });

  it("first click sets pendingEdgeSources to that vertex", () => {
    useGraphStore.getState().handleVertexClick("a", { modifier: false, shift: false });
    expect(useGraphStore.getState().pendingEdgeSources).toEqual(["a"]);
  });

  it("second click on a different vertex creates an edge and clears the pending list", () => {
    useGraphStore.getState().handleVertexClick("a", { modifier: false, shift: false });
    useGraphStore.getState().handleVertexClick("b", { modifier: false, shift: false });
    const { edges, pendingEdgeSources, nodes } = useGraphStore.getState();
    expect(edges).toHaveLength(1);
    expect(edges[0].source).toBe("a");
    expect(edges[0].target).toBe("b");
    expect(pendingEdgeSources).toEqual([]);
    expect(nodes.every((n) => !n.selected)).toBe(true);
  });

  it("does not create a duplicate parallel edge", () => {
    useGraphStore.setState({ edges: [makeEdge("e0", "a", "b")] });
    useGraphStore.getState().handleVertexClick("a", { modifier: false, shift: false });
    useGraphStore.getState().handleVertexClick("b", { modifier: false, shift: false });
    expect(useGraphStore.getState().edges).toHaveLength(1);
  });

  it("clicking the same vertex twice toggles pending sources (no self-loop)", () => {
    // Plain click on `a` puts it in pending sources. A second plain
    // click on `a` toggles it off — that's how the user cancels a
    // single-vertex pending selection. Self-loops are filtered as
    // duplicates if they ever do get committed via buildFanOut.
    useGraphStore.getState().handleVertexClick("a", { modifier: false, shift: false });
    useGraphStore.getState().handleVertexClick("a", { modifier: false, shift: false });
    expect(useGraphStore.getState().pendingEdgeSources).toEqual([]);
    expect(useGraphStore.getState().edges).toHaveLength(0);
  });

  it("does not recreate an existing parallel edge (incl. self-loops)", () => {
    useGraphStore.setState({ edges: [makeEdge("e0", "a", "a")] });
    useGraphStore.getState().handleVertexClick("a", { modifier: false, shift: false });
    useGraphStore.getState().handleVertexClick("a", { modifier: false, shift: false });
    // After the toggle-off, we have a pending=[], edges still=[a→a].
    expect(useGraphStore.getState().edges).toHaveLength(1);
  });

  it("modifier click adds to pending sources without creating an edge", () => {
    useGraphStore.getState().handleVertexClick("a", { modifier: false, shift: false });
    useGraphStore.getState().handleVertexClick("b", { modifier: true, shift: false });
    expect(useGraphStore.getState().pendingEdgeSources).toEqual(["a", "b"]);
    expect(useGraphStore.getState().edges).toHaveLength(0);
  });

  it("modifier click on a vertex already in pending sources is a no-op", () => {
    useGraphStore.getState().handleVertexClick("a", { modifier: false, shift: false });
    useGraphStore.getState().handleVertexClick("a", { modifier: true, shift: false });
    expect(useGraphStore.getState().pendingEdgeSources).toEqual(["a"]);
  });

  it("shift click fans out from all pending sources to the target without clearing", () => {
    useGraphStore.setState({ pendingEdgeSources: ["a", "b"] });
    useGraphStore.getState().handleVertexClick("c", { modifier: false, shift: true });
    const { edges, pendingEdgeSources } = useGraphStore.getState();
    expect(edges).toHaveLength(2);
    expect(pendingEdgeSources).toEqual(["a", "b"]);
  });

  it("click on a vertex already in pending sources toggles it off", () => {
    useGraphStore.getState().handleVertexClick("a", { modifier: false, shift: false });
    useGraphStore.getState().handleVertexClick("a", { modifier: false, shift: false });
    expect(useGraphStore.getState().pendingEdgeSources).toEqual([]);
  });

  it("no-op outside add-edge mode", () => {
    useGraphStore.setState({ mode: "select" });
    useGraphStore.getState().handleVertexClick("a", { modifier: false, shift: false });
    expect(useGraphStore.getState().pendingEdgeSources).toEqual([]);
    expect(useGraphStore.getState().edges).toHaveLength(0);
  });
});

describe("clearPendingEdgeSources", () => {
  it("empties the pending source list", () => {
    useGraphStore.setState({ pendingEdgeSources: ["a", "b"] });
    useGraphStore.getState().clearPendingEdgeSources();
    expect(useGraphStore.getState().pendingEdgeSources).toEqual([]);
  });
});

describe("addSelectedToPendingSources", () => {
  it("merges selected node ids into pendingEdgeSources (deduped)", () => {
    useGraphStore.setState({
      nodes: [
        makeVertex("a", { selected: true }),
        makeVertex("b", { selected: true }),
        makeVertex("c"),
      ],
      pendingEdgeSources: ["a"],
    });
    useGraphStore.getState().addSelectedToPendingSources();
    expect(useGraphStore.getState().pendingEdgeSources.sort()).toEqual(["a", "b"]);
  });

  it("is a no-op when nothing is selected", () => {
    useGraphStore.setState({ pendingEdgeSources: ["a"] });
    useGraphStore.getState().addSelectedToPendingSources();
    expect(useGraphStore.getState().pendingEdgeSources).toEqual(["a"]);
  });
});

describe("updateVertexLabel / updateVertexType", () => {
  it("updateVertexLabel changes only the targeted node", () => {
    useGraphStore.setState({
      nodes: [makeVertex("a", { data: { label: "", vertexType: "z" } })],
    });
    useGraphStore.getState().updateVertexLabel("a", "hello");
    expect(useGraphStore.getState().nodes[0].data.label).toBe("hello");
  });

  it("updateVertexType changes only the targeted vertex type", () => {
    useGraphStore.setState({
      nodes: [makeVertex("a"), makeVertex("b")],
    });
    useGraphStore.getState().updateVertexType("a", "x");
    const nodes = useGraphStore.getState().nodes;
    expect(nodes[0].data.vertexType).toBe("x");
    expect(nodes[1].data.vertexType).toBe("z");
  });
});

describe("help dialog state", () => {
  it("openHelp sets isHelpOpen true", () => {
    useGraphStore.getState().openHelp();
    expect(useGraphStore.getState().isHelpOpen).toBe(true);
  });

  it("closeHelp sets isHelpOpen false", () => {
    useGraphStore.setState({ isHelpOpen: true });
    useGraphStore.getState().closeHelp();
    expect(useGraphStore.getState().isHelpOpen).toBe(false);
  });

  it("toggleHelp flips the flag", () => {
    expect(useGraphStore.getState().isHelpOpen).toBe(false);
    useGraphStore.getState().toggleHelp();
    expect(useGraphStore.getState().isHelpOpen).toBe(true);
    useGraphStore.getState().toggleHelp();
    expect(useGraphStore.getState().isHelpOpen).toBe(false);
  });
});

describe("isStateEmpty", () => {
  it("is true on an empty graph", () => {
    expect(useGraphStore.getState().isStateEmpty()).toBe(true);
  });

  it("is false when there is at least one node", () => {
    useGraphStore.setState({ nodes: [makeVertex("a")] });
    expect(useGraphStore.getState().isStateEmpty()).toBe(false);
  });
});