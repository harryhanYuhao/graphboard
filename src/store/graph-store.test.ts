// Store-action tests, hitting the store directly via `setState` / `getState`.
// `beforeEach` resets a known baseline so tests don't leak. localStorage comes
// from jsdom; `hydrate` isn't called here, so the baseline is whatever we set.

import { beforeEach, describe, expect, it } from "vitest";
import { useGraphStore } from "./graph-store";
import { EDGE_TYPES, type EditorMode } from "@/lib/graph/types";
import { makeEdge, makeVertexWith as makeVertex } from "@/test-utils/factories";

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
  // Clear the undo/redo stack so prior tests don't leak via snapshots.
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
  it("appends a new node at the given position, snapped to the dots", () => {
    useGraphStore.getState().addVertexAt({ x: 50, y: 75 });
    const nodes = useGraphStore.getState().nodes;
    expect(nodes).toHaveLength(1);
    // {50,75} → nearest dots {60,84} (dots at GRID_SIZE/2 + k·GRID_SIZE).
    expect(nodes[0].position).toEqual({ x: 60, y: 84 });
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
    // Plain click toggles a pending vertex off (the cancel gesture for a
    // single pending source). Self-loops are also filtered as duplicates.
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

describe("updateVertexPhase / updateVertexType", () => {
  it("updateVertexPhase changes only the targeted node", () => {
    useGraphStore.setState({
      nodes: [makeVertex("a", { data: { phase: "", vertexType: "z" } })],
    });
    useGraphStore.getState().updateVertexPhase("a", "hello");
    expect(useGraphStore.getState().nodes[0].data.phase).toBe("hello");
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

  it("updateVertexVisualLabel changes only the targeted node's view label", () => {
    useGraphStore.setState({
      nodes: [makeVertex("a", { label: "" }), makeVertex("b")],
    });
    useGraphStore.getState().updateVertexVisualLabel("a", "$\\alpha$");
    const nodes = useGraphStore.getState().nodes;
    expect(nodes[0].label).toBe("$\\alpha$");
    expect(nodes[1].label).toBe("");
    // The visual label never touches the graph slice.
    expect(nodes[0].data.phase).toBe("");
  });

  it("updateVertexLabelLocation changes only the targeted node's location", () => {
    useGraphStore.setState({
      nodes: [makeVertex("a"), makeVertex("b")],
    });
    useGraphStore.getState().updateVertexLabelLocation("a", "right");
    const nodes = useGraphStore.getState().nodes;
    expect(nodes[0].labelLocation).toBe("right");
    expect(nodes[1].labelLocation).toBe("top");
  });
});

describe("updateEdgeKind", () => {
  it("changes only the targeted edge's kind", () => {
    useGraphStore.setState({
      nodes: [makeVertex("a"), makeVertex("b")],
      edges: [makeEdge("e1", "a", "b"), makeEdge("e2", "a", "b")],
    });
    useGraphStore.getState().updateEdgeKind("e1", "dashed_blue");
    const edges = useGraphStore.getState().edges;
    expect(edges[0]?.data?.kind).toBe("dashed_blue");
    expect(edges[1]?.data?.kind).toBe("default");
  });

  it("is structural: it lands on the undo stack and undo restores the old kind", () => {
    useGraphStore.setState({
      nodes: [makeVertex("a"), makeVertex("b")],
      edges: [makeEdge("e1", "a", "b")],
    });
    const baseline = useGraphStore.temporal.getState().pastStates.length;
    useGraphStore.getState().updateEdgeKind("e1", "dashed_blue");
    expect(useGraphStore.temporal.getState().pastStates.length).toBe(
      baseline + 1,
    );
    useGraphStore.temporal.getState().undo();
    expect(useGraphStore.getState().edges[0]?.data?.kind).toBe("default");
  });
});

describe("selectedEdgeKind / setEdgeKind (add-edge staging)", () => {
  it("defaults to the default kind", () => {
    expect(useGraphStore.getState().selectedEdgeKind).toBe("default");
  });

  it("setEdgeKind stages the kind", () => {
    useGraphStore.getState().setEdgeKind("dashed_blue");
    expect(useGraphStore.getState().selectedEdgeKind).toBe("dashed_blue");
  });

  it("handleVertexClick creates new edges with the staged kind", () => {
    useGraphStore.setState({
      mode: "add-edge",
      selectedEdgeKind: "dashed_blue",
    });
    useGraphStore
      .getState()
      .handleVertexClick("a", { modifier: false, shift: false });
    useGraphStore
      .getState()
      .handleVertexClick("b", { modifier: false, shift: false });
    expect(useGraphStore.getState().edges[0]?.data?.kind).toBe("dashed_blue");
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

describe("setVertexType", () => {
  it.each<[EditorMode]>([["z"], ["x"], ["w"], ["h"]])(
    "updates selectedVertexType to '%s'",
    (next) => {
      useGraphStore.getState().setVertexType(next);
      expect(useGraphStore.getState().selectedVertexType).toBe(next);
    },
  );
});

describe("updateVertexRotation", () => {
  it("changes only the targeted node's rotation", () => {
    useGraphStore.setState({
      nodes: [makeVertex("a", { rotation: 0 }), makeVertex("b", { rotation: 0 })],
    });
    useGraphStore.getState().updateVertexRotation("a", 45);
    const nodes = useGraphStore.getState().nodes;
    expect(nodes[0].rotation).toBe(45);
    expect(nodes[1].rotation).toBe(0);
  });

  it("leaves other vertex fields untouched", () => {
    useGraphStore.setState({
      nodes: [makeVertex("a", { rotation: 10, data: { phase: "hi", vertexType: "z" } })],
    });
    useGraphStore.getState().updateVertexRotation("a", 90);
    const node = useGraphStore.getState().nodes[0];
    expect(node.data).toEqual({ phase: "hi", vertexType: "z" });
    expect(node.position).toEqual({ x: 0, y: 0 });
  });
});

describe("confirmDialogue open/close", () => {
  it("openConfirmDialogue stores a full dialogue state", () => {
    const onConfirm = () => {};
    useGraphStore.getState().openConfirmDialogue({
      title: "Delete?",
      message: "This will remove the vertex.",
      onConfirm,
      confirmText: "Delete",
      cancelText: "Cancel",
      confirmButtonClassName: "bg-red-600",
    });
    const dialogue = useGraphStore.getState().confirmDialogue;
    expect(dialogue).toEqual({
      title: "Delete?",
      message: "This will remove the vertex.",
      confirmText: "Delete",
      cancelText: "Cancel",
      confirmButtonClassName: "bg-red-600",
      onConfirm,
    });
  });

  it("openConfirmDialogue uses sensible defaults for optional fields", () => {
    useGraphStore.getState().openConfirmDialogue({
      title: "Delete?",
      message: "...",
      onConfirm: () => {},
    });
    const dialogue = useGraphStore.getState().confirmDialogue!;
    expect(dialogue.confirmText).toBe("Confirm");
    expect(dialogue.cancelText).toBe("Cancel");
    expect(dialogue.confirmButtonClassName).toBe("bg-red-600 hover:bg-red-700");
  });

  it("closeConfirmDialogue drops the entire dialogue in one go", () => {
    useGraphStore.getState().openConfirmDialogue({
      title: "X",
      message: "y",
      onConfirm: () => {},
    });
    useGraphStore.getState().closeConfirmDialogue();
    expect(useGraphStore.getState().confirmDialogue).toBeNull();
  });

  it("calling onConfirm runs the supplied closure", () => {
    let called = 0;
    useGraphStore.getState().openConfirmDialogue({
      title: "X",
      message: "y",
      onConfirm: () => {
        called++;
      },
    });
    useGraphStore.getState().confirmDialogue!.onConfirm();
    expect(called).toBe(1);
  });
});

describe("save / hydrate round-trip via localStorage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("save writes a v1-shape document to localStorage", () => {
    useGraphStore.setState({
      title: "Persisted",
      nodes: [makeVertex("a", { position: { x: 10, y: 20 } })],
      edges: [],
    });
    useGraphStore.getState().save();

    const raw = localStorage.getItem("graph-board-document");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.title).toBe("Persisted");
    expect(parsed.graph.nodes).toHaveLength(1);
    expect(parsed.graph.nodes[0].id).toBe("a");
  });

  it("hydrate restores nodes, edges, title, and flips hasHydrated", () => {
    // Seed localStorage directly so this doesn't depend on save().
    localStorage.setItem(
      "graph-board-document",
      JSON.stringify({
        schemaVersion: 1,
        id: "local-document",
        title: "From disk",
        graph: {
          nodes: [{ id: "x", data: { phase: "lbl", vertexType: "z" } }],
          edges: [],
        },
        view: { nodes: [{ id: "x", position: { x: 5, y: 7 } }], edges: [] },
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
      }),
    );

    useGraphStore.getState().hydrate();
    const state = useGraphStore.getState();
    expect(state.title).toBe("From disk");
    expect(state.nodes).toHaveLength(1);
    expect(state.nodes[0].id).toBe("x");
    // Non-aligned disk positions snap to the dots on load.
    expect(state.nodes[0].position).toEqual({ x: 12, y: 12 });
    expect(state.hasHydrated).toBe(true);
  });

  it("hydrate into a non-empty graph bumps fitViewNonce so the view frames it", () => {
    // A reload into a saved graph should auto-frame once; the view layer's
    // fitView() runs in response to this nonce.
    localStorage.setItem(
      "graph-board-document",
      JSON.stringify({
        schemaVersion: 1,
        id: "local-document",
        title: "Non-empty",
        graph: {
          nodes: [{ id: "x", data: { phase: "lbl", vertexType: "z" } }],
          edges: [],
        },
        view: { nodes: [{ id: "x", position: { x: 5, y: 7 } }], edges: [] },
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
      }),
    );

    // Reset the nonce so a prior test's bump doesn't contaminate the assertion.
    useGraphStore.setState({ fitViewNonce: 0 });
    useGraphStore.getState().hydrate();
    expect(useGraphStore.getState().fitViewNonce).toBe(1);
  });

  it("hydrate into an empty graph leaves fitViewNonce at 0 (no stale queued fit)", () => {
    // An empty canvas must NOT queue a fit, or the first vertex added later
    // snaps the camera to it via xyflow's stale fitViewQueued.
    localStorage.setItem(
      "graph-board-document",
      JSON.stringify({
        schemaVersion: 1,
        id: "local-document",
        title: "Empty",
        graph: { nodes: [], edges: [] },
        view: { nodes: [], edges: [] },
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
      }),
    );

    useGraphStore.setState({ fitViewNonce: 0 });
    useGraphStore.getState().hydrate();
    expect(useGraphStore.getState().fitViewNonce).toBe(0);
  });

  it("save preserves the document's createdAt across repeated calls", () => {
    // createdAt must be stable across autosave ticks, not regenerated each call.
    useGraphStore.setState({
      title: "Stable",
      createdAt: "2020-05-05T05:05:05.000Z",
      nodes: [makeVertex("a", { position: { x: 1, y: 2 } })],
      edges: [],
    });

    useGraphStore.getState().save();
    const firstRaw = localStorage.getItem("graph-board-document")!;
    expect(JSON.parse(firstRaw).createdAt).toBe("2020-05-05T05:05:05.000Z");

    // A second save must not change it.
    useGraphStore.getState().save();
    const secondRaw = localStorage.getItem("graph-board-document")!;
    expect(JSON.parse(secondRaw).createdAt).toBe("2020-05-05T05:05:05.000Z");
  });

  it("hydrate clears stale validationErrors from the prior session", () => {
    // On reload the persisted doc comes back via `hydrate`; any compute-time
    // errors left in the store must be wiped (they referenced a graph that no
    // longer exists).
    localStorage.setItem(
      "graph-board-document",
      JSON.stringify({
        schemaVersion: 1,
        id: "local-document",
        title: "Reload",
        graph: { nodes: [], edges: [] },
        view: { nodes: [], edges: [] },
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
      }),
    );
    useGraphStore.getState().setValidationErrors([
      { kind: "w-input-count", message: "stale", vertexId: "w1" },
    ]);
    expect(useGraphStore.getState().validationErrors).not.toEqual({});

    useGraphStore.getState().hydrate();

    expect(useGraphStore.getState().validationErrors).toEqual({});
  });
});

describe("reset", () => {
  it("clears nodes/edges, resets mode, and persists the empty doc", () => {
    localStorage.clear();
    useGraphStore.setState({
      title: "Busy graph",
      nodes: [makeVertex("a"), makeVertex("b")],
      edges: [makeEdge("e1", "a", "b")],
      mode: "add-edge",
      pendingEdgeSources: ["a"],
      clipboard: { nodes: [], edges: [], pasteCount: 0 },
      isHelpOpen: true,
      confirmDialogue: { title: "x", message: "y", confirmText: "c", cancelText: "x", confirmButtonClassName: "z", onConfirm: () => {} },
    });

    useGraphStore.getState().reset();

    const state = useGraphStore.getState();
    expect(state.nodes).toEqual([]);
    expect(state.edges).toEqual([]);
    expect(state.mode).toBe("select");
    expect(state.pendingEdgeSources).toEqual([]);
    expect(state.clipboard).toBeNull();
    expect(state.isHelpOpen).toBe(false);
    expect(state.confirmDialogue).toBeNull();
    expect(state.title).toBe("Untitled Graph");
    // Reset writes the empty doc so a refresh keeps the cleared state.
    expect(localStorage.getItem("graph-board-document")).not.toBeNull();
  });

  it("clears validationErrors from the last compute", () => {
    localStorage.clear();
    // Seed the store with errors as if a prior compute had flagged a vertex.
    useGraphStore.getState().setValidationErrors([
      { kind: "w-input-count", message: "a", vertexId: "w1" },
    ]);
    expect(useGraphStore.getState().validationErrors).not.toEqual({});

    useGraphStore.getState().reset();

    expect(useGraphStore.getState().validationErrors).toEqual({});
  });
});

describe("onNodesChange / onEdgesChange (visual vs structural split)", () => {
  it("applies a 'select' change without recording it in the undo stack", () => {
    useGraphStore.setState({ nodes: [makeVertex("a")] });
    const pastBefore = useGraphStore.temporal.getState().pastStates.length;
    useGraphStore.getState().onNodesChange([{ id: "a", type: "select", selected: true }]);
    const pastAfter = useGraphStore.temporal.getState().pastStates.length;
    expect(useGraphStore.getState().nodes[0].selected).toBe(true);
    expect(pastAfter).toBe(pastBefore);
  });

  it("applies a 'position' change without recording it in the undo stack", () => {
    useGraphStore.setState({ nodes: [makeVertex("a", { position: { x: 0, y: 0 } })] });
    const pastBefore = useGraphStore.temporal.getState().pastStates.length;
    // Dot-aligned target ({108,108} = 12 + 4·24) so the snap is a no-op;
    // the point of this test is the undo-stack behavior, not the snap.
    useGraphStore
      .getState()
      .onNodesChange([{ id: "a", type: "position", position: { x: 108, y: 108 } }]);
    expect(useGraphStore.getState().nodes[0].position).toEqual({ x: 108, y: 108 });
    expect(useGraphStore.temporal.getState().pastStates.length).toBe(pastBefore);
  });

  it("snaps a 'position' change to the nearest dot", () => {
    useGraphStore.setState({ nodes: [makeVertex("a", { position: { x: 0, y: 0 } })] });
    // {50, 30} snaps to {60, 36} (nearest dots).
    useGraphStore
      .getState()
      .onNodesChange([{ id: "a", type: "position", position: { x: 50, y: 30 } }]);
    expect(useGraphStore.getState().nodes[0].position).toEqual({ x: 60, y: 36 });
  });

  it("leaves non-position changes (select, dimensions) untouched by snapping", () => {
    useGraphStore.setState({ nodes: [makeVertex("a", { position: { x: 0, y: 0 } })] });
    useGraphStore.getState().onNodesChange([
      { id: "a", type: "select", selected: true },
      { id: "a", type: "dimensions", dimensions: { width: 30, height: 30 } },
    ]);
    const node = useGraphStore.getState().nodes[0];
    expect(node.selected).toBe(true);
    expect(node.position).toEqual({ x: 0, y: 0 });
  });

  it("records 'remove' changes in the undo stack", () => {
    useGraphStore.setState({ nodes: [makeVertex("a"), makeVertex("b")] });
    const pastBefore = useGraphStore.temporal.getState().pastStates.length;
    useGraphStore.getState().onNodesChange([{ id: "a", type: "remove" }]);
    expect(useGraphStore.getState().nodes.map((n) => n.id)).toEqual(["b"]);
    expect(useGraphStore.temporal.getState().pastStates.length).toBe(pastBefore + 1);
  });

  it("handles a mixed batch (visual + structural) correctly", () => {
    useGraphStore.setState({ nodes: [makeVertex("a"), makeVertex("b")] });
    useGraphStore.getState().onNodesChange([
      { id: "a", type: "select", selected: true },
      { id: "b", type: "remove" },
    ]);
    const { nodes } = useGraphStore.getState();
    expect(nodes.map((n) => n.id)).toEqual(["a"]);
    expect(nodes[0].selected).toBe(true);
  });

  it("'select' on edges also bypasses the undo stack", () => {
    useGraphStore.setState({
      nodes: [makeVertex("a"), makeVertex("b")],
      edges: [makeEdge("e1", "a", "b")],
    });
    const pastBefore = useGraphStore.temporal.getState().pastStates.length;
    useGraphStore
      .getState()
      .onEdgesChange([{ id: "e1", type: "select", selected: true }]);
    expect(useGraphStore.getState().edges[0].selected).toBe(true);
    expect(useGraphStore.temporal.getState().pastStates.length).toBe(pastBefore);
  });
});

describe("drag gesture (onNodeDragStart/Stop)", () => {
  it("pauses the temporal store during the drag and pushes the pre-drag snapshot on stop", () => {
    useGraphStore.setState({
      nodes: [
        makeVertex("a", { position: { x: 0, y: 0 } }),
        makeVertex("b", { position: { x: 48, y: 0 } }),
      ],
      edges: [],
    });
    // setState above pushed one undo entry; capture the baseline to assert the delta.
    const baseline = useGraphStore.temporal.getState().pastStates.length;

    useGraphStore.getState().onNodeDragStart();
    // Visual changes during the drag must not land on the undo stack.
    useGraphStore
      .getState()
      .onNodesChange([{ id: "a", type: "position", position: { x: 96, y: 96 } }]);
    expect(useGraphStore.temporal.getState().pastStates.length).toBe(baseline);

    useGraphStore.getState().onNodeDragStop();
    // Stop injects the pre-drag snapshot so undo restores original positions.
    const pastAfter = useGraphStore.temporal.getState().pastStates;
    expect(pastAfter.length).toBe(baseline + 1);
    expect(pastAfter[pastAfter.length - 1].nodes.map((n) => n.position)).toEqual([
      { x: 0, y: 0 },
      { x: 48, y: 0 },
    ]);
  });
});

describe("vertex-property-edit gesture (onVertexPropertyEditStart/End)", () => {
  it("snapshots pre-edit state and pushes it on end (same trick as drag)", () => {
    useGraphStore.setState({
      nodes: [makeVertex("a", { rotation: 0 })],
    });
    const baseline = useGraphStore.temporal.getState().pastStates.length;

    useGraphStore.getState().onVertexPropertyEditStart();
    useGraphStore.getState().updateVertexRotation("a", 45);
    expect(useGraphStore.temporal.getState().pastStates.length).toBe(baseline);

    useGraphStore.getState().onVertexPropertyEditEnd();
    const pastAfter = useGraphStore.temporal.getState().pastStates;
    expect(pastAfter.length).toBe(baseline + 1);
    expect(pastAfter[pastAfter.length - 1].nodes[0].rotation).toBe(0);
  });
});

describe("validation errors", () => {
  it("setValidationErrors groups by vertex id", () => {
    useGraphStore.getState().setValidationErrors([
      { kind: "w-input-count", message: "a", vertexId: "w1" },
      { kind: "w-output-count", message: "b", vertexId: "w1" },
      { kind: "h-box-arity", message: "c", vertexId: "h1" },
    ]);
    const errs = useGraphStore.getState().validationErrors;
    expect(Object.keys(errs).sort()).toEqual(["h1", "w1"]);
    expect(errs.w1).toHaveLength(2);
    expect(errs.h1).toHaveLength(1);
  });

  it("setValidationErrors replaces (does not merge with) the prior map", () => {
    useGraphStore.getState().setValidationErrors([
      { kind: "w-input-count", message: "old", vertexId: "w1" },
    ]);
    // A new compute with a different offending vertex must drop w1.
    useGraphStore.getState().setValidationErrors([
      { kind: "h-box-arity", message: "new", vertexId: "h1" },
    ]);
    const errs = useGraphStore.getState().validationErrors;
    expect(errs).toEqual({
      h1: [{ kind: "h-box-arity", message: "new", vertexId: "h1" }],
    });
    expect(errs.w1).toBeUndefined();
  });

  it("setValidationErrors drops errors without a vertexId", () => {
    useGraphStore.getState().setValidationErrors([
      { kind: "w-input-count", message: "a", vertexId: "w1" },
      { kind: "w-input-count", message: "orphan" },
    ]);
    const errs = useGraphStore.getState().validationErrors;
    expect(errs).toEqual({ w1: [{ kind: "w-input-count", message: "a", vertexId: "w1" }] });
  });

  it("setValidationErrors([]) clears the map", () => {
    useGraphStore.getState().setValidationErrors([
      { kind: "w-input-count", message: "a", vertexId: "w1" },
    ]);
    useGraphStore.getState().setValidationErrors([]);
    expect(useGraphStore.getState().validationErrors).toEqual({});
  });

  it("clearValidationErrors empties the map", () => {
    useGraphStore.getState().setValidationErrors([
      { kind: "w-input-count", message: "a", vertexId: "w1" },
    ]);
    useGraphStore.getState().clearValidationErrors();
    expect(useGraphStore.getState().validationErrors).toEqual({});
  });

  it("changing validationErrors does not push onto the undo stack", () => {
    const baseline = useGraphStore.temporal.getState().pastStates.length;
    useGraphStore.getState().setValidationErrors([
      { kind: "w-input-count", message: "a", vertexId: "w1" },
    ]);
    useGraphStore.getState().clearValidationErrors();
    expect(useGraphStore.temporal.getState().pastStates.length).toBe(baseline);
  });

  // Edge cases the existing tests don't pin: duplicate ids collapse into one
  // bucket, a large batch still groups correctly, and — the load-bearing one —
  // an error with an EMPTY-STRING vertexId cannot be attributed to a node, so
  // it must be dropped just like a missing vertexId (otherwise a "" key
  // lingers in the map forever and node renderers never select it).
  it("setValidationErrors collapses duplicate vertexIds into one bucket", () => {
    useGraphStore.getState().setValidationErrors([
      { kind: "w-input-count", message: "1", vertexId: "w1" },
      { kind: "w-output-count", message: "2", vertexId: "w1" },
      { kind: "w-input-count", message: "3", vertexId: "w1" },
    ]);
    const errs = useGraphStore.getState().validationErrors;
    expect(Object.keys(errs)).toEqual(["w1"]);
    expect(errs.w1).toHaveLength(3);
  });

  it("setValidationErrors groups a large batch across many vertices", () => {
    const batch = [];
    for (let i = 0; i < 50; i++) {
      batch.push({
        kind: "w-input-count" as const,
        message: `err ${i}`,
        vertexId: `v${i % 10}`,
      });
    }
    useGraphStore.getState().setValidationErrors(batch);
    const errs = useGraphStore.getState().validationErrors;
    // 10 distinct vertex ids, 5 errors each.
    expect(Object.keys(errs).sort()).toEqual(
      Array.from({ length: 10 }, (_, i) => `v${i}`),
    );
    for (let i = 0; i < 10; i++) {
      expect(errs[`v${i}`]).toHaveLength(5);
    }
  });

  it("setValidationErrors drops errors with an empty-string vertexId", () => {
    useGraphStore.getState().setValidationErrors([
      { kind: "w-input-count", message: "real", vertexId: "w1" },
      { kind: "w-input-count", message: "empty-string id", vertexId: "" },
    ]);
    const errs = useGraphStore.getState().validationErrors;
    expect(errs).toEqual({
      w1: [{ kind: "w-input-count", message: "real", vertexId: "w1" }],
    });
    expect(errs[""]).toBeUndefined();
  });

  // A graph mutation between two error sets must not leak the (now-stale)
  // errors into the undo snapshot. `partialize` only captures `{nodes,edges}`,
  // but this pins that contract end-to-end: a real vertex add followed by an
  // error clear should leave exactly one undo entry (for the add), with that
  // snapshot carrying NO validationErrors.
  it("a graph mutation between error sets does not snapshot the errors", () => {
    useGraphStore.getState().setValidationErrors([
      { kind: "w-input-count", message: "a", vertexId: "w1" },
    ]);
    const baseline = useGraphStore.temporal.getState().pastStates.length;

    useGraphStore.getState().addVertexAt({ x: 1, y: 1 });
    useGraphStore.getState().setValidationErrors([]);

    const past = useGraphStore.temporal.getState().pastStates;
    expect(past.length).toBe(baseline + 1);
    // The snapshot for the add must not carry validationErrors at all.
    const snapshot = past[past.length - 1];
    expect((snapshot as { validationErrors?: unknown }).validationErrors).toBeUndefined();
  });
});