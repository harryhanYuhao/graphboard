// src/store/selectors.test.ts
//
// Pure-function tests for the store selectors. These are tiny and
// trivial in isolation, but they're called by both the store and the
// keyboard hook — keeping them under test means a future refactor of
// either call site doesn't have to re-derive the contract from
// inspection.

import { describe, expect, it } from "vitest";
import { hasSelection, nodesById, selectSelectedNodeIds } from "./selectors";
import { makeEdge, makeVertex } from "@/test-utils/factories";

describe("selectSelectedNodeIds", () => {
  it("returns the ids of every selected node, in document order", () => {
    const nodes = [
      makeVertex("a", { x: 0, y: 0 }, true),
      makeVertex("b", { x: 0, y: 0 }, false),
      makeVertex("c", { x: 0, y: 0 }, true),
    ];
    expect(selectSelectedNodeIds(nodes)).toEqual(["a", "c"]);
  });

  it("returns an empty array when nothing is selected", () => {
    const nodes = [makeVertex("a"), makeVertex("b")];
    expect(selectSelectedNodeIds(nodes)).toEqual([]);
  });

  it("returns an empty array for an empty node list", () => {
    expect(selectSelectedNodeIds([])).toEqual([]);
  });

  it("treats `selected: undefined` as not selected", () => {
    // React Flow's runtime types allow `selected` to be undefined for
    // fresh nodes that have never been touched. The selector should
    // not yield those ids.
    const nodes = [
      { ...makeVertex("a"), selected: undefined as unknown as boolean },
    ];
    expect(selectSelectedNodeIds(nodes)).toEqual([]);
  });
});

describe("hasSelection", () => {
  it("is true when at least one node is selected", () => {
    const nodes = [makeVertex("a", { x: 0, y: 0 }, true)];
    expect(hasSelection(nodes, [])).toBe(true);
  });

  it("is true when at least one edge is selected (even with no nodes)", () => {
    const edges = [makeEdge("e1", "a", "b", true)];
    expect(hasSelection([], edges)).toBe(true);
  });

  it("is false when nothing is selected on either side", () => {
    const nodes = [makeVertex("a", { x: 0, y: 0 }, false)];
    const edges = [makeEdge("e1", "a", "b", false)];
    expect(hasSelection(nodes, edges)).toBe(false);
  });

  it("is false on completely empty inputs", () => {
    expect(hasSelection([], [])).toBe(false);
  });
});

describe("nodesById", () => {
  it("builds an id → node map for O(1) per-node lookups", () => {
    const a = makeVertex("a", { x: 0, y: 0 });
    const b = makeVertex("b", { x: 1, y: 1 });
    const map = nodesById([a, b]);
    expect(map.get("a")).toBe(a);
    expect(map.get("b")).toBe(b);
    expect(map.size).toBe(2);
  });

  it("caches by array identity — the same input returns the same map", () => {
    // Per-node store subscribers run the selector body on every store
    // update; the WeakMap cache must return the same map instance so
    // the lookup is O(1), not O(n) on every call.
    const nodes = [makeVertex("a")];
    expect(nodesById(nodes)).toBe(nodesById(nodes));
  });

  it("returns an empty map for an empty node list", () => {
    expect(nodesById([]).size).toBe(0);
  });

  it("does not mutate the input array", () => {
    const nodes = [makeVertex("a"), makeVertex("b")];
    const snapshot = [...nodes];
    nodesById(nodes);
    expect(nodes).toEqual(snapshot);
  });
});