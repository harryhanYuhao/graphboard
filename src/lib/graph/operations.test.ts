// src/lib/graph/operations.test.ts
//
// Pure-function tests for the graph mutation helpers. These functions are
// the canonical place to do graph-theoretic work (create, delete, copy,
// paste, selection bookkeeping) — every consumer goes through them, so
// they get the highest leverage per test written.

import { describe, expect, it } from "vitest";
import {
  clearAllSelections,
  cloneSubgraphForClipboard,
  computeVertexClick,
  createGraphEdge,
  createVertexNode,
  deleteSelectedElements,
  getSelectedSubgraph,
  PASTE_OFFSET_STEP,
  pasteSubgraph,
  selectAllElements,
} from "./operations";
import { EDGE_TYPES, HANDLE_IDS, type VertexNode } from "./types";
import { makeEdge, makeVertex } from "@/test-utils/factories";

describe("createVertexNode", () => {
  it("produces a node with a unique id and the given position", () => {
    const a = createVertexNode({ x: 10, y: 20 });
    const b = createVertexNode({ x: 10, y: 20 });
    expect(a.id).not.toEqual(b.id);
    expect(a.position).toEqual({ x: 10, y: 20 });
  });

  it("defaults to the default vertex type", () => {
    const node = createVertexNode({ x: 0, y: 0 });
    expect(node.data.vertexType).toBe("z");
  });

  it("respects an explicit vertex type", () => {
    const node = createVertexNode({ x: 0, y: 0 }, "x");
    expect(node.data.vertexType).toBe("x");
  });
});

describe("createGraphEdge", () => {
  it("returns a straight-center edge between the given endpoints", () => {
    const edge = createGraphEdge("a", "b");
    expect(edge.source).toBe("a");
    expect(edge.target).toBe("b");
    expect(edge.type).toBe(EDGE_TYPES.straightCenter);
    expect(edge.id).toBeTruthy();
    // Source side is always the bottom slot (HANDLE_IDS.centerSource)
    // — the side edges leave from, regardless of vertex type.
    expect(edge.sourceHandle).toBe(HANDLE_IDS.centerSource);
    // Without a node list we can't pick the right target handle, so
    // it stays unset and the serializer falls back to the default.
    expect(edge.targetHandle).toBeUndefined();
  });

  it("picks the directional 'top' handle for W / And gate targets", () => {
    const nodes: VertexNode[] = [
      { ...makeVertex("a", { x: 0, y: 0 }), data: { label: "", vertexType: "w" } },
      { ...makeVertex("b", { x: 0, y: 0 }), data: { label: "", vertexType: "and" } },
    ];
    const edge = createGraphEdge("a", "b", nodes);
    expect(edge.targetHandle).toBe(HANDLE_IDS.top);
  });

  it("falls back to the centered target handle for non-directional targets", () => {
    const nodes: VertexNode[] = [
      makeVertex("a", { x: 0, y: 0 }),
      { ...makeVertex("b", { x: 0, y: 0 }), data: { label: "", vertexType: "x" } },
    ];
    const edge = createGraphEdge("a", "b", nodes);
    expect(edge.targetHandle).toBe(HANDLE_IDS.centerTarget);
  });
});

describe("deleteSelectedElements", () => {
  it("removes selected nodes", () => {
    const nodes = [
      makeVertex("a", { x: 0, y: 0 }, true),
      makeVertex("b", { x: 0, y: 0 }, false),
    ];
    const result = deleteSelectedElements({ nodes, edges: [] });
    expect(result.nodes.map((n) => n.id)).toEqual(["b"]);
  });

  it("removes selected edges", () => {
    const edges = [
      makeEdge("e1", "a", "b", true),
      makeEdge("e2", "a", "b", false),
    ];
    const result = deleteSelectedElements({ nodes: [], edges });
    expect(result.edges.map((e) => e.id)).toEqual(["e2"]);
  });

  it("cascades: also removes edges whose endpoints get deleted", () => {
    const nodes = [
      makeVertex("a", { x: 0, y: 0 }, true),
      makeVertex("b", { x: 0, y: 0 }, false),
    ];
    const edges = [
      makeEdge("e1", "a", "b", false), // not selected but a will be deleted
    ];
    const result = deleteSelectedElements({ nodes, edges });
    expect(result.edges).toHaveLength(0);
  });

  it("leaves a graph with no selection untouched", () => {
    const nodes = [makeVertex("a", { x: 0, y: 0 }, false)];
    const edges = [makeEdge("e1", "a", "a", false)];
    const result = deleteSelectedElements({ nodes, edges });
    expect(result.nodes).toHaveLength(1);
    expect(result.edges).toHaveLength(1);
  });
});

