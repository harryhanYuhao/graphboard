// The persistence boundary. Bugs here corrupt saved graphs and break the WASM
// compute boundary, so coverage is broad: rotation normalization, the runtime
// ↔ persisted round trip, and the importer's failure modes. localStorage comes
// from jsdom; save/load are tested against it so the format round-trips cleanly.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createEmptyGraphDocument,
  exportGraphJson,
  hydrateDocument,
  importGraphJson,
  loadGraphDocument,
  normalizeRotation,
  projectDocument,
  saveGraphDocument,
} from "./serialization";
import {
  CURRENT_SCHEMA_VERSION,
  EDGE_TYPES,
  HANDLE_IDS,
  PERSISTED_IDS,
  type GraphDocument,
  type GraphEdge,
  type VertexNode,
} from "./types";
import { makeEdge, makeVertex } from "@/test-utils/factories";

describe("normalizeRotation", () => {
  it.each([
    [0, 0],
    [90, 90],
    [180, 180],
    [270, 270],
    [360, 0], // exact multiples collapse to 0
    [-90, 270],
    [-360, 0],
    [720, 0],
    [725, 5],
  ])("normalizes %f to %f", (input, expected) => {
    expect(normalizeRotation(input)).toBe(expected);
  });

  it("coerces non-finite values to 0", () => {
    // NaN would propagate through every comparison; the slider can't
    // produce it, but a corrupt persisted document can.
    expect(normalizeRotation(NaN)).toBe(0);
    expect(normalizeRotation(Infinity)).toBe(0);
    expect(normalizeRotation(-Infinity)).toBe(0);
  });

  it("rounds away float drift from modulo math", () => {
    // `%` on doubles leaves values like 270.00000000006; without rounding,
    // they accumulate across save/load cycles and flake equality checks.
    expect(normalizeRotation(-90.0000000001)).toBe(270);
    expect(normalizeRotation(360.0000000001)).toBe(0);
    expect(normalizeRotation(44.9999999999)).toBe(45);
  });
});

