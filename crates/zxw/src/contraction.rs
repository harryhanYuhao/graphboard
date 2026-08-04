// crates/zxw/src/contraction.rs
//
// Naive sequential contraction (plan §5). Walks `graph.edges` in input
// order, keeping one `Group` per connected component (union-find). Each
// group holds a `Tensor` plus `free_axes`, which maps each axis back to a
// specific leg of a specific vertex — the invariant that lets
// non-symmetric tensors (H-box, directional W) contract along the right
// axis.
//
// `compute_tensor` is a thin orchestrator calling one function per phase
// (A–F). The edge walk's three branches live in the private `edge`
// submodule at the bottom.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::error::ComputeError;
use crate::graph::{FrontendGraphSlice, VertexType};
use crate::nodes::build_vertex_tensor;
use crate::phase::parse_phase;
use crate::tensor::Tensor;

// ---- Types ------------------------------------------------------------------

/// Role of a free leg. Drives §5.4 output ordering: Input axes first,
/// then Output, then Neutral.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LegRole {
    Input,
    Output,
    Neutral,
}

/// One free leg of a group tensor. The group tensor's axis `i` corresponds
/// to `free_axes[i]`. `node_order` matches the leg back to its vertex during
/// the edge walk; `sort_key` is the value Phase E ranks axes by (boundary
/// `order` if tagged, else the vertex's `order.unwrap_or(array position)`.
/// Storing the resolved key here lets a boundary's `order` drive axis order
/// even though the leg lives on the neighbouring tensor-vertex.
#[derive(Debug, Clone, Copy)]
struct FreeAxis {
    node_order: usize,
    leg_index: usize,
    role: LegRole,
    sort_key: u32,
}

/// A running contraction, keyed by union-find representative id.
struct Group {
    tensor: Tensor,
    free_axes: Vec<FreeAxis>,
}

/// Which side of an edge a vertex is on, for directional leg picking.
#[derive(Clone, Copy)]
enum AxisRole {
    Source,
    Target,
}

/// A boundary vertex awaiting attachment, or a dangling (degree-0) open leg.
struct PendingBoundary {
    node_order: usize,
    role: LegRole,
    /// The boundary's edge endpoint, if attached (degree 1).
    neighbour_id: Option<String>,
}

/// Map a boundary `VertexType` to its result-leg role.
fn boundary_role(vt: VertexType) -> LegRole {
    match vt {
        VertexType::Input => LegRole::Input,
        VertexType::Output => LegRole::Output,
        _ => unreachable!("boundary_role only called on boundary vertices"),
    }
}

/// Result of `compute_tensor`. The UI displays the rank-(n+m) tensor as a
/// 2^n × 2^m matrix (n = `input_count`, m = `output_count`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TensorResult {
    pub shape: Vec<usize>,
    pub data: Vec<(f64, f64)>,
    pub warnings: Vec<String>,
    pub input_count: usize,
    pub output_count: usize,
}

// ---- Graph context (Phase A lookup tables, built once) ---------------------

/// Read-only graph context built once and shared across every phase.
struct GraphCtx<'a> {
    graph: &'a FrontendGraphSlice,
    /// vertex id → (node_order, vertex_type, label). Duplicate ids rejected
    /// at build time.
    node_index: HashMap<String, (usize, VertexType, String)>,
    /// Per-vertex sort key: explicit `order`, else array position.
    order_key: Vec<u32>,
    /// Edges incident per vertex (self-loops count twice).
    degree: HashMap<String, usize>,
    id_to_order: HashMap<String, usize>,
    order_to_id: Vec<String>,
}