describe("getSelectedSubgraph", () => {
  it("includes only edges whose both endpoints are selected", () => {
    const nodes = [
      makeVertex("a", { x: 0, y: 0 }, true),
      makeVertex("b", { x: 0, y: 0 }, true),
      makeVertex("c", { x: 0, y: 0 }, false),
    ];
    const edges = [
      makeEdge("e1", "a", "b", false), // both selected
      makeEdge("e2", "a", "c", false), // dangling, c not selected
    ];
    const sub = getSelectedSubgraph({ nodes, edges });
    expect(sub.nodes.map((n) => n.id).sort()).toEqual(["a", "b"]);
    expect(sub.edges.map((e) => e.id)).toEqual(["e1"]);
  });

  it("returns an empty subgraph when nothing is selected", () => {
    const nodes = [makeVertex("a", { x: 0, y: 0 }, false)];
    const edges = [makeEdge("e1", "a", "a", false)];
    const sub = getSelectedSubgraph({ nodes, edges });
    expect(sub.nodes).toHaveLength(0);
    expect(sub.edges).toHaveLength(0);
  });
});

describe("cloneSubgraphForClipboard", () => {
  it("preserves internal ids so edge→node references stay intact", () => {
    const nodes = [makeVertex("a", { x: 1, y: 1 })];
    const edges = [makeEdge("e1", "a", "a")];
    const clone = cloneSubgraphForClipboard({ nodes, edges });
    expect(clone.nodes[0].id).toBe("a");
    expect(clone.edges[0].source).toBe("a");
  });

  it("does not mutate the input", () => {
    const node = makeVertex("a", { x: 0, y: 0 });
    const edge = makeEdge("e1", "a", "a");
    cloneSubgraphForClipboard({ nodes: [node], edges: [edge] });
    expect(node.selected).toBe(false);
    expect(edge.selected).toBe(false);
  });
});

describe("pasteSubgraph", () => {
  const subgraph = {
    nodes: [makeVertex("a", { x: 10, y: 10 })],
    edges: [makeEdge("e1", "a", "a")],
  };

  it("re-mints every node and edge id", () => {
    const result = pasteSubgraph({ subgraph, pasteCount: 0 });
    expect(result.nodes[0].id).not.toBe("a");
    expect(result.edges[0].id).not.toBe("e1");
  });

  it("translates positions by PASTE_OFFSET_STEP * pasteCount", () => {
    expect(pasteSubgraph({ subgraph, pasteCount: 0 }).nodes[0].position).toEqual({
      x: 10,
      y: 10,
    });
    expect(pasteSubgraph({ subgraph, pasteCount: 2 }).nodes[0].position).toEqual({
      x: 10 + PASTE_OFFSET_STEP * 2,
      y: 10 + PASTE_OFFSET_STEP * 2,
    });
  });

  it("marks pasted elements selected so the user can immediately move them", () => {
    const result = pasteSubgraph({ subgraph, pasteCount: 0 });
    expect(result.nodes[0].selected).toBe(true);
    expect(result.edges[0].selected).toBe(true);
  });

  it("rewires edge endpoints to the new node ids", () => {
    const result = pasteSubgraph({ subgraph, pasteCount: 0 });
    expect(result.edges[0].source).toBe(result.nodes[0].id);
    expect(result.edges[0].target).toBe(result.nodes[0].id);
  });

  it("throws on a malformed subgraph (edge endpoint missing from nodes)", () => {
    expect(() =>
      pasteSubgraph({
        subgraph: {
          nodes: [makeVertex("a", { x: 0, y: 0 })],
          edges: [makeEdge("e1", "a", "ghost")],
        },
        pasteCount: 0,
      }),
    ).toThrow(/missing from subgraph/);
  });
});

