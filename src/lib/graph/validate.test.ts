import { describe, expect, it } from "vitest";
import { validateGraphForCompute } from "./validate";
import type { GraphSlice, GraphNodeRecord, GraphEdgeRecord } from "./types";

function node(id: string, vertexType: string, order?: unknown): GraphNodeRecord {
  return {
    id,
    data: {
      phase: "",
      vertexType: vertexType as never,
      ...(order !== undefined ? { order: order as never } : {}),
    },
  };
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

  it("rejects a W self-loop rather than counting it as output legs (matches backend)", () => {
    // W with 1 input + 1 self-loop: the self-loop is rejected outright
    // and the real output count (0) also fails. Mirrors the Rust pre-pass.
    const g = graph(
      [node("w", "w"), node("i", "input")],
      [edge("e1", "i", "w"), edge("e2", "w", "w")],
    );
    const errors = validateGraphForCompute(g);
    expect(errors.map((e) => e.kind).sort()).toEqual([
      "w-output-count",
      "w-self-loop",
    ]);
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

  // ---- degree bookkeeping: self-loops count as 2 ----

  it("counts a self-loop as degree 2 for a z-spider (no error, no boundary/h/w checks)", () => {
    // z has no degree constraint; self-loop alone is degree 2, no error.
    const g = graph([node("z", "z")], [edge("e1", "z", "z")]);
    expect(validateGraphForCompute(g)).toEqual([]);
  });

  it("accumulates self-loop (+2) and distinct edges (+1 each) into degree", () => {
    // h with a self-loop (deg 2) + one more edge (deg 3) → arity 3 → error.
    const g = graph(
      [node("h", "h"), node("z1", "z")],
      [edge("e1", "h", "h"), edge("e2", "h", "z1")],
    );
    const errors = validateGraphForCompute(g);
    expect(kinds(errors)).toEqual(["h-box-arity"]);
    expect(errors[0].message).toContain("got 3");
  });

  it("flags a boundary input with a self-loop (degree 2 > 1)", () => {
    const g = graph([node("i", "input")], [edge("e1", "i", "i")]);
    const errors = validateGraphForCompute(g);
    expect(kinds(errors)).toEqual(["boundary-degree"]);
    expect(errors[0].vertexId).toBe("i");
    expect(errors[0].message).toContain("degree 2");
  });

  it("flags a boundary output with a self-loop (degree 2 > 1)", () => {
    const g = graph([node("o", "output")], [edge("e1", "o", "o")]);
    const errors = validateGraphForCompute(g);
    expect(kinds(errors)).toEqual(["boundary-degree"]);
  });

  it("treats an H-box self-loop as arity 2 (degree-only check passes)", () => {
    // Pin current behavior: the H-box arity check is purely degree-based, so a
    // single self-loop (degree 2) passes despite consuming both legs itself.
    const g = graph([node("h", "h")], [edge("e1", "h", "h")]);
    expect(validateGraphForCompute(g)).toEqual([]);
  });

  // ---- W node counting: self-loops, mixed input/output ----

  it("a pure W self-loop is flagged as a self-loop plus input/output counts", () => {
    // Self-loops are ill-defined for the directional W: contraction would
    // trace two arbitrary free legs. The self-loop no longer feeds the
    // output count, so the real counts (0 inputs, 0 outputs) also fire.
    const g = graph([node("w", "w")], [edge("e1", "w", "w")]);
    const errors = validateGraphForCompute(g);
    expect(kinds(errors)).toEqual([
      "w-self-loop",
      "w-input-count",
      "w-output-count",
    ]);
  });

  it("a W self-loop plus one real input edge is flagged as a self-loop", () => {
    // Previously escaped validation (1 input + loop counted as 2 outputs)
    // and contraction produced a meaningless tensor. Must be rejected.
    const g = graph(
      [node("w", "w"), node("i", "input")],
      [edge("e1", "i", "w"), edge("e2", "w", "w")],
    );
    const errors = validateGraphForCompute(g);
    expect(kinds(errors)).toEqual(["w-self-loop", "w-output-count"]);
  });

  it("a W with a real input edge AND a self-loop counts the self-loop as neither input nor output", () => {
    // The self-loop is flagged on its own; the real counts (1 input,
    // 1 output) are checked without it.
    const g = graph(
      [node("w", "w"), node("i", "input"), node("o", "output")],
      [edge("e1", "i", "w"), edge("e2", "w", "w"), edge("e3", "w", "o")],
    );
    const errors = validateGraphForCompute(g);
    expect(kinds(errors)).toEqual(["w-self-loop", "w-output-count"]);
    expect(errors[1].message).toContain("got 1");
  });

  it("a W with two real input edges (no self-loop) is flagged for input count", () => {
    const g = graph(
      [node("w", "w"), node("i0", "input"), node("i1", "input"), node("o0", "output"), node("o1", "output")],
      [edge("e1", "i0", "w"), edge("e2", "i1", "w"), edge("e3", "w", "o0"), edge("e4", "w", "o1")],
    );
    const errors = validateGraphForCompute(g);
    expect(kinds(errors)).toEqual(["w-input-count"]);
    expect(errors[0].message).toContain("got 2");
  });

  // ---- vertex-not-found dedup, mixed existence ----

  it("reports a missing target once when source exists", () => {
    const g = graph([node("a", "z")], [edge("e1", "a", "ghost")]);
    const errors = validateGraphForCompute(g).filter((e) => e.kind === "vertex-not-found");
    expect(errors).toHaveLength(1);
    expect(errors[0].vertexId).toBe("ghost");
  });

  it("reports a missing source once when target exists", () => {
    const g = graph([node("a", "z")], [edge("e1", "ghost", "a")]);
    const errors = validateGraphForCompute(g).filter((e) => e.kind === "vertex-not-found");
    expect(errors).toHaveLength(1);
    expect(errors[0].vertexId).toBe("ghost");
  });

  it("reports both endpoints missing on a single edge (two distinct errors)", () => {
    const g = graph([], [edge("e1", "ghost1", "ghost2")]);
    const errors = validateGraphForCompute(g).filter((e) => e.kind === "vertex-not-found");
    expect(errors).toHaveLength(2);
    expect(errors.map((e) => e.vertexId).sort()).toEqual(["ghost1", "ghost2"]);
  });

  // ---- duplicate node id multiplicity ----

  it("flags a duplicated id once per extra occurrence (3 copies → 2 errors)", () => {
    // First "a" is the original; 2nd and 3rd are each flagged as duplicates.
    const g = graph([node("a", "z"), node("a", "z"), node("a", "z")], []);
    const errors = validateGraphForCompute(g).filter((e) => e.kind === "duplicate-node-id");
    expect(errors).toHaveLength(2);
    expect(errors.every((e) => e.vertexId === "a")).toBe(true);
  });

  it("flags each duplicated id independently when several ids repeat", () => {
    const g = graph(
      [node("a", "z"), node("a", "z"), node("b", "z"), node("b", "z"), node("b", "z")],
      [],
    );
    const errors = validateGraphForCompute(g).filter((e) => e.kind === "duplicate-node-id");
    // a duplicated once (1 error), b duplicated twice (2 errors) → 3 total.
    expect(errors).toHaveLength(3);
  });

  // ---- error ordering is deterministic ----

  it("returns errors in deterministic order: duplicates, then vertex-not-found, then structural", () => {
    // Construct a graph that triggers one of each category and pin the order.
    // - duplicate id "dup"
    // - vertex-not-found: edge refs "missing"
    // - structural: a W node "w" with 0 inputs and 0 outputs
    const g = graph(
      [
        node("dup", "z"),
        node("dup", "z"), // duplicate
        node("w", "w"), // bad W topology
      ],
      [edge("e1", "w", "missing")], // missing target "missing"; also makes w's output =1... but input=0 too
    );
    const errors = validateGraphForCompute(g);
    expect(errors.map((e) => e.kind)).toEqual([
      "duplicate-node-id",
      "vertex-not-found",
      "w-input-count",
      "w-output-count",
    ]);
  });

  it("emits structural errors in node-array order", () => {
    // Two W nodes, both invalid, in a specific order — errors follow node order.
    const g = graph(
      [node("wA", "w"), node("wB", "w"), node("o0", "output"), node("o1", "output")],
      [edge("e1", "wA", "o0"), edge("e2", "wB", "o1")],
    );
    const errors = validateGraphForCompute(g).filter((e) => e.kind === "w-input-count");
    expect(errors.map((e) => e.vertexId)).toEqual(["wA", "wB"]);
  });

  // ---- trivial graphs ----

  it("single z node with no edges is valid", () => {
    expect(validateGraphForCompute(graph([node("z", "z")], []))).toEqual([]);
  });

  it("single edge between two z nodes is valid", () => {
    const g = graph([node("z1", "z"), node("z2", "z")], [edge("e1", "z1", "z2")]);
    expect(validateGraphForCompute(g)).toEqual([]);
  });

  it("single boundary node with one edge to a z is valid (degree 1)", () => {
    const g = graph([node("i", "input"), node("z", "z")], [edge("e1", "i", "z")]);
    expect(validateGraphForCompute(g)).toEqual([]);
  });

  // ---- suspected bugs (failing-first) ----

  it("does not double up structural errors for a duplicated node id", () => {
    // Two node records share id "w"; the W has 0 inputs and 0 outputs. The
    // duplicate-node-id error already flags the duplication; the structural
    // checks should run once per distinct vertex, not once per record, so we
    // expect a single w-input-count and a single w-output-count (not two each).
    const g = graph([node("w", "w"), node("w", "w")], []);
    const errors = validateGraphForCompute(g);
    const dupes = errors.filter((e) => e.kind === "duplicate-node-id");
    const inErrs = errors.filter((e) => e.kind === "w-input-count");
    const outErrs = errors.filter((e) => e.kind === "w-output-count");
    expect(dupes).toHaveLength(1);
    expect(inErrs).toHaveLength(1);
    expect(outErrs).toHaveLength(1);
  });

  // ---- boundary order validation ----

  it("flags duplicate explicit orders within the same boundary group", () => {
    const g = graph([node("i0", "input", 0), node("i1", "input", 0)], []);
    const errors = validateGraphForCompute(g);
    expect(errors).toHaveLength(2);
    expect(errors.every((e) => e.kind === "boundary-order")).toBe(true);
    expect(errors.map((e) => e.vertexId).sort()).toEqual(["i0", "i1"]);
  });

  it("flags duplicate explicit orders in the output group", () => {
    const g = graph([node("o0", "output", 1), node("o1", "output", 1)], []);
    const errors = validateGraphForCompute(g).filter(
      (e) => e.kind === "boundary-order",
    );
    expect(errors).toHaveLength(2);
  });

  it("does not flag the same explicit order across different boundary groups", () => {
    // Inputs and outputs order independently; 0 in each group is fine.
    const g = graph(
      [node("i0", "input", 0), node("o0", "output", 0)],
      [],
    );
    expect(validateGraphForCompute(g)).toEqual([]);
  });

  it("flags orders that are not finite non-negative integers", () => {
    const g = graph(
      [
        node("a", "input", -1),
        node("b", "input", 1.5),
        node("c", "input", "x"),
        node("d", "output", Number.NaN),
      ],
      [],
    );
    const errors = validateGraphForCompute(g).filter(
      (e) => e.kind === "boundary-order",
    );
    expect(errors).toHaveLength(4);
    expect(errors.map((e) => e.vertexId)).toEqual(["a", "b", "c", "d"]);
  });

  it("does not flag absent orders (legacy docs fall back to array position)", () => {
    const g = graph(
      [node("i0", "input"), node("i1", "input"), node("o0", "output")],
      [],
    );
    expect(validateGraphForCompute(g)).toEqual([]);
  });

  it("flags an explicit order colliding with an order-less node's array position", () => {
    // i0's explicit order 2 equals i1's fallback key (index 2) — the
    // compute layer's axis sort would tie on the effective key.
    const g = graph(
      [node("i0", "input", 2), node("z", "z"), node("i1", "input")],
      [],
    );
    const errors = validateGraphForCompute(g).filter(
      (e) => e.kind === "boundary-order",
    );
    expect(errors).toHaveLength(2);
    expect(errors.map((e) => e.vertexId).sort()).toEqual(["i0", "i1"]);
  });

  it("does not flag distinct explicit orders", () => {
    const g = graph(
      [
        node("i0", "input", 0),
        node("i1", "input", 1),
        node("o0", "output", 1),
        node("o1", "output", 0),
      ],
      [],
    );
    expect(validateGraphForCompute(g)).toEqual([]);
  });

  it("order errors carry a message naming the vertex and order", () => {
    const g = graph([node("i0", "input", 0), node("i1", "input", 0)], []);
    const errors = validateGraphForCompute(g);
    const i1 = errors.find((e) => e.vertexId === "i1");
    expect(i1?.message).toContain("'i1'");
    expect(i1?.message).toContain("0");
  });
});
