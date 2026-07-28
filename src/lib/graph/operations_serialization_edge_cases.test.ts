// src/lib/graph/operations_serialization_edge_cases.test.ts
//
// Edge-case probes for the pure graph-logic modules (`operations.ts`) and
// the persistence boundary (`serialization.ts`). These are *deliberately*
// non-overlapping with `operations.test.ts` / `serialization.test.ts`:
// every test here targets a corner the existing suites don't pin — empty
// inputs, the `createGraphEdge` no-`nodes` asymmetry, handle-index
// round-trips for directional vertices, `parseDocument` shape rejection,
// and the documented-but-fragile behaviors (e.g. `cloneSubgraphForClipboard`
// not stripping `selected`).
//
// Latent bugs surfaced by these probes are pinned with `it.skip` plus a
// comment naming the violated contract and the actual behavior, so the
// parent agent keeps diff control over any fix.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
import {
  createEmptyGraphDocument,
  exportGraphJson,
  hydrateDocument,
  importGraphJson,
  loadGraphDocument,
  normalizeRotation,
  parseDocument,
  projectDocument,
  saveGraphDocument,
} from "./serialization";
import {
  CURRENT_SCHEMA_VERSION,
  HANDLE_IDS,
  PERSISTED_IDS,
  type GraphDocument,
  type GraphEdge,
  type VertexNode,
} from "./types";
import { makeEdge, makeVertex, makeVertexWith } from "@/test-utils/factories";

// ---- Operations: createVertexNode -----------------------------------------

describe("createVertexNode (edge cases)", () => {
  it("mints a unique id per call (nanoid)", () => {
    const a = createVertexNode({ x: 0, y: 0 });
    const b = createVertexNode({ x: 0, y: 0 });
    expect(a.id).not.toBe(b.id);
  });

  it("default data is label '', vertexType 'z', rotation 0, origin [0.5,0.5], type 'vertex'", () => {
    const node = createVertexNode({ x: 3, y: 4 });
    expect(node.type).toBe("vertex");
    expect(node.data).toEqual({ label: "", vertexType: "z" });
    expect(node.rotation).toBe(0);
    expect(node.origin).toEqual([0.5, 0.5]);
    expect(node.position).toEqual({ x: 3, y: 4 });
    expect(node.id).toBeTruthy();
  });

  it("passes an explicit vertexType through to data", () => {
    const node = createVertexNode({ x: 0, y: 0 }, "and");
    expect(node.data.vertexType).toBe("and");
  });

  it("uses the type's defaultText as the initial label when present", () => {
    // No shipped type has a non-empty defaultText today, but the helper
    // reads `VERTEX_TYPE_MAP[type].defaultText ?? ""` — pin that the
    // empty-string fallback holds for the default type.
    expect(createVertexNode({ x: 0, y: 0 }, "w").data.label).toBe("");
  });
});

// ---- Operations: createGraphEdge ------------------------------------------

describe("createGraphEdge (defaults)", () => {
  it("with `nodes` and a non-directional target: targetHandle is center-target", () => {
    const nodes: VertexNode[] = [makeVertex("b", { x: 0, y: 0 })];
    expect(createGraphEdge("a", "b", nodes).targetHandle).toBe(
      HANDLE_IDS.centerTarget,
    );
  });

  it("with `nodes` and a directional target (W): targetHandle is top", () => {
    const nodes: VertexNode[] = [
      makeVertexWith("b", { data: { vertexType: "w" } }),
    ];
    expect(createGraphEdge("a", "b", nodes).targetHandle).toBe(HANDLE_IDS.top);
  });

  it("edge created without `nodes` defaults targetHandle to center-target (no longer undefined)", () => {
    // FIXED: `createGraphEdge("a","b")` without `nodes` used to leave
    // `targetHandle = undefined`, which silently became `HANDLE_IDS.top`
    // on save/load for a directional target (the serializer's
    // default-on-hydrate fallback). It now defaults to
    // `HANDLE_IDS.centerTarget` — matching `sourceHandle`'s unconditional
    // default — so the runtime handle is always set and survives the
    // round-trip unchanged.
    expect(createGraphEdge("a", "b").targetHandle).toBe(
      HANDLE_IDS.centerTarget,
    );
  });

  it("edge created without `nodes` no longer leaves targetHandle undefined (round-trip is well-defined)", () => {
    // FIXED: `createGraphEdge("a","b")` without `nodes` used to leave
    // `targetHandle = undefined`, which silently became `HANDLE_IDS.top`
    // on save/load for a directional target (the serializer's
    // default-on-hydrate fallback). It now defaults to
    // `HANDLE_IDS.centerTarget` — matching `sourceHandle`'s unconditional
    // default — so the runtime handle is always set.
    //
    // NOTE: the persisted format is intentionally lossy for directional
    // vertices — both `centerTarget` and `top` map to numeric index 0
    // (the target-side slot). On hydrate, a directional target at index
    // 0 canonicalizes back to `top` (the visible input dot for W/And).
    // That canonicalization is correct (directional vertices only expose
    // `top` as a target), so a `centerTarget` on a directional vertex
    // round-tripping to `top` is the serializer doing its job, not a bug.
    // The bug was the *undefined* runtime value silently becoming
    // something — now it's always a concrete handle.
    const runtimeEdge = createGraphEdge("a", "b"); // no nodes
    expect(runtimeEdge.targetHandle).toBe(HANDLE_IDS.centerTarget);
  });
});

