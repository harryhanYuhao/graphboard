// Pins the TikZ serializer (`./export-tikz.ts`): style per vertex type, label
// math-mode wrapping, coordinate scaling, 1-based node naming, and edge
// emission. Coordinates divide by 48 and flip the y axis (TikZ is y-up,
// React Flow is y-down). The output is a `\begingroup` … `\endgroup` picture
// block with nodes on the nodelayer and edges on the edgelayer.

import { describe, expect, it } from "vitest";
import { exportTikz } from "./export-tikz";
import { makeEdge, makeVertex, makeVertexWith } from "@/test-utils/factories";

function render(
  nodes: ReturnType<typeof makeVertexWith>[],
  edges: ReturnType<typeof makeEdge>[] = [],
): string {
  return exportTikz({ title: "t", nodes, edges });
}

describe("exportTikz", () => {
  it("wraps the picture in a group with style definitions", () => {
    const out = render([makeVertex("a", { x: 0, y: 0 })]);
    expect(out).toContain("\\begingroup");
    expect(out).toContain("\\endgroup");
    expect(out).toContain("\\begin{tikzpicture}");
    expect(out).toContain("\\providecolor{zxGreen}");
    expect(out).toContain("GREEN_DOT/.style");
    expect(out).toContain("\\pgfdeclarelayer{nodelayer}");
    expect(out).toContain("\\begin{pgfonlayer}{nodelayer}");
    expect(out).toContain("\\begin{pgfonlayer}{edgelayer}");
  });

  it("scales coordinates by 1/48 and flips the y axis", () => {
    const out = render([makeVertex("a", { x: 24, y: -36 })]);
    // x = 24/48 = 0.5; y = -(-36)/48 = 0.75; 1-based node name.
    expect(out).toContain("\\node [GREEN_DOT] (1) at (0.5, 0.75) {};");
  });

  it("renders labeled z spiders as green word balls with math-wrapped labels", () => {
    const out = render([
      makeVertexWith("a", { data: { label: "\\pi" } }),
    ]);
    expect(out).toContain("\\node [GREEN_WORD_BALL] (1) at (0, 0) {$\\pi$};");
  });

  it("leaves already-delimited math labels untouched", () => {
    const out = render([
      makeVertexWith("a", { data: { label: "$-\\frac{\\pi}{2}$" } }),
    ]);
    expect(out).toContain("{$-\\frac{\\pi}{2}$}");
  });

  it("maps every vertex type to a style", () => {
    const out = render([
      makeVertexWith("z", { data: { vertexType: "z" } }),
      makeVertexWith("x", { data: { vertexType: "x" } }),
      makeVertexWith("xbox", { data: { vertexType: "xbox", label: "\\pi" } }),
      makeVertexWith("zbox", { data: { vertexType: "zbox" } }),
      makeVertexWith("h", { data: { vertexType: "h" } }),
      makeVertexWith("w", { data: { vertexType: "w" } }),
      makeVertexWith("and", { data: { vertexType: "and" } }),
      makeVertexWith("empty", { data: { vertexType: "empty" } }),
      makeVertexWith("input", { data: { vertexType: "input" } }),
      makeVertexWith("output", { data: { vertexType: "output" } }),
    ]);
    expect(out).toContain("\\node [GREEN_DOT] (1) at (0, 0) {};");
    expect(out).toContain("\\node [RED_DOT] (2) at (0, 0) {};");
    expect(out).toContain("\\node [RED_WORD_BALL] (3) at (0, 0) {$\\pi$};");
    expect(out).toContain("\\node [GREEN_DOT] (4) at (0, 0) {};");
    expect(out).toContain("\\node [YELLOW_BOX] (5) at (0, 0) {};");
    expect(out).toContain("\\node [GREEN_DOT] (6) at (0, 0) {};");
    expect(out).toContain("\\node [GREEN_DOT] (7) at (0, 0) {};");
    expect(out).toContain("\\node [EMPTY] (8) at (0, 0) {};");
    expect(out).toContain("\\node [DOT] (9) at (0, 0) {};");
    expect(out).toContain("\\node [DOT] (10) at (0, 0) {};");
  });

  it("emits one draw line per edge, using 1-based node names", () => {
    const out = render(
      [
        makeVertex("a", { x: 0, y: 0 }),
        makeVertex("b", { x: 12, y: 12 }),
        makeVertex("c", { x: 24, y: 24 }),
      ],
      [makeEdge("e1", "a", "b"), makeEdge("e2", "b", "c")],
    );
    expect(out).toContain("\\draw[EDGE] (1) to (2);");
    expect(out).toContain("\\draw[EDGE] (2) to (3);");
  });

  it("skips edges whose endpoint is missing instead of crashing", () => {
    const out = render(
      [makeVertex("a", { x: 0, y: 0 })],
      [makeEdge("e1", "a", "ghost")],
    );
    expect(out).toContain("% skipped edge e1: endpoint not in node list");
    expect(out).not.toContain("\\draw[EDGE] (1) to (undefined);");
  });
});