impl<'a> GraphCtx<'a> {
    fn build(graph: &'a FrontendGraphSlice) -> Result<Self, ComputeError> {
        // Precondition: the frontend validated the graph (no duplicate ids,
        // no dangling edge refs, valid W/H/boundary topology) before
        // calling compute. We don't re-check here; a malformed graph would
        // produce a wrong result rather than a clean error.
        let mut node_index: HashMap<String, (usize, VertexType, String)> = HashMap::new();
        for (i, node) in graph.nodes.iter().enumerate() {
            node_index.insert(
                node.id.clone(),
                (i, node.data.vertex_type, node.data.label.clone()),
            );
        }

        let order_key: Vec<u32> = graph
            .nodes
            .iter()
            .enumerate()
            .map(|(i, node)| node.data.order.unwrap_or(i as u32))
            .collect();

        let mut degree: HashMap<String, usize> = HashMap::new();
        for edge in &graph.edges {
            if edge.source == edge.target {
                *degree.entry(edge.source.clone()).or_insert(0) += 2;
            } else {
                *degree.entry(edge.source.clone()).or_insert(0) += 1;
                *degree.entry(edge.target.clone()).or_insert(0) += 1;
            }
        }

        let id_to_order: HashMap<String, usize> = graph
            .nodes
            .iter()
            .enumerate()
            .map(|(i, n)| (n.id.clone(), i))
            .collect();
        let order_to_id: Vec<String> = graph.nodes.iter().map(|n| n.id.clone()).collect();

        Ok(GraphCtx {
            graph,
            node_index,
            order_key,
            degree,
            id_to_order,
            order_to_id,
        })
    }

    fn is_boundary(&self, id: &str) -> bool {
        matches!(
            self.node_index.get(id).map(|(_, t, _)| *t),
            Some(VertexType::Input) | Some(VertexType::Output)
        )
    }

    fn vertex_type(&self, id: &str) -> VertexType {
        self.node_index[id].1
    }
}

// ---- Leg-picking helpers ----------------------------------------------------

/// Pick the free-axis position belonging to `node_order`, preferring
/// Neutral over boundary-tagged legs. Preferring Neutral keeps a
/// boundary-tagged leg free so it reaches the result.
fn pick_free_axis_for_vertex(axes: &[FreeAxis], node_order: usize) -> Option<usize> {
    axes.iter()
        .position(|fa| fa.node_order == node_order && fa.role == LegRole::Neutral)
        .or_else(|| axes.iter().position(|fa| fa.node_order == node_order))
}

/// Pick the free-axis position for a contraction, directional-aware.
///
/// Symmetric vertices: delegates to `pick_free_axis_for_vertex`. W nodes
/// are directional (axis 0 = input, axes 1..N = outputs): `Target` picks
/// `leg_index == 0` (input), `Source` picks the smallest free `leg_index >= 1`
/// (output).
fn pick_contraction_axis(
    axes: &[FreeAxis],
    node_order: usize,
    is_w: bool,
    role: AxisRole,
) -> Option<usize> {
    if !is_w {
        return pick_free_axis_for_vertex(axes, node_order);
    }
    let leg_predicate = |fa: &&FreeAxis| match role {
        AxisRole::Target => fa.leg_index == 0,
        AxisRole::Source => fa.leg_index >= 1,
    };
    axes.iter()
        .position(|fa| {
            fa.node_order == node_order && fa.role == LegRole::Neutral && leg_predicate(&fa)
        })
        .or_else(|| {
            axes.iter()
                .position(|fa| fa.node_order == node_order && leg_predicate(&fa))
        })
}

// ---- Public entry point -----------------------------------------------------

/// Build per-vertex tensors, contract along `graph.edges`, return the
/// result (or a structural `ComputeError`).
///
/// Thin orchestrator: each phase is a function below. `on_progress`, if
/// `Some`, fires after each edge with `(edges_done, total_edges)`.
pub fn compute_tensor(
    graph: &FrontendGraphSlice,
    on_progress: Option<&dyn Fn(usize, usize)>,
) -> Result<TensorResult, ComputeError> {
    // Phase A — empty graph is the scalar identity (§5.6).
    if graph.nodes.is_empty() {
        return Ok(empty_result());
    }

    let ctx = GraphCtx::build(graph)?;

    // Phase B — build per-vertex groups + collect boundaries.
    let (mut groups, mut pending_boundaries, warnings) = build_initial_groups(&ctx)?;

    // Phase C — walk edges, contracting/tagging.
    let mut uf = UnionFind::new(graph.nodes.len());
    edge::walk_edges(
        &ctx,
        &mut groups,
        &mut pending_boundaries,
        &mut uf,
        on_progress,
    )?;

    // Phase D — combine disconnected components + dangling boundaries.
    let (combined, combined_free_axes) = combine_components(&ctx, groups, pending_boundaries);

    // Phase E — role-partition sort + permute.
    let (result_tensor, input_count, output_count) =
        partition_and_permute(combined, combined_free_axes);

    // Phase F — flatten to TensorResult.
    Ok(flatten_result(
        result_tensor,
        warnings,
        input_count,
        output_count,
    ))
}

