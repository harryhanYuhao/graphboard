// Pins `computeGraphStats`: vertex/edge counts, min/max undirected degree,
// and the per-vertex-type breakdown.

import { describe, expect, it } from "vitest";
import { computeGraphStats } from "./stats";
import { VERTEX_TYPES } from "./vertex-types";
import { makeEdge, makeVertex, makeVertexWith } from "@/test-utils/factories";

describe("computeGraphStats", () => {
  it("reports zeros for an empty graph", () => {
    expect(computeGraphStats([], [])).toEqual({
      vertexCount: 0,
      edgeCount: 0,
      minDegree: 0,
      maxDegree: 0,
      // Derived from the registry so adding a vertex type can't rot this test.
      countsByType: Object.fromEntries(
        VERTEX_TYPES.map((meta) => [meta.type, 0]),
      ),
    });
  });

  it("counts vertices and edges", () => {
    const nodes = [makeVertex("a"), makeVertex("b"), makeVertex("c")];
    const edges = [makeEdge("e1", "a", "b"), makeEdge("e2", "b", "c")];
    const stats = computeGraphStats(nodes, edges);
    expect(stats.vertexCount).toBe(3);
    expect(stats.edgeCount).toBe(2);
  });

  it("computes min and max undirected degree (star graph)", () => {
    const nodes = [
      makeVertex("center"),
      makeVertex("leaf1"),
      makeVertex("leaf2"),
      makeVertex("leaf3"),
    ];
    const edges = [
      makeEdge("e1", "center", "leaf1"),
      makeEdge("e2", "center", "leaf2"),
      makeEdge("e3", "center", "leaf3"),
    ];
    const stats = computeGraphStats(nodes, edges);
    expect(stats.minDegree).toBe(1);
    expect(stats.maxDegree).toBe(3);
  });

  it("gives isolated vertices degree 0", () => {
    const nodes = [makeVertex("a"), makeVertex("b"), makeVertex("c")];
    const edges = [makeEdge("e1", "a", "b")];
    const stats = computeGraphStats(nodes, edges);
    expect(stats.minDegree).toBe(0);
    expect(stats.maxDegree).toBe(1);
  });

  it("counts a self-loop twice in the degree", () => {
    const stats = computeGraphStats(
      [makeVertex("a")],
      [makeEdge("e1", "a", "a")],
    );
    expect(stats.edgeCount).toBe(1);
    expect(stats.minDegree).toBe(2);
    expect(stats.maxDegree).toBe(2);
  });

  it("counts vertices per type, keeping absent types at 0", () => {
    const nodes = [
      makeVertex("z1"),
      makeVertexWith("z2", { data: { vertexType: "z" } }),
      makeVertexWith("x1", { data: { vertexType: "x" } }),
      makeVertexWith("w1", { data: { vertexType: "w" } }),
    ];
    const stats = computeGraphStats(nodes, []);
    expect(stats.countsByType.z).toBe(2);
    expect(stats.countsByType.x).toBe(1);
    expect(stats.countsByType.w).toBe(1);
    expect(stats.countsByType.h).toBe(0);
    expect(stats.countsByType.input).toBe(0);
  });
});

describe("computeGraphStats — untrusted vertexType", () => {
  it("tolerates prototype-key vertexType values without mangled counts", () => {
    const stats = computeGraphStats(
      [makeVertexWith("a", { data: { vertexType: "__proto__" as never } })],
      [],
    );
    expect(stats.countsByType["__proto__" as never]).toBe(1);
    // Every registered type still counts 0.
    expect(Object.values(stats.countsByType)).toContain(0);
  });
});
