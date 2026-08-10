// Endpoint math for `StraightCenterEdge`. Where an edge endpoint lands for a
// given shape/rotation is the bug-prone part worth pinning.

import { describe, expect, it } from "vitest";
import { edgeKindPathStyle, getEdgeEndpoint } from "./edge-geometry";
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

// Assert a point matches with approximate equality. Rotation is matrix-
// multiplied floats, so exact equality is flaky (e.g. 20 → 20.000000000000004).
function expectPoint(
  actual: { x: number; y: number },
  expected: { x: number; y: number },
) {
  expect(actual.x).toBeCloseTo(expected.x, 10);
  expect(actual.y).toBeCloseTo(expected.y, 10);
}

describe("getEdgeEndpoint — source side", () => {
  it("anchors at the node center for a symmetric vertex", () => {
    expectPoint(getEdgeEndpoint(node(), "source"), { x: 20, y: 20 });
  });

  it("anchors a directional source one-third down the body (W / And)", () => {
    // Outgoing edges sit +height/3 below center so they don't pile on
    // incoming edges. height 40 → 20 + 40/3 ≈ 33.333.
    expectPoint(getEdgeEndpoint(node({ vertexType: "w" }), "source"), {
      x: 20,
      y: 20 + 40 / 3,
    });
    expectPoint(getEdgeEndpoint(node({ vertexType: "and" }), "source"), {
      x: 20,
      y: 20 + 40 / 3,
    });
  });

  it("is rotation-invariant for symmetric vertices (zero local offset)", () => {
    // Zero local offset → stays at the rotation pivot (center) for any angle.
    expectPoint(getEdgeEndpoint(node({ rotation: 137 }), "source"), {
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

  it("follows the rotation around the node center", () => {
    // 180° flips the top dot to the bottom edge: local (0, -20) rotated
    // 180° around (20,20) lands at (20, 40).
    expectPoint(
      getEdgeEndpoint(node({ vertexType: "w", rotation: 180 }), "target"),
      { x: 20, y: 40 },
    );
  });

  it("rotates clockwise to the right edge at 90°", () => {
    // Top dot (0, -20) rotated 90° CW around (20,20) → (40, 20).
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
    // Node at (100, 50): center (120, 70), top dot at 180° → (120, 90).
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

describe("edgeKindPathStyle", () => {
  it("thins the default (or absent) kind to strokeWidth 1.5", () => {
    expect(edgeKindPathStyle("default", false)).toEqual({ strokeWidth: 1.5 });
    expect(edgeKindPathStyle(undefined, false)).toEqual({ strokeWidth: 1.5 });
  });

  it("styles dashed-blue edges dashed in blue", () => {
    expect(edgeKindPathStyle("dashed_blue", false)).toEqual({
      stroke: "#2563eb",
      strokeDasharray: "4 1.5",
      strokeWidth: 2,
    });
  });

  it("keeps the dash but drops the inline color when selected (CSS selection color shows)", () => {
    expect(edgeKindPathStyle("dashed_blue", true)).toEqual({
      strokeDasharray: "4 1.5",
      strokeWidth: 2,
    });
  });
});