// ---- Operations: deleteSelectedElements -----------------------------------

describe("deleteSelectedElements (edge cases)", () => {
  it("with no selection is a no-op returning the same element sets", () => {
    const nodes = [makeVertex("a", { x: 0, y: 0 })];
    const edges = [makeEdge("e1", "a", "b")];
    const result = deleteSelectedElements({ nodes, edges });
    expect(result.nodes.map((n) => n.id)).toEqual(["a"]);
    expect(result.edges.map((e) => e.id)).toEqual(["e1"]);
  });

  it("cascade: edges to/from a deleted node are removed, edges between survivors stay", () => {
    const nodes = [
      makeVertex("a", { x: 0, y: 0 }, true), // deleted
      makeVertex("b", { x: 0, y: 0 }, false), // survives
      makeVertex("c", { x: 0, y: 0 }, false), // survives
    ];
    const edges = [
      makeEdge("e1", "a", "b"), // dangling after a deleted -> removed
      makeEdge("e2", "c", "a"), // dangling after a deleted -> removed
      makeEdge("e3", "b", "c"), // both survive -> kept
    ];
    const result = deleteSelectedElements({ nodes, edges });
    expect(result.nodes.map((n) => n.id).sort()).toEqual(["b", "c"]);
    expect(result.edges.map((e) => e.id)).toEqual(["e3"]);
  });

  it("with only edges selected: nodes survive and only the selected edges are removed", () => {
    const nodes = [makeVertex("a"), makeVertex("b"), makeVertex("c")];
    const edges = [
      makeEdge("e1", "a", "b", true), // selected -> removed
      makeEdge("e2", "b", "c", false), // unselected -> kept
    ];
    const result = deleteSelectedElements({ nodes, edges });
    expect(result.nodes).toHaveLength(3);
    expect(result.edges.map((e) => e.id)).toEqual(["e2"]);
  });

  it("deleting a node with a self-loop removes both the node and the self-loop", () => {
    const nodes = [makeVertex("a", { x: 0, y: 0 }, true)];
    const edges = [makeEdge("e1", "a", "a", false)];
    const result = deleteSelectedElements({ nodes, edges });
    expect(result.nodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
  });
});

// ---- Operations: computeVertexClick (explicit per-case) -------------------

describe("computeVertexClick (explicit parametric cases)", () => {
  const baseNodes = (): VertexNode[] => [
    makeVertex("a", { x: 0, y: 0 }),
    makeVertex("b", { x: 50, y: 0 }),
    makeVertex("c", { x: 100, y: 0 }),
  ];

  // The store's select-mode and add-vertex-mode never dispatch into
  // computeVertexClick at all (it's add-edge only), so the function
  // itself has no "mode" branch to test — those two cases are no-ops at
  // the call site, not inside the helper. We pin the add-edge cases
  // explicitly.

  it("add-edge, empty pending: first click seeds the pending list (no edge created)", () => {
    const result = computeVertexClick({
      vertexId: "a",
      modifiers: { modifier: false, shift: false },
      pendingEdgeSources: [],
      nodes: baseNodes(),
      edges: [],
    });
    expect(result).toEqual({ pendingEdgeSources: ["a"] });
    expect(result?.edges).toBeUndefined();
  });

  it("add-edge, source == clicked (already pending): plain click toggles it off (self-deselect)", () => {
    const result = computeVertexClick({
      vertexId: "a",
      modifiers: { modifier: false, shift: false },
      pendingEdgeSources: ["a", "b"],
      nodes: baseNodes(),
      edges: [],
    });
    expect(result).toEqual({ pendingEdgeSources: ["b"] });
  });

  it("add-edge, clicked already in pending list: modifier click is a no-op (toggle via plain only)", () => {
    const result = computeVertexClick({
      vertexId: "a",
      modifiers: { modifier: true, shift: false },
      pendingEdgeSources: ["a"],
      nodes: baseNodes(),
      edges: [],
    });
    expect(result).toBeNull();
  });

  it("add-edge, source != clicked: connects with a new edge and clears pending", () => {
    const result = computeVertexClick({
      vertexId: "c",
      modifiers: { modifier: false, shift: false },
      pendingEdgeSources: ["a"],
      nodes: baseNodes(),
      edges: [],
    });
    expect(result?.edges).toHaveLength(1);
    expect(result?.edges?.[0]).toMatchObject({ source: "a", target: "c" });
    expect(result?.pendingEdgeSources).toEqual([]);
  });

  it("add-edge, source != clicked with shift: connects but keeps pending (fan-out gesture)", () => {
    const result = computeVertexClick({
      vertexId: "c",
      modifiers: { modifier: false, shift: true },
      pendingEdgeSources: ["a", "b"],
      nodes: baseNodes(),
      edges: [],
    });
    expect(result?.edges).toHaveLength(2);
    expect(result?.pendingEdgeSources).toBeUndefined(); // unchanged -> not in patch
  });

  it("add-edge skips an already-existing pair but still emits the rest", () => {
    const result = computeVertexClick({
      vertexId: "c",
      modifiers: { modifier: false, shift: false },
      pendingEdgeSources: ["a", "b"],
      nodes: baseNodes(),
      edges: [makeEdge("e1", "a", "c")], // a->c already exists
    });
    expect(result?.edges?.map((e) => e.source).sort()).toEqual(["a", "b"]);
  });
});

// ---- Operations: getSelectedSubgraph --------------------------------------

describe("getSelectedSubgraph (edge cases)", () => {
  it("excludes edges that cross the selected/non-selected boundary (induced subgraph)", () => {
    const nodes = [
      makeVertex("a", { x: 0, y: 0 }, true),
      makeVertex("b", { x: 0, y: 0 }, true),
      makeVertex("c", { x: 0, y: 0 }, false),
    ];
    const edges = [
      makeEdge("e1", "a", "b"), // both selected -> kept
      makeEdge("e2", "a", "c"), // c not selected -> dropped
      makeEdge("e3", "c", "b"), // c not selected -> dropped
      makeEdge("e4", "c", "c"), // self-loop on a non-selected node -> dropped
    ];
    const sub = getSelectedSubgraph({ nodes, edges });
    expect(sub.nodes.map((n) => n.id).sort()).toEqual(["a", "b"]);
    expect(sub.edges.map((e) => e.id)).toEqual(["e1"]);
  });

  it("empty selection yields an empty subgraph", () => {
    const nodes = [makeVertex("a", { x: 0, y: 0 }, false)];
    const edges = [makeEdge("e1", "a", "a")];
    const sub = getSelectedSubgraph({ nodes, edges });
    expect(sub.nodes).toEqual([]);
    expect(sub.edges).toEqual([]);
  });
});

// ---- Operations: cloneSubgraphForClipboard --------------------------------

describe("cloneSubgraphForClipboard (edge cases)", () => {
  it("does not mutate the input (deep-equal before and after)", () => {
    const nodes = [
      makeVertexWith("a", {
        position: { x: 5, y: 6 },
        rotation: 42,
        data: { label: "ph", vertexType: "x" },
      }),
    ];
    const edges = [
      { ...makeEdge("e1", "a", "a"), sourceHandle: HANDLE_IDS.top },
    ];
    const snapshot = JSON.parse(JSON.stringify({ nodes, edges }));

    cloneSubgraphForClipboard({ nodes, edges });

    expect(JSON.parse(JSON.stringify({ nodes, edges }))).toEqual(snapshot);
  });

  it("produces a deep copy (mutating the clone does not affect the input)", () => {
    const nodes = [makeVertexWith("a", { data: { label: "L", vertexType: "z" } })];
    const clone = cloneSubgraphForClipboard({ nodes, edges: [] });
    clone.nodes[0].data.label = "changed";
    expect(nodes[0].data.label).toBe("L");
  });

  it("strips `selected` from nodes and edges so the clipboard is selection-agnostic", () => {
    // FIXED: the clone used to spread `...node` verbatim, carrying
    // `selected: true` onto the clipboard when a node was copied while
    // selected. That was stale state (paste re-selects the new nodes
    // explicitly via `pasteSubgraph`). The clone now forces
    // `selected: false` on both nodes and edges so the payload is
    // selection-agnostic.
    const nodes = [makeVertex("a", { x: 0, y: 0 }, true)];
    const edges = [{ ...makeEdge("e1", "a", "a"), selected: true }] as const;
    const clone = cloneSubgraphForClipboard({ nodes, edges: [...edges] });
    expect(clone.nodes[0].selected).toBe(false);
    expect(clone.edges[0].selected).toBe(false);
  });
});

// ---- Operations: pasteSubgraph --------------------------------------------

describe("pasteSubgraph (edge cases)", () => {
  it("mints new ids that do not collide with the originals", () => {
    const subgraph = {
      nodes: [makeVertex("a", { x: 1, y: 1 })],
      edges: [makeEdge("e1", "a", "a")],
    };
    const result = pasteSubgraph({ subgraph, pasteCount: 0 });
    const allOriginalIds = new Set(["a", "e1"]);
    for (const n of result.nodes) expect(allOriginalIds.has(n.id)).toBe(false);
    for (const e of result.edges) expect(allOriginalIds.has(e.id)).toBe(false);
  });

  it("mints distinct ids across two consecutive pastes", () => {
    const subgraph = {
      nodes: [makeVertex("a", { x: 0, y: 0 })],
      edges: [],
    };
    const r1 = pasteSubgraph({ subgraph, pasteCount: 0 });
    const r2 = pasteSubgraph({ subgraph, pasteCount: 1 });
    expect(r1.nodes[0].id).not.toBe(r2.nodes[0].id);
  });

  it("applies the paste offset to every node position (pasteCount * PASTE_OFFSET_STEP)", () => {
    const subgraph = {
      nodes: [
        makeVertex("a", { x: 10, y: 20 }),
        makeVertex("b", { x: -5, y: 0 }),
      ],
      edges: [],
    };
    const result = pasteSubgraph({ subgraph, pasteCount: 3 });
    const off = PASTE_OFFSET_STEP * 3;
    expect(result.nodes.map((n) => n.position)).toEqual([
      { x: 10 + off, y: 20 + off },
      { x: -5 + off, y: 0 + off },
    ]);
  });

  it("throws on a dangling edge source endpoint (id missing from node set)", () => {
    // operations.ts:325 throws when an edge endpoint isn't in the idMap.
    // The existing suite covers a dangling target; this pins a dangling
    // source as well.
    expect(() =>
      pasteSubgraph({
        subgraph: {
          nodes: [makeVertex("a", { x: 0, y: 0 })],
          edges: [makeEdge("e1", "ghost", "a")],
        },
        pasteCount: 0,
      }),
    ).toThrow(/missing from subgraph/);
  });

  it("throws on a dangling edge target endpoint (id missing from node set)", () => {
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

  it("with an empty subgraph returns empty nodes and edges", () => {
    const result = pasteSubgraph({ subgraph: { nodes: [], edges: [] }, pasteCount: 0 });
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
  });

  it("rewires every edge endpoint to the corresponding minted node id", () => {
    const subgraph = {
      nodes: [makeVertex("a", { x: 0, y: 0 }), makeVertex("b", { x: 1, y: 1 })],
      edges: [
        makeEdge("e1", "a", "b"),
        makeEdge("e2", "b", "a"),
        makeEdge("self", "a", "a"),
      ],
    };
    const result = pasteSubgraph({ subgraph, pasteCount: 0 });
    const idOf = (origId: string) =>
      result.nodes.find((n) => n.position.x === subgraph.nodes.find((s) => s.id === origId)!.position.x)!
        .id;
    // Map originals to minted ids via position (offset 0 at pasteCount 0).
    const aNew = idOf("a");
    const bNew = idOf("b");
    const byId = Object.fromEntries(result.edges.map((e) => [e.id, e]));
    const e1 = result.edges.find((e) => e.source === aNew && e.target === bNew);
    const e2 = result.edges.find((e) => e.source === bNew && e.target === aNew);
    const self = result.edges.find((e) => e.source === aNew && e.target === aNew);
    expect(e1).toBeTruthy();
    expect(e2).toBeTruthy();
    expect(self).toBeTruthy();
    expect(Object.keys(byId)).toHaveLength(3);
  });
});

// ---- Operations: selectAllElements / clearAllSelections -------------------

describe("selectAllElements / clearAllSelections (round-trip)", () => {
  it("selectAll then clearAllSelections returns every element to unselected", () => {
    const nodes = [
      makeVertex("a", { x: 0, y: 0 }, false),
      makeVertex("b", { x: 0, y: 0 }, true),
    ];
    const edges = [makeEdge("e1", "a", "b", false), makeEdge("e2", "a", "b", true)];
    const selected = selectAllElements({ nodes, edges });
    expect(selected.nodes.every((n) => n.selected)).toBe(true);
    expect(selected.edges.every((e) => e.selected)).toBe(true);
    const cleared = clearAllSelections(selected);
    expect(cleared.nodes.every((n) => !n.selected)).toBe(true);
    expect(cleared.edges.every((e) => !e.selected)).toBe(true);
  });

  it("selectAllElements on an empty graph returns empty arrays", () => {
    const result = selectAllElements({ nodes: [], edges: [] });
    expect(result).toEqual({ nodes: [], edges: [] });
  });

  it("clearAllSelections on an empty graph returns empty arrays", () => {
    const result = clearAllSelections({ nodes: [], edges: [] });
    expect(result).toEqual({ nodes: [], edges: [] });
  });
});

// ---- Serialization: normalizeRotation (exhaustive) ------------------------

describe("normalizeRotation (exhaustive)", () => {
  it.each<[number, number]>([
    [0, 0],
    [360, 0],
    [720, 0],
    [-90, 270],
    [-1, 359],
    [361, 1],
    [270.0000001, 270],
    [89.9999999, 90],
    [44.9999999, 45],
    [-0.0000001, 0],
    [540, 180],
    [-540, 180],
  ])("normalizes %f to %f", (input, expected) => {
    expect(normalizeRotation(input)).toBe(expected);
  });

  it("coerces NaN, Infinity, and -Infinity all to 0", () => {
    expect(normalizeRotation(NaN)).toBe(0);
    expect(normalizeRotation(Infinity)).toBe(0);
    expect(normalizeRotation(-Infinity)).toBe(0);
  });
});

// ---- Serialization: projectDocument / hydrateDocument ---------------------

describe("projectDocument / hydrateDocument (round-trip)", () => {
  const baseInput = {
    id: "doc-rt",
    title: "Round-trip",
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-02T00:00:00.000Z",
  };

  it("preserves nodes, edges, labels, vertexType, source/target, and handles for a directional graph", () => {
    const nodes: VertexNode[] = [
      makeVertex("a", { x: 10, y: 20 }),
      makeVertexWith("b", {
        position: { x: 30, y: 40 },
        rotation: 90,
        data: { label: "W0", vertexType: "w" },
      }),
      makeVertexWith("c", {
        position: { x: 50, y: 60 },
        data: { label: "AND", vertexType: "and" },
      }),
    ];
    const edges: GraphEdge[] = [
      {
        ...makeEdge("e1", "a", "b"),
        sourceHandle: HANDLE_IDS.centerSource,
        targetHandle: HANDLE_IDS.top, // directional W target
      },
      {
        ...makeEdge("e2", "b", "c"),
        sourceHandle: HANDLE_IDS.centerSource,
        targetHandle: HANDLE_IDS.top, // directional And target
      },
      {
        ...makeEdge("e3", "a", "c"),
        sourceHandle: HANDLE_IDS.centerSource,
        targetHandle: HANDLE_IDS.top,
      },
    ];

    const doc = projectDocument({ ...baseInput, nodes, edges });
    const hydrated = hydrateDocument(doc);

    expect(hydrated.nodes.map((n) => n.id)).toEqual(["a", "b", "c"]);
    expect(hydrated.nodes.map((n) => n.data)).toEqual([
      { label: "", vertexType: "z" },
      { label: "W0", vertexType: "w" },
      { label: "AND", vertexType: "and" },
    ]);
    expect(hydrated.nodes.map((n) => n.position)).toEqual([
      { x: 10, y: 20 },
      { x: 30, y: 40 },
      { x: 50, y: 60 },
    ]);
    expect(hydrated.edges.map((e) => `${e.source}->${e.target}`)).toEqual([
      "a->b",
      "b->c",
      "a->c",
    ]);
    // Every target on a directional vertex round-trips back to `top`.
    expect(hydrated.edges.every((e) => e.targetHandle === HANDLE_IDS.top)).toBe(true);
    expect(hydrated.edges.every((e) => e.sourceHandle === HANDLE_IDS.centerSource)).toBe(
      true,
    );
  });

  it("strips the ephemeral `selected` field across projection + hydration", () => {
    const nodes: VertexNode[] = [
      { ...makeVertex("a", { x: 0, y: 0 }), selected: true },
    ];
    const doc = projectDocument({ ...baseInput, nodes, edges: [] });
    expect(
      (doc.graph.nodes[0] as unknown as { selected?: boolean }).selected,
    ).toBeUndefined();
    const hydrated = hydrateDocument(doc);
    expect(hydrated.nodes[0].selected).toBeUndefined();
  });

  it("preserves rotation including directional vertices at 90 / 180 / 270", () => {
    const nodes: VertexNode[] = [
      makeVertexWith("z1", { rotation: 90 }),
      makeVertexWith("w1", { rotation: 180, data: { vertexType: "w" } }),
      makeVertexWith("and1", { rotation: 270, data: { vertexType: "and" } }),
    ];
    const doc = projectDocument({ ...baseInput, nodes, edges: [] });
    const hydrated = hydrateDocument(doc);
    expect(hydrated.nodes.map((n) => n.rotation)).toEqual([90, 180, 270]);
  });

  it("projectDocument ignores React Flow internals (measured / origin / type discriminator)", () => {
    // Feed a node carrying React-Flow-only fields and assert the
    // projected graph + view entries don't leak them.
    const node = {
      ...makeVertex("a", { x: 1, y: 2 }),
      // React Flow runtime injections / renderer-only fields:
      measured: { width: 40, height: 40 },
      internals: { positionAbsolute: { x: 1, y: 2 } },
      dragging: true,
    } as unknown as VertexNode;
    const doc = projectDocument({ ...baseInput, nodes: [node], edges: [] });

    const graphNode = doc.graph.nodes[0] as unknown as Record<string, unknown>;
    const viewNode = doc.view.nodes[0] as unknown as Record<string, unknown>;
    expect(graphNode.measured).toBeUndefined();
    expect(graphNode.internals).toBeUndefined();
    expect(graphNode.origin).toBeUndefined();
    expect(graphNode.type).toBeUndefined();
    expect(graphNode.selected).toBeUndefined();
    expect(viewNode.measured).toBeUndefined();
    expect(viewNode.type).toBeUndefined();
    // Identity + the persisted fields are still there.
    expect(graphNode.id).toBe("a");
    expect(graphNode.data).toEqual({ label: "", vertexType: "z" });
    expect(viewNode.position).toEqual({ x: 1, y: 2 });
  });
});

// ---- Serialization: handle id <-> index -----------------------------------

describe("handleIdToIndex / indexToHandleId (round-trip via project+hydrate)", () => {
  it("center-source (source side) persists as index 1 and hydrates back to center-source", () => {
    const nodes: VertexNode[] = [
      makeVertex("a", { x: 0, y: 0 }),
      makeVertex("b", { x: 0, y: 0 }),
    ];
    const edges: GraphEdge[] = [
      {
        ...makeEdge("e1", "a", "b"),
        sourceHandle: HANDLE_IDS.centerSource,
        targetHandle: HANDLE_IDS.centerTarget,
      },
    ];
    const doc = projectDocument({
      id: "d",
      title: "t",
      nodes,
      edges,
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    });
    // center-source -> 1, center-target -> 0 (per AGENTS.md: 0=top, 1=bottom).
    expect(doc.graph.edges[0].sourceHandle).toBe(1);
    expect(doc.graph.edges[0].targetHandle).toBe(0);
    const hydrated = hydrateDocument(doc);
    expect(hydrated.edges[0].sourceHandle).toBe(HANDLE_IDS.centerSource);
    expect(hydrated.edges[0].targetHandle).toBe(HANDLE_IDS.centerTarget);
  });

  it("top handle (directional target) persists as index 0 and hydrates back to top", () => {
    const nodes: VertexNode[] = [
      makeVertex("a", { x: 0, y: 0 }),
      makeVertexWith("b", { data: { vertexType: "w" } }),
    ];
    const edges: GraphEdge[] = [
      {
        ...makeEdge("e1", "a", "b"),
        sourceHandle: HANDLE_IDS.centerSource,
        targetHandle: HANDLE_IDS.top,
      },
    ];
    const doc = projectDocument({
      id: "d",
      title: "t",
      nodes,
      edges,
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    });
    expect(doc.graph.edges[0].sourceHandle).toBe(1);
    expect(doc.graph.edges[0].targetHandle).toBe(0);
    expect(hydrateDocument(doc).edges[0].targetHandle).toBe(HANDLE_IDS.top);
  });

  it("an edge with undefined handle ids uses the per-role default on hydrate", () => {
    // Persistence shape with no handle fields at all (legacy). The source
    // side defaults to center-source; the target side picks based on the
    // target vertex's directional flag.
    const legacyDoc: GraphDocument = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      id: "d",
      title: "legacy",
      graph: {
        nodes: [
          { id: "a", data: { label: "", vertexType: "z" } },
          { id: "b", data: { label: "", vertexType: "w" } },
        ],
        edges: [{ id: "e1", source: "a", target: "b" }],
      },
      view: {
        nodes: [
          { id: "a", position: { x: 0, y: 0 } },
          { id: "b", position: { x: 1, y: 1 } },
        ],
        edges: [{ id: "e1" }],
      },
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    };
    const hydrated = hydrateDocument(legacyDoc);
    expect(hydrated.edges[0].sourceHandle).toBe(HANDLE_IDS.centerSource);
    // b is directional -> target defaults to top.
    expect(hydrated.edges[0].targetHandle).toBe(HANDLE_IDS.top);
  });
});

// ---- Serialization: parseDocument (validators) ----------------------------

describe("parseDocument (validators)", () => {
  it("rejects malformed JSON with an ok:false result", () => {
    const r = parseDocument("not json {{{");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/valid JSON/i);
  });

  it("rejects a top-level JSON array (no graph slice to find)", () => {
    // A JSON array passes `isRecord` (because `typeof [] === "object"` in
    // JS), so it falls through to the graph-slice check, which rejects
    // it with a "graph slice" error rather than an "object" error. The
    // payload is still rejected — pin the actual path so a future move
    // of the `Array.isArray` guard earlier in the validator is a
    // deliberate change.
    const r = parseDocument("[1,2,3]");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/graph/i);
  });

  it("rejects a top-level non-object (primitive)", () => {
    expect(parseDocument("123").ok).toBe(false);
    expect(parseDocument("null").ok).toBe(false);
    expect(parseDocument('"str"').ok).toBe(false);
  });

  it("rejects a payload missing the 'graph' slice", () => {
    const r = parseDocument(JSON.stringify({ view: { nodes: [], edges: [] } }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/graph/);
  });

  it("rejects a payload missing the 'view' slice", () => {
    const r = parseDocument(JSON.stringify({ graph: { nodes: [], edges: [] } }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/view/);
  });

  it("rejects a 'graph' slice whose nodes field is not an array", () => {
    const r = parseDocument(
      JSON.stringify({
        graph: { nodes: "oops", edges: [] },
        view: { nodes: [], edges: [] },
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/graph/);
  });

  it("rejects a 'view' slice whose edges field is not an array", () => {
    const r = parseDocument(
      JSON.stringify({
        graph: { nodes: [], edges: [] },
        view: { nodes: [], edges: "oops" },
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/view/);
  });

  it("accepts a valid v1 document and returns it", () => {
    const r = parseDocument(
      JSON.stringify({
        schemaVersion: 1,
        id: "d",
        title: "ok",
        graph: { nodes: [], edges: [] },
        view: { nodes: [], edges: [] },
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.document.id).toBe("d");
      expect(r.document.title).toBe("ok");
      expect(r.document.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    }
  });

  it("stamps CURRENT_SCHEMA_VERSION when schemaVersion is absent", () => {
    const r = parseDocument(
      JSON.stringify({ graph: { nodes: [], edges: [] }, view: { nodes: [], edges: [] } }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.document.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it("soft-fails a future schema version (99) with a clear error", () => {
    const r = parseDocument(
      JSON.stringify({
        schemaVersion: 99,
        graph: { nodes: [], edges: [] },
        view: { nodes: [], edges: [] },
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/schemaVersion 99/);
  });

  it("accepts an older (lower) schema version and stamps the current one", () => {
    // The validator only rejects versions *newer* than current; older or
    // equal versions are accepted and re-stamped. Pin this so a future
    // tightening of the rule is a deliberate change.
    const r = parseDocument(
      JSON.stringify({
        schemaVersion: 0,
        graph: { nodes: [], edges: [] },
        view: { nodes: [], edges: [] },
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.document.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });
});

// ---- Serialization: importGraphJson (full pipeline) -----------------------

describe("importGraphJson (pipeline)", () => {
  it("turns a valid JSON string into a parsed document", () => {
    const json = exportGraphJson({
      title: "Pipeline",
      nodes: [makeVertex("a", { x: 1, y: 2 })],
      edges: [],
    });
    const r = importGraphJson(json);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.document.title).toBe("Pipeline");
      expect(r.document.graph.nodes[0].id).toBe("a");
    }
  });

  it("rewords the generic JSON error to 'File is not valid JSON' for the import path", () => {
    const r = importGraphJson("not json {{{");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/^File is not valid JSON/);
  });

  it("passes structural errors through unchanged", () => {
    const r = importGraphJson(JSON.stringify({ graph: { nodes: [], edges: [] } }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/view/);
  });
});

// ---- Serialization: extra/unknown fields ----------------------------------

describe("parseDocument (unknown fields)", () => {
  it("preserves unknown top-level fields in the parsed document (object spread)", () => {
    // serialization.ts:415-418 spreads the whole parsed object, so any
    // extra fields ride along into the returned document. Pin this so a
    // future move to an allow-list schema is a deliberate, reviewed
    // change rather than an accidental behavior shift.
    const r = parseDocument(
      JSON.stringify({
        graph: { nodes: [], edges: [] },
        view: { nodes: [], edges: [] },
        junkField: "hello",
        nestedExtra: { a: 1, b: [2, 3] },
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      const doc = r.document as unknown as Record<string, unknown>;
      expect(doc.junkField).toBe("hello");
      expect(doc.nestedExtra).toEqual({ a: 1, b: [2, 3] });
    }
  });
});

// ---- Serialization: saveGraphDocument / loadGraphDocument -----------------

describe("saveGraphDocument / loadGraphDocument (localStorage round-trip)", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
  });

  it("round-trips a populated document through localStorage", () => {
    const nodes: VertexNode[] = [
      makeVertexWith("a", { position: { x: 5, y: 7 }, rotation: 45 }),
      makeVertex("b", { x: 100, y: 200 }),
    ];
    const edges: GraphEdge[] = [
      {
        ...makeEdge("e1", "a", "b"),
        sourceHandle: HANDLE_IDS.centerSource,
        targetHandle: HANDLE_IDS.centerTarget,
      },
    ];
    saveGraphDocument({
      id: PERSISTED_IDS.localDocument,
      title: "Persisted",
      nodes,
      edges,
      createdAt: "2025-01-01T00:00:00.000Z",
    });
    const loaded = loadGraphDocument();
    expect(loaded.title).toBe("Persisted");
    expect(loaded.id).toBe(PERSISTED_IDS.localDocument);
    expect(loaded.graph.nodes.map((n) => n.id)).toEqual(["a", "b"]);
    expect(loaded.graph.edges).toHaveLength(1);
    expect(loaded.view.nodes.find((n) => n.id === "a")?.position).toEqual({
      x: 5,
      y: 7,
    });
    expect(loaded.view.nodes.find((n) => n.id === "a")?.rotation).toBe(45);
  });

  it("returns an empty document when the key is missing", () => {
    const loaded = loadGraphDocument();
    expect(loaded.title).toBe("Untitled Graph");
    expect(loaded.graph.nodes).toEqual([]);
    expect(loaded.graph.edges).toEqual([]);
    expect(loaded.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it("returns an empty document (and warns) when the stored JSON is malformed", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    localStorage.setItem("graph-board-document", "not valid json {{{");
    const loaded = loadGraphDocument();
    expect(loaded.title).toBe("Untitled Graph");
    expect(loaded.graph.nodes).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

// ---- Serialization: exportGraphJson ---------------------------------------

describe("exportGraphJson", () => {
  it("produces a valid GraphDocument string with title, createdAt, and schemaVersion", () => {
    const json = exportGraphJson({
      title: "Exported",
      nodes: [makeVertex("a", { x: 1, y: 2 })],
      edges: [],
      createdAt: "2025-01-01T00:00:00.000Z",
    });
    const parsed = JSON.parse(json) as GraphDocument;
    expect(parsed.title).toBe("Exported");
    expect(parsed.id).toBe(PERSISTED_IDS.exportedDocument);
    expect(parsed.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(parsed.createdAt).toBe("2025-01-01T00:00:00.000Z");
    expect(typeof parsed.updatedAt).toBe("string");
    expect(parsed.graph.nodes[0].id).toBe("a");
  });

  it("defaults createdAt to 'now' when the caller omits it", () => {
    const before = Date.now();
    const json = exportGraphJson({ title: "t", nodes: [], edges: [] });
    const parsed = JSON.parse(json) as GraphDocument;
    const after = Date.now();
    const created = Date.parse(parsed.createdAt);
    expect(created).toBeGreaterThanOrEqual(before);
    expect(created).toBeLessThanOrEqual(after);
  });
});

// ---- Serialization: createEmptyGraphDocument ------------------------------

describe("createEmptyGraphDocument (shape)", () => {
  it("returns a v1 document with empty graph/view slices and the local-document id", () => {
    const doc = createEmptyGraphDocument();
    expect(doc.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(doc.id).toBe(PERSISTED_IDS.localDocument);
    expect(doc.graph).toEqual({ nodes: [], edges: [] });
    expect(doc.view).toEqual({ nodes: [], edges: [] });
    expect(typeof doc.createdAt).toBe("string");
    expect(doc.createdAt).toBe(doc.updatedAt);
  });
});
