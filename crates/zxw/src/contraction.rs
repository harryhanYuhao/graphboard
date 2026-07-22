// crates/zxw/src/contraction.rs
//
// Naive sequential contraction (plan §5). The algorithm walks `graph.edges`
// in input order, maintaining one `Group` per connected component via a
// union-find. Each group owns a `Tensor` (the running contraction of its
// members) plus a `free_axes` Vec that maps each axis of that tensor back
// to a specific leg of a specific member vertex — this is the invariant
// that makes non-symmetric tensors (H-box, future directional nodes)
// contract along the correct axis (§5.1).
//
// Boundary vertices (`input` / `output`) have no tensor; they declare
// open legs of the result. Their handling splits two ways:
//   - An edge from a boundary `b` to a tensor-vertex `v`: tag `v`'s
//     corresponding free axis with `b`'s role. No contraction happens.
//   - A boundary with no edges (degree 0): contributes an open axis of
//     value `[1, 0]` (a dangling basis state) — modelled by outer-
//     producting a length-2 identity tensor into the final result.
//
// Self-loops (edge from `v` to `v`) are supported via `Tensor::trace`
// (the user's locked decision, supersedes the earlier reject-policy).
//
// Disconnected components fall out of the union-find for free: vertices
// in separate components never union, so after the edge-walk each
// component's surviving group is one tensor. They're combined via
// `Tensor::outer_product` (§5.6).

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::error::ComputeError;
use crate::graph::{GraphSlice, VertexType};
use crate::nodes::build_vertex_tensor;
use crate::phase::parse_phase;
use crate::tensor::Tensor;

// ---- Types ------------------------------------------------------------------

/// Role of a free leg in the final result. Drives the §5.4 output
/// ordering: Input axes first, then Output axes, then Neutral (any
/// non-boundary leftover). Input/output counts also surface on
/// `TensorResult` for the UI's matrix interpretation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LegRole {
    Input,
    Output,
    Neutral,
}

/// One free leg of a group tensor. `node_order` is the vertex's index in
/// `graph.nodes` (used for the stable sort at the end); `leg_index` is
/// the leg's position within the original vertex (0..arity). The group
/// tensor's axis `i` corresponds to `free_axes[i]`.
#[derive(Debug, Clone, Copy)]
struct FreeAxis {
    node_order: usize,
    leg_index: usize,
    role: LegRole,
}

/// A running contraction. Lives in a `HashMap<representative_id, Group>`
/// keyed by the union-find representative of the component.
struct Group {
    tensor: Tensor,
    free_axes: Vec<FreeAxis>,
}

/// Pick the position of a free leg in `axes` belonging to vertex
/// `node_order`, preferring Neutral over boundary-tagged legs. Returns
/// `None` if no leg of that vertex is free.
///
/// Why prefer Neutral: when a vertex has both a boundary-tagged leg
/// (e.g. `Output` — destined to become a result axis) and an
/// untagged leg connected to another tensor-vertex, an inter-tensor
/// contraction must consume the untagged one. Otherwise the boundary
/// tag would be lost inside the contraction and the boundary's
/// `output_count`/`input_count` would silently drop.
fn pick_free_axis_for_vertex(axes: &[FreeAxis], node_order: usize) -> Option<usize> {
    // First pass: Neutral leg of this vertex.
    axes.iter()
        .position(|fa| fa.node_order == node_order && fa.role == LegRole::Neutral)
        // Second pass: any leg of this vertex (boundary-tagged fallback).
        .or_else(|| axes.iter().position(|fa| fa.node_order == node_order))
}

/// A boundary vertex awaiting attachment (via an edge) or surviving as a
/// dangling open leg (degree 0).
struct PendingBoundary {
    /// Index in `graph.nodes` — used for the final ordering.
    node_order: usize,
    role: LegRole,
    /// The other endpoint of the boundary's edge, if it has one. None =
    /// degree 0 (dangling). Once attached, the boundary's role is
    /// stamped onto the corresponding `FreeAxis` of its neighbour's
    /// group during the edge walk.
    neighbour_id: Option<String>,
}