/// The empty-graph result: scalar `1`.
fn empty_result() -> TensorResult {
    TensorResult {
        shape: vec![],
        data: vec![(1.0, 0.0)],
        warnings: vec![],
        input_count: 0,
        output_count: 0,
    }
}

// ---- Phase B: build initial groups + pending boundaries --------------------

/// Build one `Group` per tensor-vertex; boundaries become `PendingBoundary`.
/// Validates boundary degree ≤ 1, H-box arity == 2, and tensor rank == degree.
/// Phase-parses spider/box labels, downgrading failures to warnings + phase 0.
fn build_initial_groups(
    ctx: &GraphCtx,
) -> Result<(HashMap<String, Group>, Vec<PendingBoundary>, Vec<String>), ComputeError> {
    let mut warnings: Vec<String> = Vec::new();
    let mut groups: HashMap<String, Group> = HashMap::new();
    let mut pending_boundaries: Vec<PendingBoundary> = Vec::new();

    for (i, node) in ctx.graph.nodes.iter().enumerate() {
        let id = &node.id;
        let vt = node.data.vertex_type;
        let label = &node.data.label;
        let deg = *ctx.degree.get(id).unwrap_or(&0);

        // Boundary — no tensor. (Degree validated frontend-side.)
        if matches!(vt, VertexType::Input | VertexType::Output) {
            let role = if vt == VertexType::Input {
                LegRole::Input
            } else {
                LegRole::Output
            };
            pending_boundaries.push(PendingBoundary {
                node_order: i,
                role,
                neighbour_id: None,
            });
            continue;
        }

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

        let tensor =
            build_vertex_tensor(vt, deg, phase).expect("non-boundary type must build a tensor");
        // Builder rank must match degree so free_axes lines up with the
        // tensor's axes. Fixed-rank builders (`empty` → 0 when isolated,
        // 2 when wired; `h_box` → 2) mismatch other degrees and surface
        // as `DegreeOverflow` here.
        let rank = tensor.rank();
        if rank != deg {
            return Err(ComputeError::DegreeOverflow {
                vertex_id: id.clone(),
                vertex_type: vt,
                degree: deg,
                max: rank,
            });
        }
        let free_axes: Vec<FreeAxis> = (0..deg)
            .map(|leg| FreeAxis {
                node_order: i,
                leg_index: leg,
                role: LegRole::Neutral,
                sort_key: ctx.order_key[i],
            })
            .collect();
        groups.insert(id.clone(), Group { tensor, free_axes });
    }

    Ok((groups, pending_boundaries, warnings))
}

// ---- Phase D: combine disconnected components ------------------------------

/// Outer-product surviving groups (one per connected component) into one
/// tensor, then fold in dangling (degree-0) boundaries as length-2 identity
/// tensors `[1, 0]`. Groups are sorted by min `sort_key` for a deterministic
/// pre-sort arrangement (Phase E re-sorts by role + key).
fn combine_components(
    ctx: &GraphCtx,
    groups: HashMap<String, Group>,
    pending_boundaries: Vec<PendingBoundary>,
) -> (Option<Tensor>, Vec<FreeAxis>) {
    let mut surviving: Vec<(usize, Group)> = groups
        .into_iter()
        .map(|(id, g)| {
            let min_key = g
                .free_axes
                .iter()
                .map(|fa| fa.sort_key)
                .min()
                .unwrap_or_else(|| {
                    // Empty free_axes (no open legs) — fall back to the
                    // vertex's order key. Synthetic groups (e.g. identity
                    // wires keyed by edge id) aren't vertex ids, so guard
                    // the lookup; their min_key only matters for sort order.
                    ctx.id_to_order
                        .get(&id)
                        .map(|&o| ctx.order_key[o])
                        .unwrap_or(u32::MAX)
                });
            (min_key as usize, g)
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

    for pb in &pending_boundaries {
        if pb.neighbour_id.is_some() {
            continue; // attached during the edge walk
        }
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
            sort_key: ctx.order_key[pb.node_order],
        });
    }

    (combined, combined_free_axes)
}

// ---- Phase E: role partition + axis permutation ----------------------------