describe("selectAllElements / clearAllSelections", () => {
  const nodes = [
    makeVertex("a", { x: 0, y: 0 }, false),
    makeVertex("b", { x: 0, y: 0 }, true),
  ];
  const edges = [makeEdge("e1", "a", "b", false)];

  it("selectAll marks every node and edge selected", () => {
    const result = selectAllElements({ nodes, edges });
    expect(result.nodes.every((n) => n.selected)).toBe(true);
    expect(result.edges.every((e) => e.selected)).toBe(true);
  });

  it("clearAllSelections clears every node and edge", () => {
    const result = clearAllSelections({ nodes, edges });
    expect(result.nodes.every((n) => !n.selected)).toBe(true);
    expect(result.edges.every((e) => !e.selected)).toBe(true);
  });

  it("selectAll on an already-all-selected graph returns equivalent shape", () => {
    const allSelected = {
      nodes: nodes.map((n) => ({ ...n, selected: true })),
      edges: edges.map((e) => ({ ...e, selected: true })),
    };
    const result = selectAllElements(allSelected);
    expect(result.nodes.every((n) => n.selected)).toBe(true);
    expect(result.edges.every((e) => e.selected)).toBe(true);
  });
});

// ---- computeVertexClick ---------------------------------------------------
//
// The click dispatcher. Six mutually-exclusive cases; the store
// integration tests cover the happy paths, but the per-case unit tests
// below nail down the edge behavior (no-op on already-pending modifier
// click, empty fan-out, selection cleared on commit, etc.) that the
// store would otherwise only exercise end-to-end.

