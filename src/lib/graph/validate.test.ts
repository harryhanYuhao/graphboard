import { describe, expect, it } from "vitest";
import { validateGraphForCompute } from "./validate";
import type { GraphSlice, GraphNodeRecord, GraphEdgeRecord } from "./types";

function node(id: string, vertexType: string): GraphNodeRecord {
  return { id, data: { label: "", vertexType: vertexType as never } };
}

function edge(id: string, source: string, target: string): GraphEdgeRecord {
  return { id, source, target };
}

function graph(nodes: GraphNodeRecord[], edges: GraphEdgeRecord[]): GraphSlice {
  return { nodes, edges };
}

function kinds(errors: ReturnType<typeof validateGraphForCompute>) {
  return errors.map((e) => e.kind);
}

describe("validateGraphForCompute", () => {
  it("returns no errors for a valid graph", () => {
    const g = graph(
      [node("i", "input"), node("w", "w"), node("o0", "output"), node("o1", "output")],
      [edge("e1", "i", "w"), edge("e2", "w", "o0"), edge("e3", "w", "o1")],
    );
    expect(validateGraphForCompute(g)).toEqual([]);
  });

  it("returns no errors for an empty graph", () => {
    expect(validateGraphForCompute(graph([], []))).toEqual([]);
  });

  it("flags duplicate node ids", () => {
    const g = graph([node("a", "z"), node("a", "z")], []);
    const errors = validateGraphForCompute(g);
    expect(errors).toHaveLength(1);
    expect(errors[0].kind).toBe("duplicate-node-id");
    expect(errors[0].vertexId).toBe("a");
    expect(errors[0].message).toContain("duplicate node id 'a'");
  });

  it("flags edges referencing unknown vertices", () => {
    const g = graph([node("a", "z")], [edge("e1", "a", "ghost")]);
    const errors = validateGraphForCompute(g);
    expect(kinds(errors)).toEqual(["vertex-not-found"]);
    expect(errors[0].vertexId).toBe("ghost");
    expect(errors[0].message).toContain("ghost");
  });

  it("flags a boundary with degree > 1", () => {
    const g = graph(
      [node("i", "input"), node("z1", "z"), node("z2", "z")],
      [edge("e1", "i", "z1"), edge("e2", "i", "z2")],
    );
    const errors = validateGraphForCompute(g);
    expect(kinds(errors)).toEqual(["boundary-degree"]);
    expect(errors[0].vertexId).toBe("i");
    expect(errors[0].message).toContain("degree 2");
  });

  it("allows a boundary with degree 0 (dangling)", () => {
    const g = graph([node("i", "input")], []);
    expect(validateGraphForCompute(g)).toEqual([]);
  });

  it("flags an H-box with arity != 2", () => {
    const g = graph(
      [node("h", "h"), node("z1", "z"), node("z2", "z"), node("z3", "z")],
      [edge("e1", "h", "z1"), edge("e2", "h", "z2"), edge("e3", "h", "z3")],
    );
    const errors = validateGraphForCompute(g);
    expect(kinds(errors)).toEqual(["h-box-arity"]);
    expect(errors[0].vertexId).toBe("h");
    expect(errors[0].message).toContain("got 3");
  });

  it("flags a W node with 0 input edges", () => {
    const g = graph(
      [node("w", "w"), node("o0", "output"), node("o1", "output")],
      [edge("e1", "w", "o0"), edge("e2", "w", "o1")],
    );
    const errors = validateGraphForCompute(g);
    expect(kinds(errors)).toEqual(["w-input-count"]);
  });

  it("flags a W node with 2 input edges", () => {
    const g = graph(
      [
        node("w", "w"),
        node("i0", "input"),
        node("i1", "input"),
        node("o0", "output"),
        node("o1", "output"),
      ],
      [
        edge("e1", "i0", "w"),
        edge("e2", "i1", "w"),
        edge("e3", "w", "o0"),
        edge("e4", "w", "o1"),
      ],
    );
    const errors = validateGraphForCompute(g);
    expect(kinds(errors)).toEqual(["w-input-count"]);
    expect(errors[0].message).toContain("got 2");
  });

  it("flags a W node with 1 output edge", () => {
    const g = graph(
      [node("w", "w"), node("i", "input"), node("o", "output")],
      [edge("e1", "i", "w"), edge("e2", "w", "o")],
    );
    const errors = validateGraphForCompute(g);
    expect(kinds(errors)).toEqual(["w-output-count"]);
    expect(errors[0].message).toContain("got 1");
  });

  it("collects multiple errors from different nodes", () => {
    const g = graph(
      [node("w1", "w"), node("w2", "w"), node("o0", "output"), node("o1", "output")],
      [edge("e1", "w1", "o0"), edge("e2", "w2", "o1")], // both W's have 0 inputs
    );
    const errors = validateGraphForCompute(g);
    const inputCountErrors = errors.filter((e) => e.kind === "w-input-count");
    expect(inputCountErrors).toHaveLength(2);
  });

  // ---- edge cases discovered during read ----

  it("does not double-report a missing vertex on a self-loop", () => {
    // A self-loop `e1: ghost → ghost` references one missing vertex; the
    // error should appear once, not twice (once as source, once as target).
    const g = graph([], [edge("e1", "ghost", "ghost")]);
    const errors = validateGraphForCompute(g).filter(
      (e) => e.kind === "vertex-not-found",
    );
    expect(errors).toHaveLength(1);
  });

  it("reports each distinct missing vertex once, even across many edges", () => {
    // Two edges both referencing the same two missing vertices → two
    // errors (one per distinct missing vertex), not four.
    const g = graph(
      [],
      [edge("e1", "a", "b"), edge("e2", "a", "b")],
    );
    const errors = validateGraphForCompute(g).filter(
      (e) => e.kind === "vertex-not-found",
    );
    expect(errors).toHaveLength(2);
  });

  it("counts a W self-loop as two output legs (matches backend)", () => {
    // W with 1 input + 1 self-loop: self-loop = 2 output edges → passes
    // the ≥2-output check, but only has 1 real output edge. Pin the
    // backend-mirrored semantics.
    const g = graph(
      [node("w", "w"), node("i", "input")],
      [edge("e1", "i", "w"), edge("e2", "w", "w")],
    );
    const errors = validateGraphForCompute(g);
    // input is fine (1); output is fine (2 from self-loop). No errors.
    expect(errors).toEqual([]);
  });

  it("flags every check independently when a node violates several", () => {
    // A W node that also somehow had degree issues — here a W with 0
    // inputs AND <2 outputs (isolated): two distinct errors.
    const g = graph([node("w", "w")], []);
    const errors = validateGraphForCompute(g);
    expect(errors.map((e) => e.kind).sort()).toEqual([
      "w-input-count",
      "w-output-count",
    ]);
  });

  it("allows a valid H-box (degree exactly 2)", () => {
    const g = graph(
      [node("h", "h"), node("z1", "z"), node("z2", "z")],
      [edge("e1", "h", "z1"), edge("e2", "h", "z2")],
    );
    expect(validateGraphForCompute(g)).toEqual([]);
  });
});