/// Top-level result of `compute_tensor`. Shape + flat complex data +
/// per-spider parse warnings + boundary counts (the UI displays the
/// rank-(n+m) tensor as a 2^n × 2^m matrix; n = `input_count`,
/// m = `output_count`). Zero boundaries → scalar.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TensorResult {
    pub shape: Vec<usize>,
    pub data: Vec<(f64, f64)>,
    pub warnings: Vec<String>,
    pub input_count: usize,
    pub output_count: usize,
}

// ---- Public entry point -----------------------------------------------------

/// Build per-vertex tensors, contract along `graph.edges`, return the
/// resulting tensor (or a structural `ComputeError`).
///
/// `on_progress`, if `Some`, is invoked after each edge is contracted
/// with `(edges_done, total_edges)`. The Phase 5 WASM bridge wraps a JS
/// callback into this closure; native tests pass `None`.
pub fn compute_tensor(
    graph: &GraphSlice,
    on_progress: Option<&dyn Fn(usize, usize)>,
) -> Result<TensorResult, ComputeError> {
    // Phase A — empty graph is the scalar multiplicative identity (§5.6).
    if graph.nodes.is_empty() {
        return Ok(TensorResult {
            shape: vec![],
            data: vec![(1.0, 0.0)],
            warnings: vec![],
            input_count: 0,
            output_count: 0,
        });
    }

    // Map vertex id → (node_order, vertex_type, label). Looked up by the
    // edge walk; built once up front so edges referencing unknown ids
    // surface as VertexNotFound before we touch any tensor.
    let mut node_index: HashMap<String, (usize, VertexType, String)> = HashMap::new();
    for (i, node) in graph.nodes.iter().enumerate() {
        node_index.insert(
            node.id.clone(),
            (i, node.data.vertex_type, node.data.label.clone()),
        );
    }

    // Degree per vertex (count of edges incident, self-loops counted
    // twice — they consume two legs). Used for: arity assignment,
    // boundary degree check, H-box arity check.
    let mut degree: HashMap<String, usize> = HashMap::new();
    for edge in &graph.edges {
        if edge.source == edge.target {
            *degree.entry(edge.source.clone()).or_insert(0) += 2;
        } else {
            *degree.entry(edge.source.clone()).or_insert(0) += 1;
            *degree.entry(edge.target.clone()).or_insert(0) += 1;
        }
    }

    // Phase B — validate, build initial groups, collect pending boundaries.
    let mut warnings: Vec<String> = Vec::new();
    let mut groups: HashMap<String, Group> = HashMap::new();
    let mut pending_boundaries: Vec<PendingBoundary> = Vec::new();

    for (i, node) in graph.nodes.iter().enumerate() {
        let id = &node.id;
        let vt = node.data.vertex_type;
        let label = &node.data.label;
        let deg = *degree.get(id).unwrap_or(&0);

        // Boundary handling — never builds a tensor.
        if matches!(vt, VertexType::Input | VertexType::Output) {
            if deg > 1 {
                return Err(ComputeError::BoundaryDegreeViolation {
                    vertex_id: id.clone(),
                    degree: deg,
                });
            }
            let role = if vt == VertexType::Input {
                LegRole::Input
            } else {
                LegRole::Output
            };
            pending_boundaries.push(PendingBoundary {
                node_order: i,
                role,
                neighbour_id: None, // filled in by edge walk if degree 1
            });
            continue;
        }

        // H-box fixed arity.
        if vt == VertexType::H && deg != 2 {
            return Err(ComputeError::HBoxArity {
                vertex_id: id.clone(),
                arity: deg,
            });
        }

        // Phase-parse the label for spider/box types (§5.5). Errors are
        // downgraded to warnings + phase 0 — don't fail the whole
        // computation over one unparseable label.
        let phase = if matches!(
            vt,
            VertexType::Z | VertexType::X | VertexType::Zbox | VertexType::Xbox
        ) {
            match parse_phase(label) {
                Ok(p) => p,
                Err(e) => {
                    warnings.push(format!(
                        "vertex '{id}' label '{label}' parse failed ({e}); using phase 0"
                    ));
                    0.0
                }
            }
        } else {
            0.0
        };

        let tensor = build_vertex_tensor(vt, deg, phase).expect(
            "non-boundary vertex type must build a tensor (build_vertex_tensor \
             only returns None for Input/Output, handled above)",
        );
        let free_axes: Vec<FreeAxis> = (0..deg)
            .map(|leg| FreeAxis {
                node_order: i,
                leg_index: leg,
                role: LegRole::Neutral,
            })
            .collect();
        groups.insert(
            id.clone(),
            Group {
                tensor,
                free_axes,
            },
        );
    }

    // Phase C — union-find + edge walk.
    // The union-find indexes by `node_order` (0..graph.nodes.len()); a
    // boundary's "index" never participates in unions (boundaries have
    // no group), so we map vertex ids to indices but skip boundaries.
    let id_to_order: HashMap<String, usize> = graph
        .nodes
        .iter()
        .enumerate()
        .map(|(i, n)| (n.id.clone(), i))
        .collect();
    let mut uf = UnionFind::new(graph.nodes.len());

    // Track which group each representative id maps to. As unions
    // happen, the surviving representative keeps the merged Group; the
    // loser's entry is removed from `groups` and its id is remapped.
    // We resolve "which group owns vertex v right now?" via
    // `uf.find(node_order(v))` → representative order → id_of(rep_order).
    let order_to_id: Vec<String> = graph.nodes.iter().map(|n| n.id.clone()).collect();

    let total_edges = graph.edges.len();
    for (edge_i, edge) in graph.edges.iter().enumerate() {
        // Validate edge endpoints exist before doing anything else — a
        // corrupt payload (an edge referencing a vertex not in `nodes`)
        // must surface as VertexNotFound, not a HashMap panic.
        if !node_index.contains_key(&edge.source) {
            return Err(ComputeError::VertexNotFound {
                vertex_id: edge.source.clone(),
                edge_id: edge.id.clone(),
            });
        }
        if !node_index.contains_key(&edge.target) {
            return Err(ComputeError::VertexNotFound {
                vertex_id: edge.target.clone(),
                edge_id: edge.id.clone(),
            });
        }

        let src_is_boundary = matches!(
            node_index.get(&edge.source).map(|(_, t, _)| *t),
            Some(VertexType::Input) | Some(VertexType::Output)
        );
        let tgt_is_boundary = matches!(
            node_index.get(&edge.target).map(|(_, t, _)| *t),
            Some(VertexType::Input) | Some(VertexType::Output)
        );

        if edge.source == edge.target {
            // Self-loop on a single vertex → trace two free legs of its
            // group's tensor. (Boundaries can't self-loop — a boundary
            // with degree > 1 is already rejected above.)
            let order = id_to_order[&edge.source];
            let rep_order = uf.find(order);
            let rep_id = &order_to_id[rep_order];
            let group = groups
                .get_mut(rep_id)
                .expect("self-loop vertex must have a group");
            // Need two free legs to trace.
            if group.free_axes.len() < 2 {
                let (_, vt, _) = &node_index[&edge.source];
                return Err(ComputeError::DegreeOverflow {
                    vertex_id: edge.source.clone(),
                    vertex_type: *vt,
                    degree: *degree.get(&edge.source).unwrap_or(&0),
                    max: group.free_axes.len(),
                });
            }
            // Pop two free legs (any two — the tensor is symmetric
            // across legs for the generators that admit self-loops in
            // v1 graphs; H-box is arity 2 so trace is over both axes).
            let axis_a = group.free_axes.len() - 1;
            let axis_b = group.free_axes.len() - 2;
            // `trace` takes `self` by value; swap the tensor out of the
            // group with a placeholder, trace, then write the result back.
            let tensor = std::mem::replace(
                &mut group.tensor,
                Tensor::scalar(num_complex::Complex::new(0.0, 0.0)),
            );
            group.tensor = tensor.trace(axis_a, axis_b);
            // Remove the two consumed axes. Order matters for the
            // remaining axis positions: drop the higher index first so
            // the lower index is still valid.
            group.free_axes.remove(axis_a);
            group.free_axes.remove(axis_b);
        } else if src_is_boundary || tgt_is_boundary {
            // Edge between a boundary and a tensor-vertex. No
            // contraction — just tag the tensor-vertex's free leg with
            // the boundary's role. The boundary has exactly one free
            // leg (degree ≤ 1 enforced above), and that "leg" is really
            // the one on the tensor-vertex side.
            let (boundary_id, tensor_id) = if src_is_boundary {
                (&edge.source, &edge.target)
            } else {
                (&edge.target, &edge.source)
            };
            let boundary_role = match node_index[boundary_id].1 {
                VertexType::Input => LegRole::Input,
                VertexType::Output => LegRole::Output,
                _ => unreachable!("checked src_is_boundary/tgt_is_boundary above"),
            };
            // Record the boundary's neighbour for the degree-1 case so
            // dangling detection at the end knows it was attached.
            for pb in pending_boundaries.iter_mut() {
                if order_to_id[pb.node_order] == *boundary_id {
                    pb.neighbour_id = Some(tensor_id.clone());
                }
            }

            // Tag the tensor-vertex's earliest untagged free leg.
            let order = id_to_order[tensor_id];
            let rep_order = uf.find(order);
            let rep_id = &order_to_id[rep_order];
            let group = groups
                .get_mut(rep_id)
                .expect("tensor endpoint of a boundary edge must have a group");
            let target_node_order = id_to_order[tensor_id];
            let leg_to_tag = group
                .free_axes
                .iter_mut()
                .find(|fa| fa.node_order == target_node_order && fa.role == LegRole::Neutral)
                .expect(
                    "boundary edge endpoint must have a free leg to tag — \
                     degree-overflow should have fired earlier",
                );
            leg_to_tag.role = boundary_role;
        } else {
            // Normal edge between two tensor-vertices → contract.
            let src_order = id_to_order[&edge.source];
            let tgt_order = id_to_order[&edge.target];
            let src_rep = uf.find(src_order);
            let tgt_rep = uf.find(tgt_order);

            if src_rep == tgt_rep {
                // Same group already — this is a multi-edge or trace
                // within one group. Contract two free legs of the same
                // group tensor along the picked axes.
                let rep_id = &order_to_id[src_rep];
                let group = groups.get_mut(rep_id).expect("group must exist");
                if group.free_axes.len() < 2 {
                    let (_, vt, _) = &node_index[&edge.source];
                    return Err(ComputeError::DegreeOverflow {
                        vertex_id: edge.source.clone(),
                        vertex_type: *vt,
                        degree: *degree.get(&edge.source).unwrap_or(&0),
                        max: group.free_axes.len(),
                    });
                }
                // Find one free leg belonging to src and one to tgt.
                // Prefer Neutral legs so a boundary-tagged leg (Input /
                // Output) stays free and reaches the result — otherwise
                // a later boundary edge would have no leg to tag.
                let pos_src = pick_free_axis_for_vertex(&group.free_axes, src_order)
                    .ok_or_else(|| ComputeError::DegreeOverflow {
                        vertex_id: edge.source.clone(),
                        vertex_type: node_index[&edge.source].1,
                        degree: *degree.get(&edge.source).unwrap_or(&0),
                        max: 0,
                    })?;
                let pos_tgt = pick_free_axis_for_vertex(&group.free_axes, tgt_order)
                    .ok_or_else(|| ComputeError::DegreeOverflow {
                        vertex_id: edge.target.clone(),
                        vertex_type: node_index[&edge.target].1,
                        degree: *degree.get(&edge.target).unwrap_or(&0),
                        max: 0,
                    })?;
                // Contract over the two axes (use trace since both live
                // in the same tensor). Ensure pos_src != pos_tgt — they
                // are different legs by construction.
                let (hi, lo) = if pos_src > pos_tgt {
                    (pos_src, pos_tgt)
                } else {
                    (pos_tgt, pos_src)
                };
                let tensor = std::mem::replace(
                    &mut group.tensor,
                    Tensor::scalar(num_complex::Complex::new(0.0, 0.0)),
                );
                group.tensor = tensor.trace(lo, hi);
                group.free_axes.remove(hi);
                group.free_axes.remove(lo);
            } else {
                // Different groups — contract group_src's chosen axis
                // with group_tgt's chosen axis, then union.
                // Take possession of both groups' tensors by removing
                // them from the map (the surviving rep gets put back).
                let src_id = order_to_id[src_rep].clone();
                let tgt_id = order_to_id[tgt_rep].clone();
                let group_src = groups
                    .remove(&src_id)
                    .expect("src group must exist before contract");
                let group_tgt = groups
                    .remove(&tgt_id)
                    .expect("tgt group must exist before contract");

                // Find the position of src's and tgt's free legs in
                // their respective groups. Prefer Neutral legs (see
                // pick_free_axis_for_vertex rationale).
                let pos_src = pick_free_axis_for_vertex(&group_src.free_axes, src_order)
                    .expect("src endpoint must have a free leg in its group");
                let pos_tgt = pick_free_axis_for_vertex(&group_tgt.free_axes, tgt_order)
                    .expect("tgt endpoint must have a free leg in its group");

                let contracted = group_src.tensor.contract(group_tgt.tensor, pos_src, pos_tgt);
                // Concatenate free_axes: src's remainder, then tgt's
                // remainder (matches contract's [A_free, B_free] order).
                let mut merged_free_axes: Vec<FreeAxis> = Vec::with_capacity(
                    group_src.free_axes.len() - 1 + group_tgt.free_axes.len() - 1,
                );
                for (i, fa) in group_src.free_axes.iter().enumerate() {
                    if i != pos_src {
                        merged_free_axes.push(*fa);
                    }
                }
                for (i, fa) in group_tgt.free_axes.iter().enumerate() {
                    if i != pos_tgt {
                        merged_free_axes.push(*fa);
                    }
                }

                // Union: tgt's group becomes part of src's group. The
                // src representative owns the merged tensor.
                uf.union(src_rep, tgt_rep);
                let new_rep = uf.find(src_rep);
                let new_rep_id = order_to_id[new_rep].clone();
                groups.insert(
                    new_rep_id,
                    Group {
                        tensor: contracted,
                        free_axes: merged_free_axes,
                    },
                );
            }
        }

        if let Some(cb) = on_progress {
            cb(edge_i + 1, total_edges);
        }
    }

    // Phase D — reduce disconnected components via outer_product.
    // Collect surviving groups (one per connected component of non-
    // boundary vertices). Sort by min node_order in each group so the
    // outer-product order is deterministic and matches `graph.nodes`.
    let mut surviving: Vec<(usize, Group)> = groups
        .into_iter()
        .map(|(id, g)| {
            let min_order = g.free_axes.iter().map(|fa| fa.node_order).min().unwrap_or(
                id_to_order[&id], // group with no free legs — use the rep's order
            );
            (min_order, g)
        })
        .collect();
    surviving.sort_by_key(|(order, _)| *order);

    let mut combined: Option<Tensor> = None;
    let mut combined_free_axes: Vec<FreeAxis> = Vec::new();
    for (_, g) in surviving {
        combined = Some(match combined {
            None => g.tensor,
            Some(prev) => prev.outer_product(g.tensor),
        });
        combined_free_axes.extend(g.free_axes);
    }

    // Add dangling boundaries (degree 0) as outer-producted length-2
    // identity tensors. Their axis gets the boundary's role and the
    // dangling value `[1, 0]` — a fixed basis state.
    let mut dangling_input_count = 0usize;
    let mut dangling_output_count = 0usize;
    for pb in &pending_boundaries {
        if pb.neighbour_id.is_some() {
            continue; // was attached during the edge walk
        }
        // A dangling boundary contributes one open axis of value [1, 0].
        let mut dangling = Tensor::zeros(&[2]);
        *dangling.get_mut(&[0]) = num_complex::Complex::new(1.0, 0.0);
        combined = Some(match combined {
            None => dangling,
            Some(prev) => prev.outer_product(dangling),
        });
        combined_free_axes.push(FreeAxis {
            node_order: pb.node_order,
            leg_index: 0,
            role: pb.role,
        });
        match pb.role {
            LegRole::Input => dangling_input_count += 1,
            LegRole::Output => dangling_output_count += 1,
            LegRole::Neutral => {}
        }
    }

    // Phase E — §5.4 final partition. Stable-sort by role (Input first,
    // then Output, then Neutral); within each role, by node_order then
    // leg_index. Apply the same permutation to the tensor data.
    let mut indexed: Vec<(usize, FreeAxis)> = combined_free_axes
        .into_iter()
        .enumerate()
        .collect();
    indexed.sort_by(|a, b| {
        let role_rank = |r: LegRole| match r {
            LegRole::Input => 0,
            LegRole::Output => 1,
            LegRole::Neutral => 2,
        };
        role_rank(a.1.role)
            .cmp(&role_rank(b.1.role))
            .then(a.1.node_order.cmp(&b.1.node_order))
            .then(a.1.leg_index.cmp(&b.1.leg_index))
    });
    let perm: Vec<usize> = indexed.iter().map(|(orig, _)| *orig).collect();
    let final_axes: Vec<FreeAxis> = indexed.iter().map(|(_, fa)| *fa).collect();

    let input_count = final_axes
        .iter()
        .filter(|fa| fa.role == LegRole::Input)
        .count();
    let output_count = final_axes
        .iter()
        .filter(|fa| fa.role == LegRole::Output)
        .count();

    // Apply the role partition to the tensor. (No-op if the permutation
    // is already identity, e.g. for a fully-contracted scalar.)
    let result_tensor = match combined {
        None => {
            // No nodes survived (only boundaries, all attached). This
            // shouldn't normally happen — a graph with at least one
            // tensor-vertex always leaves a group — but defend anyway.
            Tensor::scalar(num_complex::Complex::new(1.0, 0.0))
        }
        Some(t) => {
            if t.rank() == 0 {
                t
            } else {
                t.permuted_axes(&perm)
            }
        }
    };

    // Phase F — flatten to TensorResult.
    let shape: Vec<usize> = result_tensor.shape().to_vec();
    let total: usize = shape.iter().product::<usize>().max(1);
    let mut data: Vec<(f64, f64)> = Vec::with_capacity(total);
    if shape.is_empty() {
        let v = result_tensor.get(&[]);
        data.push((v.re, v.im));
    } else {
        // Enumerate every multi-index in row-major order.
        let mut idx: Vec<usize> = vec![0; shape.len()];
        for _ in 0..total {
            let v = result_tensor.get(&idx);
            data.push((v.re, v.im));
            // Increment row-major counter.
            for axis in (0..shape.len()).rev() {
                idx[axis] += 1;
                if idx[axis] < shape[axis] {
                    break;
                }
                idx[axis] = 0;
            }
        }
    }

    let _ = dangling_input_count; // already counted via final_axes
    let _ = dangling_output_count;

    Ok(TensorResult {
        shape,
        data,
        warnings,
        input_count,
        output_count,
    })
}

