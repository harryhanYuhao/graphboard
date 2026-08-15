// Tests for the tabs-workspace persistence layer: `parseWorkspace`
// (wrapper + legacy payloads), `saveGraphWorkspace` / `loadGraphWorkspace`,
// and the v2-only import boundary. The wrapper is a storage layout around
// v2 documents — the document schema itself never changes.

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createEmptyGraphDocument,
  importGraphJson,
  loadGraphWorkspace,
  parseWorkspace,
  saveGraphWorkspace,
} from "./index";
import { CURRENT_SCHEMA_VERSION, PERSISTED_IDS } from "../graph/types";

function makeDoc(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 2,
    id: "doc-1",
    title: "Tab A",
    graph: { nodes: [], edges: [] },
    view: { nodes: [], edges: [] },
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeWrapper(overrides: Record<string, unknown> = {}) {
  return {
    layout: "tabs",
    activeTabId: "t1",
    tabs: [
      { id: "t1", document: makeDoc({ id: "t1", title: "One" }) },
      { id: "t2", document: makeDoc({ id: "t2", title: "Two" }) },
    ],
    ...overrides,
  };
}

describe("parseWorkspace — legacy single-doc payloads", () => {
  it("loads a v2 document as a one-tab workspace keyed by the doc id", () => {
    const result = parseWorkspace(JSON.stringify(makeDoc()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.workspace.activeTabId).toBe("doc-1");
    expect(result.workspace.tabs).toHaveLength(1);
    expect(result.workspace.tabs[0].document.title).toBe("Tab A");
  });

  it("migrates a v1 document inside its tab (phase rename)", () => {
    const v1 = makeDoc({
      schemaVersion: 1,
      graph: {
        nodes: [{ id: "x", data: { label: "pi", vertexType: "z" } }],
        edges: [],
      },
    });
    const result = parseWorkspace(JSON.stringify(v1));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const node = result.workspace.tabs[0].document.graph.nodes[0];
    expect(node.data.phase).toBe("pi");
    expect(result.workspace.tabs[0].document.schemaVersion).toBe(
      CURRENT_SCHEMA_VERSION,
    );
  });

  it("falls back to the local-document id when a legacy doc id is missing", () => {
    const result = parseWorkspace(
      JSON.stringify({ ...makeDoc(), id: undefined }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.workspace.tabs[0].id).toBe(PERSISTED_IDS.localDocument);
  });
});

describe("parseWorkspace — tabs wrapper", () => {
  it("parses every tab's document and keeps the active tab id", () => {
    const result = parseWorkspace(JSON.stringify(makeWrapper()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.workspace.tabs.map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(result.workspace.tabs[1].document.title).toBe("Two");
    expect(result.workspace.activeTabId).toBe("t1");
  });

  it("falls back to the first tab when activeTabId is unknown", () => {
    const result = parseWorkspace(
      JSON.stringify(makeWrapper({ activeTabId: "missing" })),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.workspace.activeTabId).toBe("t1");
  });

  it("rejects an empty tabs array", () => {
    const result = parseWorkspace(
      JSON.stringify(makeWrapper({ tabs: [] })),
    );
    expect(result.ok).toBe(false);
  });

  it("rejects duplicate tab ids", () => {
    const dup = makeWrapper({
      tabs: [
        { id: "t1", document: makeDoc() },
        { id: "t1", document: makeDoc() },
      ],
    });
    const result = parseWorkspace(JSON.stringify(dup));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("Duplicate tab id");
  });

  it("rejects tabs missing a string id", () => {
    const result = parseWorkspace(
      JSON.stringify(makeWrapper({ tabs: [{ document: makeDoc() }] })),
    );
    expect(result.ok).toBe(false);
  });

  it("rejects a corrupt embedded document and names the offending tab", () => {
    const corrupt = makeWrapper({
      tabs: [{ id: "t1", document: { not: "a doc" } }],
    });
    const result = parseWorkspace(JSON.stringify(corrupt));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("Tab 't1'");
  });

  it("rejects a future-schema embedded document", () => {
    const future = makeWrapper({
      tabs: [
        {
          id: "t1",
          document: makeDoc({ schemaVersion: CURRENT_SCHEMA_VERSION + 1 }),
        },
      ],
    });
    const result = parseWorkspace(JSON.stringify(future));
    expect(result.ok).toBe(false);
  });

  it("rejects non-JSON and non-object payloads", () => {
    expect(parseWorkspace("{not json").ok).toBe(false);
    expect(parseWorkspace("[1,2,3]").ok).toBe(false);
  });
});

describe("saveGraphWorkspace / loadGraphWorkspace (localStorage)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("round-trips a multi-tab workspace", () => {
    saveGraphWorkspace({
      activeTabId: "t2",
      tabs: [
        { id: "t1", document: makeDoc({ id: "t1", title: "One" }) },
        { id: "t2", document: makeDoc({ id: "t2", title: "Two" }) },
      ],
    });

    const loaded = loadGraphWorkspace();
    expect(loaded.activeTabId).toBe("t2");
    expect(loaded.tabs.map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(loaded.tabs[1].document.title).toBe("Two");
  });

  it("writes the layout discriminator so legacy readers can detect it", () => {
    saveGraphWorkspace({
      activeTabId: "t1",
      tabs: [{ id: "t1", document: makeDoc({ id: "t1" }) }],
    });
    const raw = JSON.parse(localStorage.getItem("graph-board-document")!);
    expect(raw.layout).toBe("tabs");
  });

  it("returns a one-tab empty workspace when nothing is stored", () => {
    const loaded = loadGraphWorkspace();
    expect(loaded.tabs).toHaveLength(1);
    expect(loaded.tabs[0].document.title).toBe("Untitled Graph");
    expect(loaded.tabs[0].document.graph.nodes).toEqual([]);
    expect(loaded.activeTabId).toBe(loaded.tabs[0].id);
  });

  it("loads a legacy single document as a one-tab workspace", () => {
    localStorage.setItem("graph-board-document", JSON.stringify(makeDoc()));
    const loaded = loadGraphWorkspace();
    expect(loaded.tabs).toHaveLength(1);
    expect(loaded.activeTabId).toBe("doc-1");
    expect(loaded.tabs[0].document.title).toBe("Tab A");
  });

  it("warns, backs up, and falls back to empty on a malformed payload", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const garbage = "{not-json!!!";
    localStorage.setItem("graph-board-document", garbage);

    const loaded = loadGraphWorkspace();

    expect(loaded.tabs).toHaveLength(1);
    expect(loaded.tabs[0].document.graph.nodes).toEqual([]);
    expect(localStorage.getItem("graph-board-document-backup")).toBe(garbage);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("import boundary stays v2-only", () => {
  it("importGraphJson rejects a tabs wrapper (import = one graph, not a workspace)", () => {
    const result = importGraphJson(JSON.stringify(makeWrapper()));
    expect(result.ok).toBe(false);
  });

  it("importGraphJson still accepts a plain v2 document", () => {
    const result = importGraphJson(JSON.stringify(makeDoc()));
    expect(result.ok).toBe(true);
  });
});

describe("createEmptyGraphDocument title parameter", () => {
  it("defaults to 'Untitled Graph' and accepts a custom title", () => {
    expect(createEmptyGraphDocument().title).toBe("Untitled Graph");
    expect(createEmptyGraphDocument("Tab 3").title).toBe("Tab 3");
  });
});