describe("projectDocument ↔ hydrateDocument", () => {
  const baseInput = {
    id: "doc-1",
    title: "Test graph",
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-02T00:00:00.000Z",
  };

  const baseNodes: VertexNode[] = [
    { ...makeVertex("a", { x: 0, y: 24 }), rotation: 45 },
    makeVertex("b", { x: 0, y: 0 }),
  ];

  const baseEdges: GraphEdge[] = [
    {
      ...makeEdge("e1", "a", "b"),
      sourceHandle: HANDLE_IDS.centerSource,
      targetHandle: HANDLE_IDS.centerTarget,
    },
    {
      ...makeEdge("e2", "b", "a"),
      sourceHandle: HANDLE_IDS.centerSource,
      targetHandle: HANDLE_IDS.top,
    },
  ];

  it("stamps the current schema version on projection", () => {
    const doc = projectDocument({
      ...baseInput,
      nodes: baseNodes,
      edges: baseEdges,
    });
    expect(doc.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it("splits runtime nodes into graph + view entries", () => {
    const doc = projectDocument({
      ...baseInput,
      nodes: baseNodes,
      edges: baseEdges,
    });
    expect(doc.graph.nodes.map((n) => n.id)).toEqual(["a", "b"]);
    expect(doc.view.nodes.map((n) => n.id).sort()).toEqual(["a", "b"]);
    // rotation lives in the view slice; the graph entry carries identity
    // + label + vertex type only.
    const graphA = doc.graph.nodes.find((n) => n.id === "a");
    expect(graphA?.data).toEqual({ label: "", vertexType: "z" });
    expect((graphA as unknown as { rotation?: number }).rotation).toBeUndefined();
    const viewA = doc.view.nodes.find((n) => n.id === "a");
    expect(viewA?.rotation).toBe(45);
  });

  it("normalizes rotation on the way out", () => {
    const nodes = [
      { ...makeVertex("a", { x: 0, y: 0 }), rotation: 720 },
      { ...makeVertex("b", { x: 0, y: 0 }), rotation: -90 },
    ];
    const doc = projectDocument({
      ...baseInput,
      nodes,
      edges: [],
    });
    expect(doc.view.nodes.find((n) => n.id === "a")?.rotation).toBe(0);
    expect(doc.view.nodes.find((n) => n.id === "b")?.rotation).toBe(270);
  });

  it("translates runtime handle ids to numeric indices on the way out", () => {
    const doc = projectDocument({
      ...baseInput,
      nodes: baseNodes,
      edges: baseEdges,
    });
    // centerSource → index 1, other handles → index 0.
    expect(doc.graph.edges[0].sourceHandle).toBe(1);
    expect(doc.graph.edges[0].targetHandle).toBe(0);
    expect(doc.graph.edges[1].targetHandle).toBe(0);
  });

  it("round-trips node positions, labels, and edge endpoints", () => {
    const doc = projectDocument({
      ...baseInput,
      nodes: baseNodes,
      edges: baseEdges,
    });
    const hydrated = hydrateDocument(doc);
    expect(hydrated.title).toBe(baseInput.title);
    expect(hydrated.nodes.map((n) => n.position)).toEqual([
      { x: 0, y: 24 },
      { x: 0, y: 0 },
    ]);
    expect(hydrated.nodes.map((n) => n.data.label)).toEqual(["", ""]);
    expect(hydrated.edges.map((e) => `${e.source}->${e.target}`)).toEqual([
      "a->b",
      "b->a",
    ]);
  });

  it("strips the ephemeral `selected` field (pre-v1 persistence bug)", () => {
    // The graph/view split drops `selected` on hydration so loaded graphs
    // start with nothing selected.
    const nodes = [
      { ...makeVertex("a", { x: 0, y: 0 }), selected: true },
    ];
    const doc = projectDocument({
      ...baseInput,
      nodes,
      edges: [],
    });
    // `selected` is not part of the persisted shape.
    expect((doc.graph.nodes[0] as unknown as { selected?: boolean }).selected).toBeUndefined();
    const hydrated = hydrateDocument(doc);
    expect(hydrated.nodes[0].selected).toBeUndefined();
    expect(hydrated.nodes[0].type).toBe("vertex");
  });

  it("round-trips rotation through projection and hydration", () => {
    const nodes = [
      { ...makeVertex("a", { x: 0, y: 0 }), rotation: 137 },
    ];
    const doc = projectDocument({
      ...baseInput,
      nodes,
      edges: [],
    });
    const hydrated = hydrateDocument(doc);
    expect(hydrated.nodes[0].rotation).toBe(137);
  });

  it("defaults rotation to 0 when the view entry is missing", () => {
    // Pre-rotation documents hydrate cleanly without losing data.
    const doc: GraphDocument = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      id: "doc-1",
      title: "Pre-rotation doc",
      graph: {
        nodes: [{ id: "a", data: { label: "", vertexType: "z" } }],
        edges: [],
      },
      view: { nodes: [{ id: "a", position: { x: 1, y: 2 } }], edges: [] },
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    };
    const hydrated = hydrateDocument(doc);
    expect(hydrated.nodes[0].rotation).toBe(0);
    // The {1,2} disk position snaps to {0,0} on hydrate.
    expect(hydrated.nodes[0].position).toEqual({ x: 0, y: 0 });
  });

  it("snaps non-aligned disk positions to the grid on hydrate (migration)", () => {
    // An old document written before snap-to-grid can carry arbitrary float
    // positions; loading it should bring every vertex onto the lattice.
    const doc: GraphDocument = {
      schemaVersion: 1,
      id: "local-document",
      title: "Legacy",
      graph: {
        nodes: [
          { id: "a", data: { label: "", vertexType: "z" } },
          { id: "b", data: { label: "", vertexType: "z" } },
        ],
        edges: [],
      },
      view: {
        nodes: [
          { id: "a", position: { x: 11, y: 13 } },
          { id: "b", position: { x: 50, y: -36 } },
        ],
        edges: [],
      },
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    };
    const hydrated = hydrateDocument(doc);
    expect(hydrated.nodes.map((n) => n.position)).toEqual([
      { x: 0, y: 24 },
      { x: 48, y: -24 },
    ]);
  });

  it("restores directional 'top' handle on hydrate (W / And target)", () => {
    const doc = projectDocument({
      ...baseInput,
      nodes: [
        makeVertex("a", { x: 0, y: 0 }),
        {
          ...makeVertex("b", { x: 0, y: 0 }),
          data: { label: "", vertexType: "w" },
        },
      ],
      edges: [
        {
          ...makeEdge("e1", "a", "b"),
          sourceHandle: HANDLE_IDS.centerSource,
          targetHandle: HANDLE_IDS.top,
        },
      ],
    });
    const hydrated = hydrateDocument(doc);
    expect(hydrated.edges[0].targetHandle).toBe(HANDLE_IDS.top);
  });

  it("uses EDGE_TYPES.straightCenter as the runtime edge type", () => {
    const doc = projectDocument({
      ...baseInput,
      nodes: baseNodes,
      edges: baseEdges,
    });
    const hydrated = hydrateDocument(doc);
    expect(hydrated.edges.every((e) => e.type === EDGE_TYPES.straightCenter)).toBe(
      true,
    );
  });
});

describe("createEmptyGraphDocument", () => {
  it("returns a v1-shape empty document", () => {
    const doc = createEmptyGraphDocument();
    expect(doc.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(doc.id).toBe(PERSISTED_IDS.localDocument);
    expect(doc.title).toBe("Untitled Graph");
    expect(doc.graph).toEqual({ nodes: [], edges: [] });
    expect(doc.view).toEqual({ nodes: [], edges: [] });
    expect(typeof doc.createdAt).toBe("string");
    expect(doc.createdAt).toBe(doc.updatedAt);
  });
});

describe("saveGraphDocument / loadGraphDocument (localStorage)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("round-trips a populated document through localStorage", () => {
    const nodes = [
      { ...makeVertex("a", { x: 5, y: 7 }), rotation: 90 },
      makeVertex("b", { x: 100, y: 200 }),
    ];
    const edges = [makeEdge("e1", "a", "b")];

    saveGraphDocument({
      id: PERSISTED_IDS.localDocument,
      title: "Persisted",
      nodes,
      edges,
      createdAt: "2025-01-01T00:00:00.000Z",
    });

    const loaded = loadGraphDocument();
    expect(loaded.title).toBe("Persisted");
    expect(loaded.graph.nodes.map((n) => n.id)).toEqual(["a", "b"]);
    expect(loaded.graph.edges).toHaveLength(1);
    expect(loaded.view.nodes.find((n) => n.id === "a")?.position).toEqual({
      x: 5,
      y: 7,
    });
  });

  it("returns an empty document when nothing is stored", () => {
    const loaded = loadGraphDocument();
    expect(loaded.title).toBe("Untitled Graph");
    expect(loaded.graph.nodes).toEqual([]);
  });

  it("returns an empty document when the stored JSON is malformed", () => {
    localStorage.setItem("graph-board-document", "not valid json {{{");
    expect(loadGraphDocument().title).toBe("Untitled Graph");
  });

  it("warns and returns empty when the stored document is from a future schema", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const futureDoc = {
      ...createEmptyGraphDocument(),
      schemaVersion: CURRENT_SCHEMA_VERSION + 1,
    };
    localStorage.setItem("graph-board-document", JSON.stringify(futureDoc));

    expect(loadGraphDocument().title).toBe("Untitled Graph");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("is a no-op under SSR (typeof window === 'undefined')", () => {
    // jsdom can't undefine window; just check the save+load pair runs.
    saveGraphDocument({
      id: PERSISTED_IDS.localDocument,
      title: "ok",
      nodes: [],
      edges: [],
      createdAt: new Date().toISOString(),
    });
    expect(loadGraphDocument().title).toBe("ok");
  });

  it("fails soft on a structurally-corrupt document instead of throwing", () => {
    // A graph slice missing its `nodes` array must fall back to an empty
    // document, not crash hydrate with "nodes.map is not a function".
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    localStorage.setItem(
      "graph-board-document",
      JSON.stringify({
        schemaVersion: 1,
        graph: { nodes: "oops", edges: [] },
        view: { nodes: [], edges: [] },
      }),
    );

    expect(() => loadGraphDocument()).not.toThrow();
    expect(loadGraphDocument().title).toBe("Untitled Graph");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("exportGraphJson / importGraphJson", () => {
  it("produces a parseable JSON string with the exported-document id", () => {
    const json = exportGraphJson({
      title: "Exported",
      nodes: [makeVertex("a", { x: 1, y: 2 })],
      edges: [],
    });
    const parsed = JSON.parse(json);
    expect(parsed.id).toBe(PERSISTED_IDS.exportedDocument);
    expect(parsed.title).toBe("Exported");
  });

  it("imports a valid exported document", () => {
    const json = exportGraphJson({
      title: "Round-trip",
      nodes: [makeVertex("a", { x: 5, y: 5 })],
      edges: [],
    });
    const result = importGraphJson(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.document.title).toBe("Round-trip");
      expect(result.document.graph.nodes[0].id).toBe("a");
    }
  });

  it("rejects non-JSON content", () => {
    const result = importGraphJson("not json {{{");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/valid JSON/i);
    }
  });

  it("rejects a top-level non-object", () => {
    expect(importGraphJson("123").ok).toBe(false);
    expect(importGraphJson("null").ok).toBe(false);
    expect(importGraphJson('"a string"').ok).toBe(false);
  });

  it("rejects a document missing the 'graph' slice", () => {
    const result = importGraphJson(
      JSON.stringify({ view: { nodes: [], edges: [] }, id: "x" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/graph/);
    }
  });

  it("rejects a document missing the 'view' slice", () => {
    const result = importGraphJson(
      JSON.stringify({ graph: { nodes: [], edges: [] }, id: "x" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/view/);
    }
  });

  it("rejects a 'graph' slice whose nodes/edges aren't arrays", () => {
    // Pins the import-path validation for the load-path shape check.
    const result = importGraphJson(
      JSON.stringify({
        graph: { nodes: "not-an-array", edges: [] },
        view: { nodes: [], edges: [] },
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/graph/);
    }
  });

  it("rejects a document from a future schema version", () => {
    const future = {
      ...createEmptyGraphDocument(),
      schemaVersion: CURRENT_SCHEMA_VERSION + 1,
    };
    const result = importGraphJson(JSON.stringify(future));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/schemaVersion/);
    }
  });

  it("stamps CURRENT_SCHEMA_VERSION when the field is absent", () => {
    const noVersion = JSON.stringify({
      id: "x",
      title: "no-version",
      graph: { nodes: [], edges: [] },
      view: { nodes: [], edges: [] },
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    });
    const result = importGraphJson(noVersion);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.document.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    }
  });

  // Trust boundary: the validator only checks the structural shape (graph/view
  // slices with arrays). Other fields (id / title / createdAt / updatedAt) are
  // NOT validated — missing ones are `undefined` on the returned object. Call
  // sites always supply all fields, so this is pinned, not repaired.
  it("accepts a document with `graph`/`view` slices but missing other required fields", () => {
    const minimal = JSON.stringify({
      graph: { nodes: [], edges: [] },
      view: { nodes: [], edges: [] },
    });
    const result = importGraphJson(minimal);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Missing fields are `undefined`.
      expect(result.document.id).toBeUndefined();
      expect(result.document.title).toBeUndefined();
      expect(result.document.createdAt).toBeUndefined();
      expect(result.document.updatedAt).toBeUndefined();
    }
  });

  it("accepts a document with `graph`/`view` slices but with extra top-level fields", () => {
    // The validator spreads the parsed object, so extra fields ride along —
    // useful for forward-compat (a tool adding a field this version ignores).
    const extra = JSON.stringify({
      id: "x",
      title: "extra-fields",
      graph: { nodes: [], edges: [] },
      view: { nodes: [], edges: [] },
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
      tags: ["research", "wip"],
      author: "alice",
    });
    const result = importGraphJson(extra);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const doc = result.document as unknown as Record<string, unknown>;
      expect(doc.tags).toEqual(["research", "wip"]);
      expect(doc.author).toBe("alice");
    }
  });

  it("accepts a document with `graph`/`view` slices but with extra fields in the slices", () => {
    // Same trust-boundary pin: extra fields inside graph/view ride along
    // (hydration only reads the documented fields).
    const extra = JSON.stringify({
      id: "x",
      title: "extra-slice-fields",
      graph: {
        nodes: [],
        edges: [],
        metadata: { author: "alice", version: 2 },
      },
      view: {
        nodes: [],
        edges: [],
        customFlags: { grid: true },
      },
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    });
    const result = importGraphJson(extra);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const graph = result.document.graph as unknown as Record<string, unknown>;
      const view = result.document.view as unknown as Record<string, unknown>;
      expect(graph.metadata).toEqual({ author: "alice", version: 2 });
      expect(view.customFlags).toEqual({ grid: true });
    }
  });
});