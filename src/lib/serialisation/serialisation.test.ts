// The persistence boundary (`src/lib/serialisation/`). Bugs here corrupt saved
// graphs and break the WASM compute boundary, so coverage is broad: rotation
// normalization, the runtime ↔ persisted round trip, and the importer's
// failure modes. localStorage comes from jsdom; save/load are tested against
// it so the format round-trips cleanly.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
} from "./index";
import {
  CURRENT_SCHEMA_VERSION,
  DEFAULT_LABEL_LOCATION,
  EDGE_TYPES,
  HANDLE_IDS,
  PERSISTED_IDS,
  type GraphDocument,
  type GraphEdge,
  type VertexNode,
} from "../graph/types";
import { makeEdge, makeEdgeWith, makeVertex } from "@/test-utils/factories";

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
    expect(graphA?.data).toEqual({ phase: "", vertexType: "z" });
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
      { x: 12, y: 36 },
      { x: 12, y: 12 },
    ]);
    expect(hydrated.nodes.map((n) => n.data.phase)).toEqual(["", ""]);
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

  it("round-trips the visual label + labelLocation through the view slice", () => {
    const nodes: VertexNode[] = [
      {
        ...makeVertex("a", { x: 0, y: 0 }),
        label: "$\\alpha$",
        labelLocation: "left",
      },
      makeVertex("b", { x: 0, y: 0 }),
    ];
    const doc = projectDocument({
      ...baseInput,
      nodes,
      edges: [],
    });
    const viewA = doc.view.nodes.find((n) => n.id === "a");
    expect(viewA?.label).toBe("$\\alpha$");
    expect(viewA?.labelLocation).toBe("left");
    // The visual label is view-only: the graph slice (compute boundary)
    // must never see it.
    expect(
      (doc.graph.nodes[0].data as unknown as { label?: string }).label,
    ).toBeUndefined();
    const hydrated = hydrateDocument(doc);
    expect(hydrated.nodes[0].label).toBe("$\\alpha$");
    expect(hydrated.nodes[0].labelLocation).toBe("left");
  });

  it("defaults label '' and labelLocation 'top' when the view entry omits them", () => {
    const doc: GraphDocument = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      id: "doc-1",
      title: "Pre-label doc",
      graph: {
        nodes: [{ id: "a", data: { phase: "", vertexType: "z" } }],
        edges: [],
      },
      view: { nodes: [{ id: "a", position: { x: 0, y: 0 } }], edges: [] },
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    };
    const hydrated = hydrateDocument(doc);
    expect(hydrated.nodes[0].label).toBe("");
    expect(hydrated.nodes[0].labelLocation).toBe(DEFAULT_LABEL_LOCATION);
  });

  it("coerces non-string label/phase from a crafted doc instead of crashing", () => {
    // parse only checks array-ness, so a hand-edited file can carry a
    // non-string label/phase; hydration must degrade it to "" rather than
    // let renderLabel's `.trim()` / the phase parser crash the editor.
    const doc: GraphDocument = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      id: "doc-1",
      title: "Crafted",
      graph: {
        nodes: [
          { id: "a", data: { phase: 123, vertexType: "z" } as never },
        ],
        edges: [],
      },
      view: {
        nodes: [
          { id: "a", position: { x: 0, y: 0 }, label: {} as never },
        ],
        edges: [],
      },
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    };
    const hydrated = hydrateDocument(doc);
    expect(hydrated.nodes[0].label).toBe("");
    expect(hydrated.nodes[0].data.phase).toBe("");
  });

  it("defaults rotation to 0 when the view entry is missing", () => {
    // Pre-rotation documents hydrate cleanly without losing data.
    const doc: GraphDocument = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      id: "doc-1",
      title: "Pre-rotation doc",
      graph: {
        nodes: [{ id: "a", data: { phase: "", vertexType: "z" } }],
        edges: [],
      },
      view: { nodes: [{ id: "a", position: { x: 1, y: 2 } }], edges: [] },
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    };
    const hydrated = hydrateDocument(doc);
    expect(hydrated.nodes[0].rotation).toBe(0);
    // The {1,2} disk position snaps to the first dot {12,12} on hydrate.
    expect(hydrated.nodes[0].position).toEqual({ x: 12, y: 12 });
  });

  it("snaps non-aligned disk positions to the dots on hydrate (migration)", () => {
    // An old document written before snap-to-grid can carry arbitrary float
    // positions; loading it should bring every vertex onto a dot. Dots sit
    // at GRID_SIZE/2 + k·GRID_SIZE (positions are top-left corners, so the
    // GRID_SIZE/2 offset centers the body on a dot).
    const doc: GraphDocument = {
      schemaVersion: 1,
      id: "local-document",
      title: "Legacy",
      graph: {
        nodes: [
          { id: "a", data: { phase: "", vertexType: "z" } },
          { id: "b", data: { phase: "", vertexType: "z" } },
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
    // {11,13} → nearest dot {12,12}; {50,-36} → {60,-36} (50 is closest to
    // the dot at 60, -36 is a dot itself).
    expect(hydrated.nodes.map((n) => n.position)).toEqual([
      { x: 12, y: 12 },
      { x: 60, y: -36 },
    ]);
  });

  it("restores directional 'top' handle on hydrate (W / And target)", () => {
    const doc = projectDocument({
      ...baseInput,
      nodes: [
        makeVertex("a", { x: 0, y: 0 }),
        {
          ...makeVertex("b", { x: 0, y: 0 }),
          data: { phase: "", vertexType: "w" },
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

describe("edge kinds (project/hydrate)", () => {
  const baseInput = {
    id: "doc-1",
    title: "t",
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-02T00:00:00.000Z",
  };

  it("projects data.kind into the graph slice (default when absent at runtime)", () => {
    const doc = projectDocument({
      ...baseInput,
      nodes: [makeVertex("a"), makeVertex("b")],
      edges: [
        makeEdge("e1", "a", "b"),
        makeEdgeWith("e2", "a", "b", { kind: "dashed_blue" }),
      ],
    });
    expect(doc.graph.edges[0].data).toEqual({ kind: "default" });
    expect(doc.graph.edges[1].data).toEqual({ kind: "dashed_blue" });
  });

  it("hydrates the kind back — dashed-blue round-trips", () => {
    const doc = projectDocument({
      ...baseInput,
      nodes: [makeVertex("a"), makeVertex("b")],
      edges: [makeEdgeWith("e1", "a", "b", { kind: "dashed_blue" })],
    });
    const hydrated = hydrateDocument(doc);
    expect(hydrated.edges[0]?.data?.kind).toBe("dashed_blue");
  });

  it("defaults the kind for legacy edge records (no data field)", () => {
    const doc = projectDocument({
      ...baseInput,
      nodes: [makeVertex("a"), makeVertex("b")],
      edges: [makeEdge("e1", "a", "b")],
    });
    // Strip `data` to simulate a pre-kind save.
    delete doc.graph.edges[0]!.data;
    const hydrated = hydrateDocument(doc);
    expect(hydrated.edges[0]?.data?.kind).toBe("default");
  });

  it("coerces crafted/unknown kinds to the default at hydration", () => {
    const doc = projectDocument({
      ...baseInput,
      nodes: [makeVertex("a"), makeVertex("b")],
      edges: [makeEdge("e1", "a", "b")],
    });
    doc.graph.edges[0]!.data = { kind: "invisible" as never };
    const hydrated = hydrateDocument(doc);
    expect(hydrated.edges[0]?.data?.kind).toBe("default");
  });
});

describe("parseDocument — v1 → v2 migration", () => {
  it("migrates data.label to data.phase and stamps schemaVersion 2", () => {
    const v1Doc = {
      schemaVersion: 1,
      id: "local-document",
      title: "Legacy v1",
      graph: {
        nodes: [
          { id: "a", data: { label: "\\pi", vertexType: "z" } },
          {
            id: "b",
            data: { label: "", vertexType: "output", order: 2 },
          },
        ],
        edges: [],
      },
      view: { nodes: [], edges: [] },
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    };

    const result = parseDocument(JSON.stringify(v1Doc));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(result.document.graph.nodes.map((n) => n.data)).toEqual([
      { phase: "\\pi", vertexType: "z" },
      // Boundary `order` survives the rename — it drives the tensor's axis
      // order, so silently dropping it would change compute results.
      { phase: "", vertexType: "output", order: 2 },
    ]);
    // A migrated doc hydrates normally.
    const hydrated = hydrateDocument(result.document);
    expect(hydrated.nodes.map((n) => n.data.phase)).toEqual(["\\pi", ""]);
  });

  it("keeps data.phase when a v2 doc already carries it", () => {
    const v2Doc = {
      schemaVersion: 2,
      id: "local-document",
      title: "Current",
      graph: {
        nodes: [{ id: "a", data: { phase: "\\pi/2", vertexType: "z" } }],
        edges: [],
      },
      view: { nodes: [], edges: [] },
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    };
    const result = parseDocument(JSON.stringify(v2Doc));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.graph.nodes[0].data.phase).toBe("\\pi/2");
  });

  it("passes malformed nodes through untouched so hydration still fails loudly", () => {
    // Element-shape validation happens at hydration; the migration must not
    // throw inside parseDocument (load/import catch hydration errors, not
    // parse errors).
    const v1Doc = {
      schemaVersion: 1,
      id: "local-document",
      title: "Broken",
      graph: { nodes: [null], edges: [] },
      view: { nodes: [], edges: [] },
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    };
    const result = parseDocument(JSON.stringify(v1Doc));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(() => hydrateDocument(result.document)).toThrow();
  });
});

describe("createEmptyGraphDocument", () => {
  it("returns a v2-shape empty document", () => {
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

  it("saves mean-centered positions", () => {
    const json = exportGraphJson({
      title: "Centered",
      nodes: [
        makeVertex("a", { x: 12, y: 12 }),
        makeVertex("b", { x: 36, y: 60 }),
      ],
      edges: [],
    });
    const parsed = JSON.parse(json) as {
      view: { nodes: { position: { x: number; y: number } }[] };
    };
    // Mean is (24, 36); positions are saved relative to it.
    expect(parsed.view.nodes.map((n) => n.position)).toEqual([
      { x: -12, y: -24 },
      { x: 12, y: 24 },
    ]);
  });

  it("does not mutate the input nodes", () => {
    const nodes = [
      makeVertex("a", { x: 12, y: 12 }),
      makeVertex("b", { x: 36, y: 60 }),
    ];
    exportGraphJson({ title: "t", nodes, edges: [] });
    expect(nodes.map((n) => n.position)).toEqual([
      { x: 12, y: 12 },
      { x: 36, y: 60 },
    ]);
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
describe("loadGraphDocument — parse-fail backup", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("backs up the raw document before falling back to empty on parse failure", () => {
    // Non-JSON garbage: parseDocument fails, so the load returns the empty
    // doc — but the raw contents must be preserved first, because the empty
    // fallback is autosaved ~2s later and would otherwise destroy the only
    // copy.
    const garbage = "{not-json!!!";
    localStorage.setItem("graph-board-document", garbage);

    const doc = loadGraphDocument();

    expect(doc.graph.nodes).toEqual([]);
    expect(doc.title).toBe("Untitled Graph");
    expect(localStorage.getItem("graph-board-document-backup")).toBe(garbage);
  });

  it("does not write a backup when the document parses fine", () => {
    const good = JSON.stringify({
      schemaVersion: 2,
      id: "local-document",
      title: "Good",
      graph: { nodes: [], edges: [] },
      view: { nodes: [], edges: [] },
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    });
    localStorage.setItem("graph-board-document", good);

    loadGraphDocument();

    expect(localStorage.getItem("graph-board-document-backup")).toBeNull();
  });
});
