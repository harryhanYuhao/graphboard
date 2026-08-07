// src/lib/serialisation/export-tikz.ts
//
// LaTeX TikZ picture export. Emits a standalone picture block (`\begingroup`
// … `\endgroup`) with the ZX style definitions (dots, word balls, colors),
// nodes on the `nodelayer` and edges on the `edgelayer`.
//
// Reference format:
//   \node [GREEN_DOT] (1) at (-11, 0) {};
//   \node [RED_WORD_BALL] (3) at (-9, -1) {$\pi$};
//   \draw[EDGE] (1) to (4);

import type { GraphEdge, VertexNode, VertexType } from "../graph/types";
import type { ExportParams } from "./formats";
import { spoilerHeader } from "./placeholder";
import { normalizeNodePositions } from "./normalize";
import { roundToFiveDecimal } from "./round";

// TikZ style per vertex type. Spider types render their phase label inside a
// word ball; unlabeled spiders render as plain dots, and empty / boundary
// markers render as invisible EMPTY anchors. Keep this in sync with
// `VertexType` — new types fall back to a plain dot.
function nodeStyle(vertexType: VertexType, hasLabel: boolean): string {
  switch (vertexType) {
    case "z":
    case "zbox":
    case "w":
    case "and":
      return hasLabel ? "GREEN_WORD_BALL" : "GREEN_DOT";
    case "x":
    case "xbox":
      return hasLabel ? "RED_WORD_BALL" : "RED_DOT";
    case "h":
      return "YELLOW_BOX";
    case "empty":
    case "input":
    case "output":
      return "EMPTY";
    case "black_dot":
      return "BLACK_DOT";
    default:
      // Unknown / newly added vertex types still render something visible.
      return "DOT";
  }
}

// Escape the LaTeX specials that never appear in a valid phase expression
// (`& % # $ _ ^ ~`). `\ { }` are left alone so phase math like
// `\frac{\pi}{2}` keeps working. Labels are otherwise treated as LaTeX
// content by design (the picture is compiled by the user), so a `}`-breakout
// remains possible for hand-typed labels — documented boundary, no
// browser-side risk.
function escapeTikzSpecials(label: string): string {
  return label.replace(/[&%#$^_~]/g, (ch) => {
    switch (ch) {
      case "&":
        return "\\&";
      case "%":
        return "\\%";
      case "#":
        return "\\#";
      case "$":
        return "\\$";
      case "^":
        return "\\^{}";
      case "_":
        return "\\_";
      case "~":
        return "\\~{}";
      default:
        return ch;
    }
  });
}

// Wrap a bare phase label in math mode (`\pi` → `$\pi$`); labels that are
// already `$...$` / `$$...$$` delimited pass through untouched.
function tikzLabel(label: string): string {
  if (label === "") return "";
  if (label.startsWith("$")) return label;
  return `$${escapeTikzSpecials(label)}$`;
}

function nodeLine(node: VertexNode, idx: number): string {
  // App positions are in px on a 48px grid; divide so TikZ coordinates stay small.
  const locationRatio = 48;

  const locationX = roundToFiveDecimal(node.position.x / locationRatio);
  // tikz and reactflow's y coordinates are reversed
  const locationY = roundToFiveDecimal(-node.position.y / locationRatio);

  const style = nodeStyle(node.data.vertexType, node.data.label !== "");

  return `\\node [${style}] (${idx}) at (${locationX}, ${locationY}) {${tikzLabel(node.data.label)}};`;
}

function edgeLine(edge: GraphEdge, nodeIndexById: Map<string, number>): string {
  const source = nodeIndexById.get(edge.source);
  const target = nodeIndexById.get(edge.target);
  if (source === undefined || target === undefined) {
    return `% skipped edge ${edge.id}: endpoint not in node list`;
  }
  return `\\draw[EDGE] (${source}) to (${target});`;
}

function tikzBackBone(nodeString: string, edgeString: string): string {
  const style_string: string =
    `% --- Colors (define-if-not-already-defined) ---
\\providecolor{zxRed}{RGB}{232,165,165}   % X spiders
\\providecolor{zxGreen}{RGB}{216,248,216} % Z spiders
\\providecolor{zxYellow}{RGB}{255,255,0}     % hadamard 

\\tikzset{
    EMPTY/.style={minimum size=3.4mm,
        outer sep=-1.7mm},
    DOT/.style={inner sep=0mm, minimum size=3.4mm, shape=circle,
        draw=black, outer sep=-0.5mm, line width=1pt},
    BLACK_DOT/.style={minimum size=2mm,
        outer sep=-1mm, fill=black, shape=circle},
    WORD_BALL/.style={draw=black, shape=rectangle, minimum size=7.5mm,
        rounded corners=3.6mm, inner sep=1.2mm, outer sep=-0.5mm,
        scale=1, font={\\Large\\boldmath}, line width=1pt},
    GREEN_DOT/.style={DOT, fill=zxGreen},
    GREEN_WORD_BALL/.style={WORD_BALL, fill=zxGreen},
    RED_DOT/.style={DOT, fill=zxRed},
    RED_WORD_BALL/.style={GREEN_WORD_BALL, fill=zxRed},
    YELLOW_BOX/.style={fill=zxYellow, draw=black, line width=1pt, shape=rectangle, inner sep=0.6mm,
        minimum height=3.4mm, minimum width=3.4mm,
        font={\\Large\\boldmath}},
    EDGE/.style={draw=black, line width=1pt}
}
\\pgfdeclarelayer{edgelayer}
\\pgfdeclarelayer{nodelayer}
\\pgfsetlayers{edgelayer,nodelayer,main}
`
  const res: string =
    `\\begingroup
${style_string}
\\begin{tikzpicture}
    \\begin{pgfonlayer}{nodelayer}
${nodeString}
    \\end{pgfonlayer}
    \\begin{pgfonlayer}{edgelayer}
${edgeString}
    \\end{pgfonlayer}
\\end{tikzpicture}

\\endgroup`

  return res;
}

export function exportTikz(params: ExportParams): string {
  const header = spoilerHeader("TikZ", params, "%");
  // Mean-center the positions first
  const nodes = normalizeNodePositions(params.nodes);
  const nodeIndexById = new Map(nodes.map((node, i) => [node.id, i + 1]));
  const nodeStrings = nodes.map(
    (node, i) => `        ${nodeLine(node, i + 1)}`,
  );
  const edgeStrings = params.edges.map(
    (edge) => `        ${edgeLine(edge, nodeIndexById)}`,
  );
  const body = tikzBackBone(nodeStrings.join("\n"), edgeStrings.join("\n"));

  return `${header}
${body}`;
}
