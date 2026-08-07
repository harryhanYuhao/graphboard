// src/lib/serialisation/formats.test.ts
//
// Pins the export-format registry: the four registered formats (JSON + TikZ
// implemented, ZXLive / QASM placeholders), their picker metadata, and the
// serializer contracts (JSON → valid GraphDocument; TikZ → LaTeX picture;
// placeholders → clearly marked, non-empty files).

import { describe, expect, it } from "vitest";
import { EXPORT_FORMATS, getExportFormat } from "./formats";
import { makeEdge, makeVertex } from "@/test-utils/factories";

const params = {
  title: "My Graph",
  nodes: [makeVertex("a", { x: 12, y: 12 }), makeVertex("b", { x: 36, y: 60 })],
  edges: [makeEdge("e1", "a", "b")],
  createdAt: "2025-01-01T00:00:00.000Z",
};

describe("EXPORT_FORMATS", () => {
  it("registers json, tikz, zxlive, and QASM with picker metadata", () => {
    expect(EXPORT_FORMATS.map((f) => f.id)).toEqual([
      "json",
      "tikz",
      "zxlive",
      "QASM",
    ]);
    const byId = Object.fromEntries(EXPORT_FORMATS.map((f) => [f.id, f]));
    expect(byId.json.extension).toBe(".json");
    expect(byId.json.mimeType).toBe("application/json");
    expect(byId.tikz.extension).toBe(".tikz");
    expect(byId.zxlive.extension).toBe(".zxlive");
    expect(byId.QASM.extension).toBe(".qasm");
  });

  it("json serializes to a valid v2 GraphDocument", () => {
    const contents = getExportFormat("json").serialize(params);
    const parsed = JSON.parse(contents) as {
      schemaVersion: number;
      title: string;
      graph: { nodes: { id: string; data: { vertexType: string } }[] };
    };
    expect(parsed.schemaVersion).toBe(2);
    expect(parsed.title).toBe("My Graph");
    expect(parsed.graph.nodes.map((n) => n.id)).toEqual(["a", "b"]);
    expect(parsed.graph.nodes[0].data.vertexType).toBe("z");
  });

  it("tikz serializes to a LaTeX TikZ picture", () => {
    const contents = getExportFormat("tikz").serialize(params);
    expect(contents).toContain("% Graph Board TikZ export");
    expect(contents).toContain("Title: My Graph");
    expect(contents).toContain("Nodes: 2, Edges: 1");
    expect(contents).toContain("\\begin{tikzpicture}");
    expect(contents).toContain("\\node [GREEN_DOT] (1) at (-0.25, 0.5) {};");
    expect(contents).toContain("\\node [GREEN_DOT] (2) at (0.25, -0.5) {};");
    expect(contents).toContain("\\draw[EDGE] (1) to (2);");
    expect(contents).not.toContain("(placeholder)");
  });

  it("zxlive serializes to a clearly-marked placeholder", () => {
    const contents = getExportFormat("zxlive").serialize(params);
    expect(contents).toContain("# Graph Board ZXLive export (placeholder)");
    expect(contents).toContain("The ZXLive format is not defined yet");
    expect(contents).toContain("Title: My Graph");
  });

  it("qasm serializes to a clearly-marked placeholder", () => {
    const contents = getExportFormat("QASM").serialize(params);
    expect(contents).toContain("// Graph Board QASM export (placeholder)");
    expect(contents).toContain("The QASM format is not defined yet");
    expect(contents).toContain("Title: My Graph");
    expect(contents).toContain("Nodes: 2, Edges: 1");
  });

  it("pins doc_url: tikz links to the TikZ section, the rest share the general page", () => {
    const byId = Object.fromEntries(EXPORT_FORMATS.map((f) => [f.id, f]));
    const general =
      "https://zxwgraphboard-doc.netlify.app/user-guides/saving-and-loading/";
    expect(byId.tikz.doc_url).toBe(`${general}#using-a-tikz-export-in-latex`);
    // Same general page for now; they will diverge as each format's
    // documentation lands.
    for (const id of ["json", "zxlive", "QASM"]) {
      expect(byId[id].doc_url).toBe(general);
    }
  });

  it("getExportFormat throws on an unknown id", () => {
    expect(() => getExportFormat("bmp" as never)).toThrow(
      "unknown export format 'bmp'",
    );
  });
});