// ---- Union-find (hand-rolled, plan §3.3) -----------------------------------
//
// Path compression + union-by-rank. ~25 lines; intentionally not pulled
// from a crate — see plan §3.3 for the buy-vs-build rationale.

struct UnionFind {
    parent: Vec<usize>,
    rank: Vec<u8>,
}

impl UnionFind {
    fn new(n: usize) -> Self {
        UnionFind {
            parent: (0..n).collect(),
            rank: vec![0; n],
        }
    }

    fn find(&mut self, mut x: usize) -> usize {
        while self.parent[x] != x {
            // Path compression: point at the grandparent.
            self.parent[x] = self.parent[self.parent[x]];
            x = self.parent[x];
        }
        x
    }

    fn union(&mut self, a: usize, b: usize) {
        let mut ra = self.find(a);
        let mut rb = self.find(b);
        if ra == rb {
            return;
        }
        // Attach the shorter tree under the taller one.
        if self.rank[ra] < self.rank[rb] {
            std::mem::swap(&mut ra, &mut rb);
        }
        self.parent[rb] = ra;
        if self.rank[ra] == self.rank[rb] {
            self.rank[ra] += 1;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::graph::{GraphEdgeRecord, GraphNodeRecord, VertexData};

    /// Build a `GraphSlice` quickly from `(id, type, label)` tuples +
    /// `(id, src, tgt)` edge tuples. Keeps test bodies focused on the
    /// behavior under test, not the wire format.
    fn graph(
        nodes: &[(&str, VertexType, &str)],
        edges: &[(&str, &str, &str)],
    ) -> GraphSlice {
        GraphSlice {
            nodes: nodes
                .iter()
                .map(|(id, vt, label)| GraphNodeRecord {
                    id: (*id).into(),
                    data: VertexData {
                        label: (*label).into(),
                        vertex_type: *vt,
                    },
                })
                .collect(),
            edges: edges
                .iter()
                .map(|(id, src, tgt)| GraphEdgeRecord {
                    id: (*id).into(),
                    source: (*src).into(),
                    target: (*tgt).into(),
                    source_handle: None,
                    target_handle: None,
                })
                .collect(),
        }
    }

    // ---- §5.5 label-parse fallback -----------------------------------------

    #[test]
    fn unparseable_spider_label_yields_warning_and_phase_zero() {
        // A spider label that fails to parse should NOT fail the
        // computation — it's downgraded to a warning + phase 0
        // substitution (plan §5.5). With phase 0 on an isolated
        // z spider (arity 0), the scalar value is 1 + e^{i·0} = 2.
        let g = graph(
            &[("z", VertexType::Z, "totally not a phase")],
            &[],
        );
        let result = compute_tensor(&g, None).expect("parse failure must not fail compute");
        assert_eq!(result.data.len(), 1);
        assert!((result.data[0].0 - 2.0).abs() < 1e-10, "phase 0 → 1+1 = 2");
        assert_eq!(
            result.warnings.len(),
            1,
            "exactly one warning for the one bad label"
        );
        let w = &result.warnings[0].to_lowercase();
        assert!(w.contains("parse"), "warning should mention parse: {w}");
        assert!(w.contains('z'), "warning should name the vertex: {w}");
    }

    #[test]
    fn multiple_bad_labels_each_get_their_own_warning() {
        // Two spiders, both with unparseable labels → two warnings.
        let g = graph(
            &[("a", VertexType::Z, "foo"), ("b", VertexType::X, "bar")],
            &[],
        );
        let result = compute_tensor(&g, None).expect("compute should succeed");
        assert_eq!(result.warnings.len(), 2);
    }

    #[test]
    fn non_spider_bad_label_is_silently_ignored() {
        // H / W / AND / empty labels are decoration only — a bad label
        // on them produces NO warning (plan §5.5). Use `empty` (no
        // arity constraint, degree 0 is fine) so we don't trip the
        // H-box arity-2 check.
        let g = graph(
            &[("e", VertexType::Empty, "this is not parsed")],
            &[],
        );
        let result = compute_tensor(&g, None).expect("compute should succeed");
        assert!(
            result.warnings.is_empty(),
            "non-spider labels must not warn: {:?}",
            result.warnings
        );
    }

    // ---- ComputeError paths ------------------------------------------------

    #[test]
    fn edge_to_unknown_vertex_returns_vertex_not_found() {
        // Edge references id "ghost" that's not in `nodes`. Must
        // surface as VertexNotFound, not a panic.
        let g = graph(&[("a", VertexType::Z, "")], &[("e", "a", "ghost")]);
        let err = compute_tensor(&g, None).expect_err("unknown vertex must error");
        match err {
            ComputeError::VertexNotFound { vertex_id, edge_id } => {
                assert_eq!(vertex_id, "ghost");
                assert_eq!(edge_id, "e");
            }
            other => panic!("expected VertexNotFound, got {other:?}"),
        }
    }

    #[test]
    fn progress_callback_fires_per_edge() {
        // Two edges → callback fires twice with (1, 2) and (2, 2).
        let g = graph(
            &[
                ("z1", VertexType::Z, ""),
                ("z2", VertexType::Z, ""),
                ("z3", VertexType::Z, ""),
            ],
            &[("e1", "z1", "z2"), ("e2", "z2", "z3")],
        );
        let calls = std::cell::RefCell::new(Vec::<(usize, usize)>::new());
        let cb = |done: usize, total: usize| {
            calls.borrow_mut().push((done, total));
        };
        let _ = compute_tensor(&g, Some(&cb)).unwrap();
        let calls = calls.into_inner();
        assert_eq!(calls, vec![(1, 2), (2, 2)]);
    }

    // ---- UnionFind behavior (defensive) ------------------------------------

    #[test]
    fn union_find_union_then_find_reports_same_root() {
        let mut uf = UnionFind::new(5);
        uf.union(0, 1);
        uf.union(2, 3);
        uf.union(1, 3); // connects {0,1} with {2,3}
        assert_eq!(uf.find(0), uf.find(1));
        assert_eq!(uf.find(0), uf.find(2));
        assert_eq!(uf.find(0), uf.find(3));
        assert_ne!(uf.find(0), uf.find(4), "vertex 4 stays separate");
    }

    #[test]
    fn union_find_idempotent_union() {
        let mut uf = UnionFind::new(3);
        uf.union(0, 1);
        let root_after_first = uf.find(0);
        uf.union(0, 1); // duplicate
        assert_eq!(uf.find(0), root_after_first);
    }
}
