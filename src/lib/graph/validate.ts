// Pre-compute structural validation. Runs on the frontend right before
// the WASM contraction, catching graph-shape errors (bad W topology,
// boundary degree, H-box arity, dangling edge refs, duplicate ids) so the
// user gets immediate feedback without a worker round-trip.
//
// These checks were ported from the Rust `ComputeError` variants — the
// messages match so the dialog's remediation hints stay consistent.
// `DegreeOverflow` stays backend-only (fires during contraction on
// intermediate state, not pre-checkable).

import type { GraphSlice } from "./types";

/** Discriminated kind for a pre-compute validation error. */
export type ValidationErrorKind =
  | "duplicate-node-id"
  | "vertex-not-found"
  | "boundary-degree"
  | "h-box-arity"
  | "w-input-count"
  | "w-output-count";

export type ValidationError = {
  kind: ValidationErrorKind;
  message: string;
  /** The offending vertex id (all current kinds have one). Absent for
   *  errors that aren't tied to a specific node. */
  vertexId?: string;
};

/** Validate a graph before compute. Returns all errors found (empty = ok). */
export function validateGraphForCompute(graph: GraphSlice): ValidationError[] {
  const errors: ValidationError[] = [];

  // --- duplicate node ids ---
  const seen = new Set<string>();
  for (const node of graph.nodes) {
    if (seen.has(node.id)) {
      errors.push({
        kind: "duplicate-node-id",
        message: `duplicate node id '${node.id}'`,
        vertexId: node.id,
      });
    }
    seen.add(node.id);
  }

  // Degree per node (self-loops count twice) — used by several checks.
  const degree = new Map<string, number>();
  for (const edge of graph.edges) {
    if (edge.source === edge.target) {
      degree.set(edge.source, (degree.get(edge.source) ?? 0) + 2);
    } else {
      degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
      degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
    }
  }

  // --- vertex-not-found (edge refs a node not in nodes) ---
  // One error per distinct missing vertex, citing the first edge that
  // references it. (A self-loop on a missing vertex or two edges sharing a
  // missing endpoint would otherwise be reported 2x / 4x.)
  const reportedMissing = new Set<string>();
  for (const edge of graph.edges) {
    for (const endpoint of [edge.source, edge.target]) {
      if (!seen.has(endpoint) && !reportedMissing.has(endpoint)) {
        reportedMissing.add(endpoint);
        errors.push({
          kind: "vertex-not-found",
          message: `vertex '${endpoint}' not found (referenced by edge '${edge.id}')`,
          vertexId: endpoint,
        });
      }
    }
  }

  // --- per-node structural checks ---
  for (const node of graph.nodes) {
    const id = node.id;
    const vt = node.data.vertexType;
    const deg = degree.get(id) ?? 0;

    // Boundary degree: input/output must be 0 or 1.
    if ((vt === "input" || vt === "output") && deg > 1) {
      errors.push({
        kind: "boundary-degree",
        message: `boundary vertex '${id}' has degree ${deg}; boundaries must have degree 0 or 1`,
        vertexId: id,
      });
      continue; // boundary is invalid; skip other checks for it
    }

    // H-box fixed arity 2.
    if (vt === "h" && deg !== 2) {
      errors.push({
        kind: "h-box-arity",
        message: `H-box vertex '${id}' must have arity 2, got ${deg}`,
        vertexId: id,
      });
    }

    // W node: exactly 1 input edge (targets it), ≥ 2 output edges (sources it).
    if (vt === "w") {
      let inputEdges = 0;
      let outputEdges = 0;
      for (const edge of graph.edges) {
        if (edge.source === id && edge.target === id) {
          outputEdges += 2; // self-loop: ill-defined for W
        } else if (edge.target === id) {
          inputEdges += 1;
        } else if (edge.source === id) {
          outputEdges += 1;
        }
      }
      if (inputEdges !== 1) {
        errors.push({
          kind: "w-input-count",
          message: `W node '${id}' must have exactly 1 input leg, got ${inputEdges}`,
          vertexId: id,
        });
      }
      if (outputEdges < 2) {
        errors.push({
          kind: "w-output-count",
          message: `W node '${id}' must have at least 2 output legs, got ${outputEdges}`,
          vertexId: id,
        });
      }
    }
  }

  return errors;
}
