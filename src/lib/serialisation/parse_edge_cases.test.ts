// Edge cases for `parseDocument` / `importGraphJson`: duplicate ids in the
// graph slice must fail loudly (duplicate React Flow keys silently collapse
// the id map downstream).

import { describe, expect, it } from "vitest";
import { importGraphJson, parseDocument } from "./parse";

function node(id: string): { id: string; data: unknown } {
  return { id, data: { phase: "", vertexType: "z" } };
}

function edge(id: string): { id: string; source: string; target: string } {
  return { id, source: "a", target: "b" };
}

function docJson(nodes: unknown[], edges: unknown[]): string {
  return JSON.stringify({
    schemaVersion: 2,
    graph: { nodes, edges },
    view: { nodes: [], edges: [] },
  });
}

describe("parseDocument — duplicate ids", () => {
  it("rejects duplicate node ids", () => {
    const result = parseDocument(docJson([node("a"), node("a")], []));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/duplicate/i);
      expect(result.error).toContain("'a'");
    }
  });

  it("rejects duplicate edge ids", () => {
    const result = parseDocument(
      docJson([node("a"), node("b")], [edge("e1"), edge("e1")]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/duplicate/i);
      expect(result.error).toContain("'e1'");
    }
  });

  it("accepts distinct node and edge ids", () => {
    const result = parseDocument(
      docJson([node("a"), node("b")], [edge("e1")]),
    );
    expect(result.ok).toBe(true);
  });

  it("importGraphJson surfaces the duplicate-id error", () => {
    const result = importGraphJson(docJson([node("a"), node("a")], []));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/duplicate/i);
    }
  });
});