/// Partition axes into canonical order (Input, Output, Neutral; within each
/// role by `sort_key` then `leg_index`) and permute the tensor data to match.
/// Returns `(result_tensor, input_count, output_count)`.
fn partition_and_permute(
    combined: Option<Tensor>,
    combined_free_axes: Vec<FreeAxis>,
) -> (Tensor, usize, usize) {
    let mut indexed: Vec<(usize, FreeAxis)> = combined_free_axes.into_iter().enumerate().collect();
    indexed.sort_by(|a, b| {
        let role_rank = |r: LegRole| match r {
            LegRole::Input => 0,
            LegRole::Output => 1,
            LegRole::Neutral => 2,
        };
        role_rank(a.1.role)
            .cmp(&role_rank(b.1.role))
            .then(a.1.sort_key.cmp(&b.1.sort_key))
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

    let result_tensor = match combined {
        None => Tensor::scalar(num_complex::Complex::new(1.0, 0.0)),
        Some(t) => {
            if t.rank() == 0 {
                t
            } else {
                t.permuted_axes(&perm)
            }
        }
    };

    (result_tensor, input_count, output_count)
}

// ---- Phase F: flatten to TensorResult --------------------------------------

/// Flatten the result tensor to row-major `(re, im)` pairs. Rank-0 → one entry.
fn flatten_result(
    tensor: Tensor,
    warnings: Vec<String>,
    input_count: usize,
    output_count: usize,
) -> TensorResult {
    let shape: Vec<usize> = tensor.shape().to_vec();
    let total: usize = shape.iter().product::<usize>().max(1);
    let mut data: Vec<(f64, f64)> = Vec::with_capacity(total);

    if shape.is_empty() {
        let v = tensor.get(&[]);
        data.push((v.re, v.im));
    } else {
        let mut idx: Vec<usize> = vec![0; shape.len()];
        for _ in 0..total {
            let v = tensor.get(&idx);
            data.push((v.re, v.im));
            for axis in (0..shape.len()).rev() {
                idx[axis] += 1;
                if idx[axis] < shape[axis] {
                    break;
                }
                idx[axis] = 0;
            }
        }
    }

    TensorResult {
        shape,
        data,
        warnings,
        input_count,
        output_count,
    }
}

// ---- Edge walk (Phase C) ---------------------------------------------------

/// The three edge-walk branches, extracted so `walk_edges` stays a readable
/// dispatch loop.
mod edge {
    use super::*;

    /// Walk `graph.edges` in input order, dispatching each to one of four
    /// branches: boundary-to-boundary, self-loop, boundary-to-tensor, or
    /// tensor-to-tensor.
    pub(super) fn walk_edges(
        ctx: &GraphCtx,
        groups: &mut HashMap<String, Group>,
        pending_boundaries: &mut Vec<PendingBoundary>,
        uf: &mut UnionFind,
        on_progress: Option<&dyn Fn(usize, usize)>,
    ) -> Result<(), ComputeError> {
        let total_edges = ctx.graph.edges.len();
        for (edge_i, edge) in ctx.graph.edges.iter().enumerate() {
            // Edge endpoint existence validated frontend-side.

            let src_is_boundary = ctx.is_boundary(&edge.source);
            let tgt_is_boundary = ctx.is_boundary(&edge.target);

            if src_is_boundary && tgt_is_boundary {
                // input → output: boundaries act as identity tensors, so
                // this edge is an identity wire.
                handle_boundary_to_boundary_edge(
                    ctx,
                    edge,
                    groups,
                    pending_boundaries,
                )?;
            } else if edge.source == edge.target {
                handle_self_loop(ctx, edge, groups)?;
            } else if src_is_boundary || tgt_is_boundary {
                handle_boundary_edge(ctx, edge, groups, pending_boundaries, src_is_boundary)?;
            } else {
                handle_tensor_edge(ctx, edge, groups, uf)?;
            }

            if let Some(cb) = on_progress {
                cb(edge_i + 1, total_edges);
            }
        }
        Ok(())
    }

    /// Boundary-to-boundary edge (e.g. `input → output`): boundaries act as
    /// identity tensors, so this is an identity wire. Synthesize a group with
    /// the 2×2 identity tensor and two free axes tagged with each boundary's
    /// role. The contracted axis disappears; the two open axes survive as one
    /// Input and one Output of the result.
    fn handle_boundary_to_boundary_edge(
        ctx: &GraphCtx,
        edge: &crate::graph::FrontendGraphEdgeRecord,
        groups: &mut HashMap<String, Group>,
        pending_boundaries: &mut Vec<PendingBoundary>,
    ) -> Result<(), ComputeError> {
        let src_order = ctx.id_to_order[&edge.source];
        let tgt_order = ctx.id_to_order[&edge.target];
        let src_role = boundary_role(ctx.vertex_type(&edge.source));
        let tgt_role = boundary_role(ctx.vertex_type(&edge.target));

        // Mark both boundaries as attached so Phase D doesn't add them as
        // dangling (degree-0) open legs.
        for pb in pending_boundaries.iter_mut() {
            if pb.node_order == src_order || pb.node_order == tgt_order {
                pb.neighbour_id = Some(edge.id.clone());
            }
        }

        // A standalone identity-wire group, keyed by the edge id so it
        // flows through Phases D/E as its own component. The 2×2 identity
        // tensor is the result: result[in_bit, out_bit] = δ(in_bit, out_bit).
        let mut tensor = Tensor::zeros(&[2, 2]);
        *tensor.get_mut(&[0, 0]) = num_complex::Complex::new(1.0, 0.0);
        *tensor.get_mut(&[1, 1]) = num_complex::Complex::new(1.0, 0.0);
        groups.insert(
            edge.id.clone(),
            Group {
                tensor,
                free_axes: vec![
                    FreeAxis {
                        node_order: src_order,
                        leg_index: 0,
                        role: src_role,
                        sort_key: ctx.order_key[src_order],
                    },
                    FreeAxis {
                        node_order: tgt_order,
                        leg_index: 1,
                        role: tgt_role,
                        sort_key: ctx.order_key[tgt_order],
                    },
                ],
            },
        );
        Ok(())
    }

    /// Self-loop: trace two free legs of the vertex's group tensor.
    /// NOTE: ill-defined for a directional W (may not respect input/output
    /// split); produces a meaningless result rather than crashing.
    fn handle_self_loop(
        ctx: &GraphCtx,
        edge: &crate::graph::FrontendGraphEdgeRecord,
        groups: &mut HashMap<String, Group>,
    ) -> Result<(), ComputeError> {
        let order = ctx.id_to_order[&edge.source];
        let group = group_for_order_mut(groups, order);

        if group.free_axes.len() < 2 {
            return Err(ComputeError::DegreeOverflow {
                vertex_id: edge.source.clone(),
                vertex_type: ctx.vertex_type(&edge.source),
                degree: *ctx.degree.get(&edge.source).unwrap_or(&0),
                max: group.free_axes.len(),
            });
        }
        let axis_a = group.free_axes.len() - 1;
        let axis_b = group.free_axes.len() - 2;
        let tensor = std::mem::replace(
            &mut group.tensor,
            Tensor::scalar(num_complex::Complex::new(0.0, 0.0)),
        );
        group.tensor = tensor.trace(axis_a, axis_b);
        group.free_axes.remove(axis_a);
        group.free_axes.remove(axis_b);
        Ok(())
    }

    /// Boundary-to-tensor edge: tag the tensor-vertex's free leg with the
    /// boundary's role (no contraction). For a W, the leg is directional:
    /// W-as-target → input axis (leg 0), W-as-source → output axis (leg ≥ 1).
    fn handle_boundary_edge(
        ctx: &GraphCtx,
        edge: &crate::graph::FrontendGraphEdgeRecord,
        groups: &mut HashMap<String, Group>,
        pending_boundaries: &mut Vec<PendingBoundary>,
        src_is_boundary: bool,
    ) -> Result<(), ComputeError> {
        let (boundary_id, tensor_id) = if src_is_boundary {
            (&edge.source, &edge.target)
        } else {
            (&edge.target, &edge.source)
        };
        let boundary_role = match ctx.vertex_type(boundary_id) {
            VertexType::Input => LegRole::Input,
            VertexType::Output => LegRole::Output,
            _ => unreachable!("checked src_is_boundary/tgt_is_boundary above"),
        };
        for pb in pending_boundaries.iter_mut() {
            if ctx.order_to_id[pb.node_order] == *boundary_id {
                pb.neighbour_id = Some(tensor_id.clone());
            }
        }

        let tensor_order = ctx.id_to_order[tensor_id];
        let group = group_for_order_mut(groups, tensor_order);
        let tensor_is_w = ctx.vertex_type(tensor_id) == VertexType::W;
        let w_axis_role = if src_is_boundary {
            AxisRole::Target // W is target → input leg
        } else {
            AxisRole::Source // W is source → output leg
        };
        let leg_pos =
            pick_contraction_axis(&group.free_axes, tensor_order, tensor_is_w, w_axis_role)
                .expect("boundary edge endpoint must have a free leg to tag");
        let leg_to_tag = &mut group.free_axes[leg_pos];
        leg_to_tag.role = boundary_role;
        // The boundary owns this leg's sort position now.
        leg_to_tag.sort_key = ctx.order_key[ctx.id_to_order[boundary_id]];
        Ok(())
    }

    /// Tensor-to-tensor edge: contract. Same group → trace two legs;
    /// different groups → contract and union.
    fn handle_tensor_edge(
        ctx: &GraphCtx,
        edge: &crate::graph::FrontendGraphEdgeRecord,
        groups: &mut HashMap<String, Group>,
        uf: &mut UnionFind,
    ) -> Result<(), ComputeError> {
        let src_order = ctx.id_to_order[&edge.source];
        let tgt_order = ctx.id_to_order[&edge.target];
        let src_rep = uf.find(src_order);
        let tgt_rep = uf.find(tgt_order);

        if src_rep == tgt_rep {
            contract_same_group(ctx, edge, groups, src_order, tgt_order)?;
        } else {
            contract_different_groups(ctx, edge, groups, uf, src_rep, tgt_rep)?;
        }
        Ok(())
    }

    /// Same-group contraction: trace two free legs.
    fn contract_same_group(
        ctx: &GraphCtx,
        edge: &crate::graph::FrontendGraphEdgeRecord,
        groups: &mut HashMap<String, Group>,
        src_order: usize,
        tgt_order: usize,
    ) -> Result<(), ComputeError> {
        let group = group_for_order_mut(groups, src_order);

        if group.free_axes.len() < 2 {
            return Err(ComputeError::DegreeOverflow {
                vertex_id: edge.source.clone(),
                vertex_type: ctx.vertex_type(&edge.source),
                degree: *ctx.degree.get(&edge.source).unwrap_or(&0),
                max: group.free_axes.len(),
            });
        }

        let src_is_w = ctx.vertex_type(&edge.source) == VertexType::W;
        let tgt_is_w = ctx.vertex_type(&edge.target) == VertexType::W;
        let pos_src =
            pick_contraction_axis(&group.free_axes, src_order, src_is_w, AxisRole::Source)
                .ok_or_else(|| ComputeError::DegreeOverflow {
                    vertex_id: edge.source.clone(),
                    vertex_type: ctx.vertex_type(&edge.source),
                    degree: *ctx.degree.get(&edge.source).unwrap_or(&0),
                    max: 0,
                })?;
        let pos_tgt =
            pick_contraction_axis(&group.free_axes, tgt_order, tgt_is_w, AxisRole::Target)
                .ok_or_else(|| ComputeError::DegreeOverflow {
                    vertex_id: edge.target.clone(),
                    vertex_type: ctx.vertex_type(&edge.target),
                    degree: *ctx.degree.get(&edge.target).unwrap_or(&0),
                    max: 0,
                })?;

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
        Ok(())
    }

    /// Different-group contraction: contract along the picked axes, then
    /// union. The surviving rep owns the merged tensor + free_axes.
    fn contract_different_groups(
        ctx: &GraphCtx,
        edge: &crate::graph::FrontendGraphEdgeRecord,
        groups: &mut HashMap<String, Group>,
        uf: &mut UnionFind,
        src_rep: usize,
        tgt_rep: usize,
    ) -> Result<(), ComputeError> {
        let src_order = ctx.id_to_order[&edge.source];
        let tgt_order = ctx.id_to_order[&edge.target];
        let src_id = ctx.order_to_id[src_rep].clone();
        let tgt_id = ctx.order_to_id[tgt_rep].clone();
        let group_src = groups
            .remove(&src_id)
            .expect("src group must exist before contract");
        let group_tgt = groups
            .remove(&tgt_id)
            .expect("tgt group must exist before contract");

        let src_is_w = ctx.vertex_type(&edge.source) == VertexType::W;
        let tgt_is_w = ctx.vertex_type(&edge.target) == VertexType::W;
        let pos_src =
            pick_contraction_axis(&group_src.free_axes, src_order, src_is_w, AxisRole::Source)
                .expect("src endpoint must have a free leg in its group");
        let pos_tgt =
            pick_contraction_axis(&group_tgt.free_axes, tgt_order, tgt_is_w, AxisRole::Target)
                .expect("tgt endpoint must have a free leg in its group");

        let contracted = group_src
            .tensor
            .contract(group_tgt.tensor, pos_src, pos_tgt);
        // Concatenate: src's remainder, then tgt's (matches contract's
        // [A_free, B_free] order).
        let mut merged_free_axes: Vec<FreeAxis> =
            Vec::with_capacity(group_src.free_axes.len() - 1 + group_tgt.free_axes.len() - 1);
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

        uf.union(src_rep, tgt_rep);
        let new_rep = uf.find(src_rep);
        let new_rep_id = ctx.order_to_id[new_rep].clone();
        groups.insert(
            new_rep_id,
            Group {
                tensor: contracted,
                free_axes: merged_free_axes,
            },
        );
        Ok(())
    }

    // Resolve a vertex's owning group by scanning `free_axes` for its
    // `node_order` (one per component) — avoids borrowing `uf` alongside
    // `&mut groups`.

    fn group_for_order_mut<'g>(
        groups: &'g mut HashMap<String, Group>,
        order: usize,
    ) -> &'g mut Group {
        groups
            .values_mut()
            .find(|g| g.free_axes.iter().any(|fa| fa.node_order == order))
            .expect("vertex order must belong to exactly one group")
    }
}

