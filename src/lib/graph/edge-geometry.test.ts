// Endpoint math for `StraightCenterEdge`. Where an edge endpoint lands for a
// given shape/rotation is the bug-prone part worth pinning.

import { describe, expect, it } from "vitest";
import { edgeKindPathStyle, getEdgeEndpoint } from "./edge-geometry";
import type { EndpointInput } from "./edge-geometry";
import type { EdgeKind } from "./types";
import { EDGE_KIND_MAP } from "./edge-registry";

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
  it("styles the default kind thin and slate (registry-driven)", () => {
    expect(edgeKindPathStyle("default", false)).toEqual({
      stroke: "#334155",
      strokeWidth: 1.5,
    });
  });

  it("styles dashed-blue edges dashed in blue", () => {
    expect(edgeKindPathStyle("dashed_blue", false)).toEqual({
      stroke: "#2563eb",
      strokeDasharray: "4 1.5",
      strokeWidth: 2,
    });
  });

  it("styles dashed-light edges dashed in gray at 1pt", () => {
    expect(edgeKindPathStyle("dashed_light", false)).toEqual({
      stroke: "#808080",
      strokeDasharray: "2 1.5",
      strokeWidth: 1,
    });
  });

  it("glows blue with the kind's own stroke when selected (vertex-style highlight)", () => {
    expect(edgeKindPathStyle("dashed_blue", true)).toEqual({
      filter: "drop-shadow(0 0 2px rgb(37 99 235))",
      stroke: "#2563eb",
      strokeDasharray: "4 1.5",
      strokeWidth: 2,
    });
  });

  it("keeps the dashed-light dash and gray stroke when selected", () => {
    expect(edgeKindPathStyle("dashed_light", true)).toEqual({
      filter: "drop-shadow(0 0 2px rgb(37 99 235))",
      stroke: "#808080",
      strokeDasharray: "2 1.5",
      strokeWidth: 1,
    });
  });

  it("selected default edges glow too, keeping their slate stroke", () => {
    expect(edgeKindPathStyle("default", true)).toEqual({
      filter: "drop-shadow(0 0 2px rgb(37 99 235))",
      stroke: "#334155",
      strokeWidth: 1.5,
    });
  });

  it("falls back to the default style for an unknown kind (no crash)", () => {
    // A kind smuggled past the typed boundary must not crash the renderer
    // (EDGE_KIND_MAP[kind] would be undefined; no error boundary exists).
    const style = edgeKindPathStyle("invisible" as EdgeKind, false);
    expect(style).toEqual(edgeKindPathStyle("default", false));
    expect(style?.stroke).toBe(EDGE_KIND_MAP.default.stroke);
  });
});