describe("computeVertexClick", () => {
  const baseNodes = (): VertexNode[] => [
    makeVertex("a", { x: 0, y: 0 }),
    makeVertex("b", { x: 50, y: 0 }),
  ];

  describe("(1) modifier click", () => {
    it("appends the vertex to pending sources", () => {
      const result = computeVertexClick({
        vertexId: "a",
        modifiers: { modifier: true, shift: false },
        pendingEdgeSources: [],
        nodes: baseNodes(),
        edges: [],
      });
      expect(result).toEqual({ pendingEdgeSources: ["a"] });
    });

    it("returns null when the vertex is already pending (no-op)", () => {
      // Modifier-click is for adding, not removing. Removing is the
      // plain-click case. A no-op here keeps the keyboard/mouse
      // gesture set consistent: only the un-modified click toggles.
      const result = computeVertexClick({
        vertexId: "a",
        modifiers: { modifier: true, shift: false },
        pendingEdgeSources: ["a"],
        nodes: baseNodes(),
        edges: [],
      });
      expect(result).toBeNull();
    });

    it("does not create an edge", () => {
      const result = computeVertexClick({
        vertexId: "b",
        modifiers: { modifier: true, shift: false },
        pendingEdgeSources: ["a"],
        nodes: baseNodes(),
        edges: [],
      });
      expect(result?.edges).toBeUndefined();
    });
  });

  describe("(2/3) first click with empty pending", () => {
    it("plain click seeds pending with the vertex", () => {
      const result = computeVertexClick({
        vertexId: "a",
        modifiers: { modifier: false, shift: false },
        pendingEdgeSources: [],
        nodes: baseNodes(),
        edges: [],
      });
      expect(result).toEqual({ pendingEdgeSources: ["a"] });
    });

    it("shift click also seeds pending (then the user can fan out)", () => {
      const result = computeVertexClick({
        vertexId: "a",
        modifiers: { modifier: false, shift: true },
        pendingEdgeSources: [],
        nodes: baseNodes(),
        edges: [],
      });
      expect(result).toEqual({ pendingEdgeSources: ["a"] });
    });
  });

  describe("(4) plain click on already-pending vertex", () => {
    it("toggles the vertex out of pending sources", () => {
      const result = computeVertexClick({
        vertexId: "a",
        modifiers: { modifier: false, shift: false },
        pendingEdgeSources: ["a", "b"],
        nodes: baseNodes(),
        edges: [],
      });
      expect(result).toEqual({ pendingEdgeSources: ["b"] });
    });

    it("shift click falls through to fan-out instead of toggling", () => {
      // Shift+click on a pending vertex must still produce edges —
      // otherwise shift would be a toggle-removal gesture too.
      const result = computeVertexClick({
        vertexId: "a",
        modifiers: { modifier: false, shift: true },
        pendingEdgeSources: ["a", "b"],
        nodes: baseNodes(),
        edges: [],
      });
      expect(result?.edges?.length).toBe(2);
      expect(result?.pendingEdgeSources).toBeUndefined();
    });
  });

  describe("(5) shift click with non-empty pending", () => {
    it("fans out edges and keeps pending sources intact", () => {
      const result = computeVertexClick({
        vertexId: "c",
        modifiers: { modifier: false, shift: true },
        pendingEdgeSources: ["a", "b"],
        nodes: [...baseNodes(), makeVertex("c", { x: 100, y: 0 })],
        edges: [],
      });
      expect(result?.edges).toHaveLength(2);
      expect(result?.pendingEdgeSources).toBeUndefined();
    });

    it("does not clear the selection (only the plain-click case does)", () => {
      const nodes = [
        { ...makeVertex("a", { x: 0, y: 0 }), selected: true },
        makeVertex("b", { x: 0, y: 0 }),
        makeVertex("c", { x: 0, y: 0 }),
      ];
      const result = computeVertexClick({
        vertexId: "c",
        modifiers: { modifier: false, shift: true },
        pendingEdgeSources: ["a", "b"],
        nodes,
        edges: [],
      });
      expect(result?.nodes).toBeUndefined();
    });
  });

  describe("(6) plain click with non-empty pending + fresh target", () => {
    it("fans out edges, clears pending, and clears selection", () => {
      const nodes = [
        { ...makeVertex("a", { x: 0, y: 0 }), selected: true },
        { ...makeVertex("b", { x: 50, y: 0 }), selected: true },
        makeVertex("c", { x: 100, y: 0 }),
      ];
      const result = computeVertexClick({
        vertexId: "c",
        modifiers: { modifier: false, shift: false },
        pendingEdgeSources: ["a", "b"],
        nodes,
        edges: [],
      });
      expect(result?.edges).toHaveLength(2);
      expect(result?.pendingEdgeSources).toEqual([]);
      expect(result?.nodes?.every((n) => !n.selected)).toBe(true);
    });

    it("still resets state when the fan-out yields no new edges", () => {
      // Existing edges a→c and b→c mean the fan-out produces nothing
      // new, but the plain-click gesture is still a commit-and-reset,
      // so pending sources and the selection get cleared even though
      // the edge list is unchanged.
      const result = computeVertexClick({
        vertexId: "c",
        modifiers: { modifier: false, shift: false },
        pendingEdgeSources: ["a", "b"],
        nodes: [
          ...baseNodes(),
          makeVertex("c", { x: 100, y: 0 }),
        ],
        edges: [makeEdge("e1", "a", "c"), makeEdge("e2", "b", "c")],
      });
      expect(result?.edges).toEqual([
        makeEdge("e1", "a", "c"),
        makeEdge("e2", "b", "c"),
      ]);
      expect(result?.pendingEdgeSources).toEqual([]);
      expect(result?.nodes?.every((n) => !n.selected)).toBe(true);
    });

    it("skips duplicate pairs but still emits any non-duplicate ones", () => {
      // a→c already exists; b→c is new. The patch should add only
      // b→c, not duplicate a→c.
      const result = computeVertexClick({
        vertexId: "c",
        modifiers: { modifier: false, shift: false },
        pendingEdgeSources: ["a", "b"],
        nodes: [
          ...baseNodes(),
          makeVertex("c", { x: 100, y: 0 }),
        ],
        edges: [makeEdge("e1", "a", "c")],
      });
      expect(result?.edges).toHaveLength(2); // the existing a→c + the new b→c
      expect(result?.edges?.map((e) => e.source).sort()).toEqual(["a", "b"]);
    });

    it("picks the directional 'top' handle id when the target is W / And", () => {
      const nodes: VertexNode[] = [
        makeVertex("a", { x: 0, y: 0 }),
        {
          ...makeVertex("c", { x: 100, y: 0 }),
          data: { label: "", vertexType: "w" },
        },
      ];
      const result = computeVertexClick({
        vertexId: "c",
        modifiers: { modifier: false, shift: false },
        pendingEdgeSources: ["a"],
        nodes,
        edges: [],
      });
      expect(result?.edges?.[0].targetHandle).toBe(HANDLE_IDS.top);
    });
  });
});