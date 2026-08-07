// Pins `meanPosition` and `normalizeNodePositions` — the export-time
// mean-centering used by the JSON and TikZ serializers.

import { describe, expect, it } from "vitest";
import { makeVertex } from "@/test-utils/factories";
import { meanPosition, normalizeNodePositions } from "./normalize";

describe("meanPosition", () => {
  it("returns [0, 0] for an empty graph", () => {
    expect(meanPosition([])).toEqual([0, 0]);
  });

  it("returns the single node's position", () => {
    expect(meanPosition([makeVertex("a", { x: 12, y: -7 })])).toEqual([12, -7]);
  });

  it("returns the midpoint of several nodes", () => {
    const nodes = [
      makeVertex("a", { x: 10, y: 20 }),
      makeVertex("b", { x: 30, y: 40 }),
      makeVertex("c", { x: 50, y: 60 }),
    ];
    expect(meanPosition(nodes)).toEqual([30, 40]);
  });
});

describe("normalizeNodePositions", () => {
  it("returns [] for an empty graph", () => {
    expect(normalizeNodePositions([])).toEqual([]);
  });

  it("shifts positions so the mean lands on the origin", () => {
    const nodes = [
      makeVertex("a", { x: 10, y: 20 }),
      makeVertex("b", { x: 30, y: 40 }),
    ];
    const normalized = normalizeNodePositions(nodes);
    expect(normalized.map((n) => n.position)).toEqual([
      { x: -10, y: -10 },
      { x: 10, y: 10 },
    ]);
  });

  it("does not mutate the input nodes", () => {
    const nodes = [
      makeVertex("a", { x: 10, y: 20 }),
      makeVertex("b", { x: 30, y: 40 }),
    ];
    normalizeNodePositions(nodes);
    expect(nodes[0].position).toEqual({ x: 10, y: 20 });
    expect(nodes[1].position).toEqual({ x: 30, y: 40 });
  });
});
