// src/lib/serialisation/export-tikz.ts
//
// LaTeX TikZ picture export. Emits a standalone picture block (`\begingroup`
// … `\endgroup`) with the ZX style definitions (dots, word balls, colors),
// nodes on the `nodelayer` and edges on the `edgelayer`.
//
// Reference format (phases pass through raw, visual labels become label=
// options, edge kinds pick the draw style):
//   \node [GREEN_DOT] (1) at (-11, 0) {};
//   \node [RED_WORD_BALL, label=above:{$\pi$}] (3) at (-9, -1) {\pi};
//   \draw[EDGE] (1) to (4);
//   \draw[BLUE_DASHED_EDGE] (2) to (3);   % dashed_blue edge kind

import type {
  GraphEdge,
  VertexNode,
  VertexType,
  LabelLocation,
} from "../graph/types";
import type { ExportParams } from "./formats";
import { spoilerHeader } from "./placeholder";
import { normalizeNodePositions } from "./normalize";
import { roundToFiveDecimal } from "./round";

// TikZ style per vertex type. Spider types render their phase label inside a
// word ball; unlabeled spiders render as plain dots, and empty / boundary
// markers render as invisible EMPTY anchors. Keep this in sync with
// `VertexType` — new types fall back to a plain dot.
function nodeStyle(vertexType: VertexType, hasPhase: boolean): string {
  switch (vertexType) {
    case "z":
    case "zbox":
    case "w":
    case "and":
      return hasPhase ? "GREEN_WORD_BALL" : "GREEN_DOT";
    case "x":
    case "xbox":
      return hasPhase ? "RED_WORD_BALL" : "RED_DOT";
    case "h":
      return "YELLOW_BOX";
    case "empty":
    case "input":
    case "output":
      return "EMPTY";
    case "black_dot":
      return "BLACK_DOT";
    default:
      // Unknown vertex types still render something visible.
      return "DOT";
  }
}

function nodeLabel(node: VertexNode): string {
  function tikz_position_string(labelLocation: LabelLocation): string {
    switch (labelLocation) {
      case "top":
        return "above";
      case "bottom":
        return "below";
      case "left":
        return "left";
      case "right":
        return "right";
      default:
        return "top";
    }
  }

  if (node.label === "" || node.labelLocation === "none") {
    return "";
  }
  return `label=${tikz_position_string(node.labelLocation)}:{${processLabelString(node.label)}}`;
}

// Phase labels pass through as raw LaTeX — no auto math-mode wrapping, no
// escaping — so the user has full control of the emitted math. `$...$`
// delimited labels pass through verbatim; `$$...$$` is reduced to a single
// `$` pair because TikZ handles one `$`.
// TODO: shall I give user the full privilege to control the label?
function processLabelString(label: string): string {
  const trimmed = label.trim();
  if (trimmed === "") return "";
  // Somehow tikz can only handle single $.
  // TODO: better error control later
  if (trimmed.startsWith("$$")) return trimmed.slice(1, -1);
  if (trimmed.startsWith("$")) return trimmed;
  //gives the user full control of latex labels
  return trimmed;
  // return `$${escapeTikzSpecials(label)}$`;
}

function nodeLine(node: VertexNode, idx: number): string {
  // App positions are in px on a 48px grid; divide so TikZ coordinates stay small.
  const locationRatio = 48;

  const locationX = roundToFiveDecimal(node.position.x / locationRatio);
  // tikz and reactflow's y coordinates are reversed
  const locationY = roundToFiveDecimal(-node.position.y / locationRatio);

  const style = nodeStyle(node.data.vertexType, node.data.phase !== "");
  const label_string = nodeLabel(node);

  const node_style_string = [label_string, style]
    .filter((value) => value !== "")
    .join(", ");

  return `\\node [${node_style_string}] (${idx}) at (${locationX}, ${locationY}) {${processLabelString(node.data.phase)}};`;
}

function edgeLine(edge: GraphEdge, nodeIndexById: Map<string, number>): string {
  const source = nodeIndexById.get(edge.source);
  const target = nodeIndexById.get(edge.target);
  if (source === undefined || target === undefined) {
    return `% skipped edge ${edge.id}: endpoint not in node list`;
  }
  // Edge kind picks the TikZ style: dashed-blue edges draw dashed in blue,
  // everything else uses the plain EDGE style.
  const style = edge.data?.kind === "dashed_blue" ? "BLUE_DASHED_EDGE" : "EDGE";
  return `\\draw[${style}] (${source}) to (${target});`;
}

function tikzBackBone(nodeString: string, edgeString: string): string {
  const style_string: string = `% --- Colors (define-if-not-already-defined) ---
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
    WORD_BALL/.style={draw=black, shape=rectangle, minimum size=6.5mm,
        rounded corners=3.2mm, inner sep=1.2mm, outer sep=-1.0mm,
        scale=1, font={\\large\\boldmath}, line width=1pt},
    GREEN_DOT/.style={DOT, fill=zxGreen},
    GREEN_WORD_BALL/.style={WORD_BALL, fill=zxGreen},
    RED_DOT/.style={DOT, fill=zxRed},
    RED_WORD_BALL/.style={GREEN_WORD_BALL, fill=zxRed},
    YELLOW_BOX/.style={fill=zxYellow, draw=black, line width=1pt, shape=rectangle, inner sep=0.6mm,
        minimum height=3.4mm, minimum width=3.4mm,
        font={\\large\\boldmath}},
    EDGE/.style={draw=black, line width=1pt},
    BLUE_DASHED_EDGE/.style={EDGE, draw=blue, dashed}
}
\\pgfdeclarelayer{edgelayer}
\\pgfdeclarelayer{nodelayer}
\\pgfsetlayers{edgelayer,nodelayer,main}
`;
  const res: string = `\\begingroup
${style_string}
\\begin{tikzpicture}
    \\begin{pgfonlayer}{nodelayer}
${nodeString}
    \\end{pgfonlayer}
    \\begin{pgfonlayer}{edgelayer}
${edgeString}
    \\end{pgfonlayer}
\\end{tikzpicture}

\\endgroup`;

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