// ---- Union-find (hand-rolled, plan §3.3) -----------------------------------

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
            self.parent[x] = self.parent[self.parent[x]]; // path compression
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
    use crate::graph::{FrontendGraphEdgeRecord, FrontendGraphNodeRecord, FrontendVertexData};

    /// Build a `GraphSlice` from `(id, type, label)` + `(id, src, tgt)` tuples.
    fn graph(
        nodes: &[(&str, VertexType, &str)],
        edges: &[(&str, &str, &str)],
    ) -> FrontendGraphSlice {
        FrontendGraphSlice {
            nodes: nodes
                .iter()
                .map(|(id, vt, label)| FrontendGraphNodeRecord {
                    id: (*id).into(),
                    data: FrontendVertexData {
                        label: (*label).into(),
                        vertex_type: *vt,
                        order: None,
                    },
                })
                .collect(),
            edges: edges
                .iter()
                .map(|(id, src, tgt)| FrontendGraphEdgeRecord {
                    id: (*id).into(),
                    source: (*src).into(),
                    target: (*tgt).into(),
                    source_handle: None,
                    target_handle: None,
                })
                .collect(),
        }
    }

    #[test]
    fn unparseable_spider_label_yields_warning_and_phase_zero() {
        // Bad spider label → warning + phase 0, not a hard error.
        // Isolated z spider (arity 0): scalar = 1 + e^{i·0} = 2.
        let g = graph(&[("z", VertexType::Z, "totally not a phase")], &[]);
        let result = compute_tensor(&g, None).expect("parse failure must not fail compute");
        assert_eq!(result.data.len(), 1);
        assert!((result.data[0].0 - 2.0).abs() < 1e-10, "phase 0 → 1+1 = 2");
        assert_eq!(result.warnings.len(), 1);
        let w = &result.warnings[0].to_lowercase();
        assert!(w.contains("parse"), "warning should mention parse: {w}");
        assert!(w.contains('z'), "warning should name the vertex: {w}");
    }

    #[test]
    fn multiple_bad_labels_each_get_their_own_warning() {
        let g = graph(
            &[("a", VertexType::Z, "foo"), ("b", VertexType::X, "bar")],
            &[],
        );
        let result = compute_tensor(&g, None).expect("compute should succeed");
        assert_eq!(result.warnings.len(), 2);
    }

    #[test]
    fn progress_callback_fires_per_edge() {
        // Two edges → callback fires (1, 2) and (2, 2).
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

    #[test]
    fn union_find_union_then_find_reports_same_root() {
        let mut uf = UnionFind::new(5);
        uf.union(0, 1);
        uf.union(2, 3);
        uf.union(1, 3);
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
        uf.union(0, 1);
        assert_eq!(uf.find(0), root_after_first);
    }
}
