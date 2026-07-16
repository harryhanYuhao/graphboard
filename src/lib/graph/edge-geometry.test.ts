// src/lib/graph/edge-geometry.test.ts
//
// Geometry coverage for `StraightCenterEdge`'s endpoint math. The
// renderer itself has a thin test surface (per AGENTS.md) — the part
// worth pinning is where an edge endpoint lands for a given vertex
// shape / rotation, because that's the bug-prone math.

import { describe, expect, it } from "vitest";
import { getEdgeEndpoint } from "./edge-geometry";
import type { EndpointInput } from "./edge-geometry";

// Default node: 40x40 body at (0,0), so center is (20, 20).
function node(overrides: Partial<EndpointInput> = {}): EndpointInput {
  return {
    positionAbsolute: { x: 0, y: 0 },
    width: 40,
    height: 40,
    vertexType: "z",
    rotation: 0,
    ...overrides,
  };
}

// Assert a point matches, coordinate-by-coordinate with approximate
// equality. Rotation math is matrix-multiplied floats, so exact
// equality is flaky (e.g. 20 becomes 20.000000000000004 at 180°).
function expectPoint(
  actual: { x: number; y: number },
  expected: { x: number; y: number },
) {
  expect(actual.x).toBeCloseTo(expected.x, 10);
  expect(actual.y).toBeCloseTo(expected.y, 10);
}

describe("getEdgeEndpoint — source side (always center)", () => {
  it("anchors at the node center for a symmetric vertex", () => {
    expect(getEdgeEndpoint(node(), "source")).toEqual({ x: 20, y: 20 });
  });

  it("anchors at the node center even for a directional vertex (source ≠ top)", () => {
    // Source endpoints are always the centered bottom slot, so a W
    // node's source is still its body center.
    expect(getEdgeEndpoint(node({ vertexType: "w" }), "source")).toEqual({
      x: 20,
      y: 20,
    });
  });

  it("is rotation-invariant (zero local offset)", () => {
    // The source endpoint never moves with rotation — it's pinned to
    // the body center, which is the rotation pivot.
    expect(getEdgeEndpoint(node({ rotation: 137 }), "source")).toEqual({
      x: 20,
      y: 20,
    });
  });
});

describe("getEdgeEndpoint — target side, non-directional", () => {
  it("anchors at the node center", () => {
    expect(getEdgeEndpoint(node({ vertexType: "x" }), "target")).toEqual({
      x: 20,
      y: 20,
    });
  });

  it("is rotation-invariant", () => {
    expect(getEdgeEndpoint(node({ vertexType: "z", rotation: 90 }), "target")).toEqual({
      x: 20,
      y: 20,
    });
  });
});

describe("getEdgeEndpoint — directional target (W / And gate)", () => {
  it("anchors on the top edge when un-rotated", () => {
    expect(getEdgeEndpoint(node({ vertexType: "w" }), "target")).toEqual({
      x: 20,
      y: 0,
    });
  });

  it("follows the rotation around the node center (regression: edges used to ignore rotation)", () => {
    // 180° flips the top dot to the bottom edge — local offset
    // (0, -20) rotated 180° around (20,20) lands at (20, 40).
    expectPoint(
      getEdgeEndpoint(node({ vertexType: "w", rotation: 180 }), "target"),
      { x: 20, y: 40 },
    );
  });

  it("rotates clockwise to the right edge at 90°", () => {
    // Top dot (0, -20) rotated 90° clockwise around (20,20):
    //   localX' = 0*cos90 - (-20)*sin90 = 20
    //   localY' = 0*sin90 + (-20)*cos90 = 0
    // → endpoint (40, 20), i.e. the right edge center.
    expectPoint(
      getEdgeEndpoint(node({ vertexType: "w", rotation: 90 }), "target"),
      { x: 40, y: 20 },
    );
  });

  it("rotates to the left edge at 270°", () => {
    expectPoint(
      getEdgeEndpoint(node({ vertexType: "w", rotation: 270 }), "target"),
      { x: 0, y: 20 },
    );
  });

  it("treats the And gate identically to W (both directional)", () => {
    expectPoint(
      getEdgeEndpoint(node({ vertexType: "and", rotation: 180 }), "target"),
      { x: 20, y: 40 },
    );
  });
});

describe("getEdgeEndpoint — node position offset", () => {
  it("adds the absolute position to the rotated endpoint", () => {
    // Same center math as above, but the node is translated to
    // (100, 50): center becomes (120, 70), top dot at 180° → (120, 90).
    expectPoint(
      getEdgeEndpoint(
        node({
          positionAbsolute: { x: 100, y: 50 },
          vertexType: "w",
          rotation: 180,
        }),
        "target",
      ),
      { x: 120, y: 90 },
    );
  });
});
