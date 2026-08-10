// Pins the TikZ serializer (`./export-tikz.ts`): style per vertex type, raw
// LaTeX phase passthrough, the view-slice visual label as a TikZ `label=`
// option, mean-centered coordinate scaling, 1-based node naming, and edge
// emission. Positions are mean-centered before export (same as the
// JSON serializer), divided by 48, and the y axis is flipped (TikZ is y-up,
// React Flow is y-down). The output is a `\begingroup` … `\endgroup` picture
// block with nodes on the nodelayer and edges on the edgelayer.

import { describe, expect, it } from "vitest";
import { exportTikz } from "./export-tikz";
import {
  makeEdge,
  makeEdgeWith,
  makeVertex,
  makeVertexWith,
} from "@/test-utils/factories";

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
    // Two nodes so the mean is well-defined: a {0,0}, b {48,48} → mean {24,24}.
    const out = render([
      makeVertex("a", { x: 0, y: 0 }),
      makeVertex("b", { x: 48, y: 48 }),
    ]);
    // a: (-24,-24) → x = -24/48 = -0.5, y = -(-24)/48 = 0.5
    // b: ( 24, 24) → x =  24/48 =  0.5, y = -( 24)/48 = -0.5
    expect(out).toContain("\\node [GREEN_DOT] (1) at (-0.5, 0.5) {};");
    expect(out).toContain("\\node [GREEN_DOT] (2) at (0.5, -0.5) {};");
  });

  it("centers the graph on the mean position", () => {
    // a {48,96}, b {144,192} → mean {96,144} → offsets (-48,-48) / (48,48).
    const out = render([
      makeVertex("a", { x: 48, y: 96 }),
      makeVertex("b", { x: 144, y: 192 }),
    ]);
    expect(out).toContain("\\node [GREEN_DOT] (1) at (-1, 1) {};");
    expect(out).toContain("\\node [GREEN_DOT] (2) at (1, -1) {};");
  });

  it("renders labeled z spiders as green word balls with the raw phase label", () => {
    // Phases pass through as-is — no auto math-mode wrapping; the user has
    // full control of the LaTeX (see `processLabelString` in export-tikz.ts).
    const out = render([
      makeVertexWith("a", { data: { phase: "\\pi" } }),
    ]);
    expect(out).toContain("\\node [GREEN_WORD_BALL] (1) at (0, 0) {\\pi};");
  });

  it("leaves already-delimited math labels untouched", () => {
    const out = render([
      makeVertexWith("a", { data: { phase: "$-\\frac{\\pi}{2}$" } }),
    ]);
    expect(out).toContain("{$-\\frac{\\pi}{2}$}");
  });

  it("maps every vertex type to a style", () => {
    const out = render([
      makeVertexWith("z", { data: { vertexType: "z" } }),
      makeVertexWith("x", { data: { vertexType: "x" } }),
      makeVertexWith("xbox", { data: { vertexType: "xbox", phase: "\\pi" } }),
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
    expect(out).toContain("\\node [RED_WORD_BALL] (3) at (0, 0) {\\pi};");
    expect(out).toContain("\\node [GREEN_DOT] (4) at (0, 0) {};");
    expect(out).toContain("\\node [YELLOW_BOX] (5) at (0, 0) {};");
    expect(out).toContain("\\node [GREEN_DOT] (6) at (0, 0) {};");
    expect(out).toContain("\\node [GREEN_DOT] (7) at (0, 0) {};");
    expect(out).toContain("\\node [EMPTY] (8) at (0, 0) {};");
    expect(out).toContain("\\node [EMPTY] (9) at (0, 0) {};");
    expect(out).toContain("\\node [EMPTY] (10) at (0, 0) {};");
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

  it("draws dashed-blue edges with the BLUE_DASHED_EDGE style and defines it", () => {
    const out = render(
      [
        makeVertex("a", { x: 0, y: 0 }),
        makeVertex("b", { x: 12, y: 12 }),
        makeVertex("c", { x: 24, y: 24 }),
      ],
      [
        makeEdgeWith("e1", "a", "b", { kind: "dashed_blue" }),
        makeEdge("e2", "b", "c"),
      ],
    );
    expect(out).toContain("\\draw[BLUE_DASHED_EDGE] (1) to (2);");
    expect(out).toContain("\\draw[EDGE] (2) to (3);");
    expect(out).toContain(
      "BLUE_DASHED_EDGE/.style={EDGE, draw=blue, dashed}",
    );
  });
});

describe("exportTikz — header + label hardening", () => {
  it("strips newlines from the title in the header comment", () => {
    const out = exportTikz({
      title: "Line1\nLine2\r\nLine3",
      nodes: [],
      edges: [],
    });
    expect(out).toContain("% Title: Line1 Line2 Line3");
    // Exactly one title line — a newline no longer breaks out of the comment.
    expect(
      out.split("\n").filter((line) => line.startsWith("% Title: ")),
    ).toHaveLength(1);
  });

  it("passes phase labels through as raw LaTeX (no escaping — user-controlled)", () => {
    // The serializer deliberately does NOT escape LaTeX specials: the phase
    // is handed to the user verbatim (see the TODO in processLabelString).
    const out = render([
      makeVertexWith("a", { data: { phase: "&%#_^~$\\pi" } }),
    ]);
    expect(out).toContain("{&%#_^~$\\pi}");
  });

  it("keeps `\\pi` and user-delimited math untouched", () => {
    const out = render([
      makeVertexWith("a", { data: { phase: "\\pi" } }),
      makeVertexWith("b", { data: { phase: "$-\\frac{\\pi}{2}$" } }),
      makeVertexWith("c", { data: { phase: "$$\\frac{\\pi}{4}$$" } }),
    ]);
    // Bare phase: verbatim. Already-delimited $...$: verbatim.
    expect(out).toContain("{\\pi}");
    expect(out).toContain("{$-\\frac{\\pi}{2}$}");
    // $$...$$ is reduced to a single $ pair (TikZ handles one $).
    expect(out).toContain("{$\\frac{\\pi}{4}$}");
  });

  it("emits the visual label as a positioned TikZ label= option", () => {
    // The view-slice visual label becomes a `label=<pos>:{...}` node option;
    // no label when empty or location "none".
    const out = render([
      makeVertexWith("a", { label: "$\\alpha$", labelLocation: "right" }),
      makeVertexWith("b", { label: "note", labelLocation: "top" }),
      makeVertexWith("c", { label: "hidden", labelLocation: "none" }),
    ]);
    expect(out).toContain("\\node [label=right:{$\\alpha$}, GREEN_DOT] (1)");
    expect(out).toContain("\\node [label=above:{note}, GREEN_DOT] (2)");
    expect(out).toContain("\\node [GREEN_DOT] (3)");
    expect(out).not.toContain("hidden");
  });
});
