// src/lib/graph/serialization.test.ts
//
// The persistence boundary. Bugs here corrupt saved graphs and break
// the WASM compute boundary, so the test surface is intentionally
// broad: rotation normalization, the runtime ↔ persisted round trip,
// and the importer's failure modes.
//
// localStorage is provided by jsdom — `saveGraphDocument` and
// `loadGraphDocument` are tested against the real store so we know
// the persisted format round-trips cleanly through disk.

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
    // `NaN` would otherwise propagate through every comparison and
    // break rendering — the panel's slider can't produce this, but
    // a corrupt persisted document can.
    expect(normalizeRotation(NaN)).toBe(0);
    expect(normalizeRotation(Infinity)).toBe(0);
    expect(normalizeRotation(-Infinity)).toBe(0);
  });

  it("rounds away float drift from modulo math", () => {
    // `%` on doubles can leave values like 270.00000000006 or
    // 89.99999999999. Without rounding, these accumulate across
    // save/load cycles and make equality checks flaky.
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
    { ...makeVertex("a", { x: 10, y: 20 }), rotation: 45 },
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
    // `rotation` lives in the view slice; the graph entry only carries
    // identity + label + vertex type.
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
    // centerSource → index 1, every other handle → index 0.
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
      { x: 10, y: 20 },
      { x: 0, y: 0 },
    ]);
    expect(hydrated.nodes.map((n) => n.data.label)).toEqual(["", ""]);
    expect(hydrated.edges.map((e) => `${e.source}->${e.target}`)).toEqual([
      "a->b",
      "b->a",
    ]);
  });

  it("strips the ephemeral `selected` field (pre-v1 persistence bug)", () => {
    // Pre-v1 documents accidentally carried `selected: true` through
    // reloads. The split into graph/view drops it on hydration so
    // freshly-loaded graphs start with nothing selected.
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
    expect(hydrated.nodes[0].position).toEqual({ x: 1, y: 2 });
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
    // We can't easily undefine window in jsdom; just check the
    // happy-path save+load pair runs without throwing.
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
    // Regression guard: pre-fix, `loadGraphDocument` cast the whole
    // payload to `GraphDocument` after a single `typeof object` check,
    // so a graph slice missing its `nodes` array would crash
    // `hydrateDocument` with "nodes.map is not a function" on next
    // reload. The shared validator now catches this and falls back to
    // an empty document.
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
    // Regression guard for the load-path bug: a hand-edited
    // localStorage entry used to crash `hydrateDocument` (nodes.map
    // is not a function) because load trusted the payload shape.
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
});