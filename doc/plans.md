# ZXW Rust compute backend — implementation plan

> Scope: scaffold a Rust crate (compiled to WASM) that **computes the tensor
> represented by a ZXW graph**, where each vertex is a tensor and each edge is
> a tensor contraction. This is the "foremost function" the user needs; later
> phases cover simplification/rewrites and richer tensor algebra.

---

## 0. Background

- The frontend today stores a ZXW graph in two slices: `graph` (nodes + edges,
  the compute contract) and `view` (positions, future visual fields). See
  `AGENTS.md` §"Document shape (v1)".
- Vertex types live in `src/lib/graph/vertex-types.ts`. Today there are **eight**
  selectable types — `z`, `empty`, `x`, `w`, `h`, `zbox`, `xbox`, `and`
- Vertex data is `{ label: string, vertexType: VertexType }`. 
 `label` *is* the phase for spider types
  (`z`, `x`, `zbox`, `xbox`); for other vertex types it's free-form text.
  Empty label on a spider = phase 0. Phase 1 below pins this convention in
  code; Phase 0 adds the matching LaTeX rendering that the user types into.
- a single Rust crate compiled to WASM (`wasm-pack`),
 consumed from a thin frontend wrapper. As shown in
  AGENTS.md ("future Rust/WASM compute layer").

### Goal of this plan

A working end-to-end pipeline:

```
React Flow graph  →  GraphDocument (JSON)  →  Rust/WASM  →  TensorResult
```

which returns a numerical tensor (represented as a matrix) for arbitrary ZXW graphs
(including phase semantics carried in `label`), with a `Compute` button in
the toolbar to drive it and a result panel to display shape + values.

### Conventions introduced in this plan (lock these in)

| Vertex type | `label` semantics |
|---|---|
| `z`, `x`, `zbox`, `xbox` | Phase expression, optionally LaTeX. Empty = phase 0. |
| `empty`, `w`, `h`, `and` | Free-form text. Not parsed for compute. |

**LaTeX detection rule** (UI): if the label contains `$…$` or `$$…$$`,
render with KaTeX; otherwise plain text.
Applies to **all** vertex types,the *parse* step only fires for the four spider types.

---

## 1. Phase 0 — LaTeX rendering for `label` (Finished)

> 📌 **Frontend-only prerequisite, not part of the Rust backend work.**
> Retained here for context because later phases reference it. The
> compute-relevant convention it establishes (spider labels carry phase
> expressions, optionally LaTeX-wrapped) is captured in §0 above and
> enforced by `isSpiderType()` in `src/lib/graph/vertex-types.ts`.

**Implementation.**

- Add `katex` (and `katex/dist/katex.min.css`) as runtime dependencies.
- New helper `src/lib/label/renderLabel.ts`:
  - `isLatexLabel(label: string): boolean` — matches `\$[^$]+\$` or
    `\$\$[^$]+\$\$` (with possible leading/trailing whitespace).
  - `renderLabel(label: string): { html: string; isLatex: boolean }` —
    returns KaTeX HTML for LaTeX, plain-text-escaped HTML otherwise.
- `VertexNode.tsx` swaps its `<span>{label}</span>` for
  `<span dangerouslySetInnerHTML={{ __html: renderLabel(label).html }} />`.
- `VertexPropertyPanel.tsx`: live preview pane renders the same way.
- `VertexTypeMenu.tsx` swatch stays plain text (it's a tiny icon preview;
  LaTeX swatches would be visual noise).

**Backward compatibility.** Existing labels without `$…$` continue to render
as plain text. No data migration needed.

---

## 2. Phase 1 — `label`-as-phase convention + JS phase parser (Finished. The Parser can be improved in the future)

**Scope.** Convention (documented, enforced in one place) + a small JS parser.

**Convention.** Documented in `AGENTS.md` (added in Phase 2's collateral
update). Enforced via `isSpiderType(vertexType)` used by:

- The property panel — when editing a spider, the label field hints
  "phase expression (LaTeX)" and shows a live parse result ("= 0.785 rad").
- The compute entry point (Phase 4) — only runs the parser for the four
  spider types; others always get phase 0 (or "n/a", depending on type).

**Parser location.** Frontend module `src/lib/phase/parser.ts`. Rust port
lives at `crates/zxw/src/phase.rs` (Phase 3). Both share the same grammar
and are cross-tested for agreement.

**Grammar (v1, numeric only).**

```
phase   := term (('+' | '-') term)*
term    := factor (('*' | '/' | '×' | '÷') factor)*
factor  := number | '\pi' | 'π' | 'pi' | 'PI' | '(' phase ')' | unary
unary   := '-' factor | '+' factor
number  := [0-9]+ ('.' [0-9]+)?
```

- Pi evaluates to a constant (≈ 3.14159…). Four accepted spellings:
  `\pi`, the unicode character `π`, and the bare ASCII words `pi` / `PI`.
- Any other named token (`\alpha`, `\beta`, `\theta`, …) is an **error** in
  v1 — Phase 6 introduces symbolic arithmetic.
- Whitespace ignored. Unicode `−` (U+2212), `×` (U+00D7), and `÷` (U+00F7)
  accepted alongside ASCII `-` / `*` / `/`.

**Parser API.**

```ts
// src/lib/phase/parser.ts
export type PhaseResult =
  | { ok: true; value: number }
  | { ok: false; error: string };

export function parsePhase(input: string): PhaseResult;
```

**Backward compatibility at compute time (set up here, enforced in Phase 4).**

- Empty label on a spider → `parsePhase("")` returns `Ok(0)`. Clean default.
- Non-LaTeX numeric labels like `"0.5"` → parses as `0.5`. Works.
- LaTeX-wrapped numerics like `"$0.5$"` → strip delimiters, parse. Works.
- Free-form labels like `"Z"` (someone named a vertex) → error.
  - **Mitigation:** at the compute entry point, catch the parse error and
    fall back to phase = 0 with a warning attached to the result
    (`warnings: string[]`). Don't hard-fail the whole computation over one
    spider's label.
  - This keeps existing hand-edited graphs working even if their labels
    were never intended as phases.

**Files to touch.**

| File | Change |
|---|---|
| `src/lib/phase/parser.ts` (new) | Phase parser + `parsePhase` API. |
| `src/lib/phase/parser.test.ts` (new) | Vitest cases (grammars, errors, edge cases). |
| `src/components/graph-editor/VertexPropertyPanel.tsx` | Show live parse hint when vertex is a spider type. |
| `src/lib/graph/vertex-types.ts` | Export `isSpiderType(vertexType)` helper (covers `z`, `x`, `zbox`, `xbox`). |
| `AGENTS.md` | Document the label-as-phase convention. |

---

## 3. Phase 2 — Cargo workspace + `zxw` crate + WASM build (Scaffold landed; **build currently broken at HEAD**)

> ⚠️ **Build status at HEAD.** `crates/zxw/src/lib.rs` declares
> `pub mod spiders;` and `pub mod boxes;`, but **neither file exists** —
> the "rust refactor" commit (`d1ccda9`) left the declarations dangling.
> `cargo check` fails with `error[E0583]: file not found for module`
> for both. The `ping()` pipeline itself is sound (it builds from the
> pre-refactor state preserved in `public/wasm/zxw/`), but the crate
> is **not reproducible from current source**.
>
> **The first task of Phase 3 is to reconcile `lib.rs` to the
> single-`nodes.rs` layout** described in §3.1 below: delete the
> `pub mod spiders;` and `pub mod boxes;` lines. Until that lands,
> no Phase 3 work can even compile.

### 3.1 Workspace layout

Single Rust crate with a `wasm` feature flag, which is kept under a new top-level
`crates/` directory.
In the future this crate could be an independent graph theoretical rust crates can shall be published on crates.io.

```
graph-board/
├── crates/
│   └── zxw/
│       ├── src/
│       │   ├── lib.rs                # pub use of public API
│       │   ├── graph.rs              # ZXW graph data model (serde)
│       │   ├── phase.rs              # LaTeX phase parser (Rust port)
│       │   ├── tensor.rs             # Tensor / Complex wrappers
│       │   ├── nodes.rs              # All the vertex definitions
│       │   ├── contraction.rs        # Naive sequential contraction
│       │   ├── error.rs              # thiserror types
│       │   └── wasm.rs               # #[wasm_bindgen] entry points (gated)
│       ├── tests/
│       │   ├── phase_grammar.rs      # matches the JS parser's tests
│       │   ├── tensor_correctness.rs # spider+box identities, H·H = I, etc.
│       │   └── contraction.rs        # small graphs, end-to-end
│       ├── Cargo.toml
│       └── pkg/                      # wasm-pack output, gitignored
└── ...
```

### 3.2 WASM build pipeline

WASM can be build with `pnpm build:wasm`, which runs the script in `../scripts/build-wasm.sh`, that is a wrapper for `wasm-pack`.
The output is stored in `../public/wasm/zxw/`.

The build script is
```../scripts/build-wasm.sh

wasm-pack build \
  crates/zxw \
  --target web \
  --out-dir  ../public/wasm/zxw/ \
  --features wasm
```

### 3.3 Dependency choices (buy vs. build)

The graph/contraction layer needs three primitives. The decisions below
are **locked for v1** with explicit flip conditions for Phase 6 — add a
dependency only when the flip condition is met, not speculatively.

| Need | v1 (Phases 3–5) | Phase 6 |
|---|---|---|
| Union-find (grouping) | Hand-rolled (~30 lines, path compression + union-by-rank) in `crates/zxw/src/contraction.rs`. Vertex ids are `0..n` already. | Optionally swap to `petgraph::unionfind::UnionFind` if `petgraph` is adopted for rewrites (see below). |
| Graph data structure + traversal | **None.** `GraphSlice { nodes, edges }` (§4.0) is the only representation. The contraction loop walks `edges` in input order once — not a traversal, not a query. | **`petgraph`** when ZXW rewrites land (§7). Rewrites are local graph transformations; `petgraph::stable_graph::StableGraph` + `algo::connected_components` model them cleanly. Do not adopt earlier — a second parallel graph representation adds a conversion step with no payoff for v1's single edge-walk. |
| Tensor contraction | `ndarray::ArrayD<Complex<f64>>` + a hand-written `contract(a, b, (i, j))` (~20 lines, a tensored dot over two axes). | `ndarray` stays. Contraction *ordering* swaps to **`cotengrust`** (the Rust backend of `cotengra`) when the naïve sequential loop becomes a measured bottleneck. |

**Flip conditions (re-evaluate at Phase 6 kickoff):**

- **Adopt `petgraph` when** the first ZXW rewrite rule (spider fusion,
  identity removal, π-commutation, bialgebra, Hopf, Euler) is being
  implemented. Re-implementing local graph rewrites over a plain
  `Vec<Node>/Vec<Edge>` is the pain point that justifies the dep.
- **Adopt `cotengrust` when** a real user graph exceeds the naïve
  contraction's complexity ceiling (§5.2: ~12 open legs / ~30 total
  legs). Add it behind a new `compute_tensor_optimized` entry point so
  the naïve path stays as a correctness oracle.
- **Do NOT adopt** a standalone union-find crate (`union-find-rs`,
  `disjoint-sets`) — `petgraph::unionfind` covers it if `petgraph`
  lands, and the hand-rolled version is trivial otherwise.

**Crates surveyed (for reference):**
- [`petgraph`](https://crates.io/crates/petgraph) — graph data
  structures + algorithms. Watch [issue #551](https://github.com/petgraph/petgraph/issues/551)
  (potential `petgraph-algorithms` sub-crate split) before pinning.
- [`cotengrust`](https://github.com/jcmgray/cotengrust) — contraction
  ordering primitives, Rust backend for `cotengra`.
- [`omeco`](https://docs.rs/omeco) — alternative contraction-order
  optimizer; smaller, less battle-tested than `cotengrust`.
- `petgraph::unionfind::UnionFind` — built into petgraph, no extra dep.

Before pinning any version at Phase 6, verify current maintenance
status (latest release date, download counts) on crates.io — the
landscape shifts.

---

## 4. Phase 3 — Rust phase parser + Tensor model + per-vertex builders

### 4.0 `GraphSlice` serde model (Phase 3 task #0 — do this before anything else)

The compute layer consumes `doc.graph` (`GraphSlice`) straight off the WASM
boundary via `serde_wasm_bindgen`. The TS contract lives in
`src/lib/graph/types.ts` and is **nested with camelCase fields**:

```ts
// src/lib/graph/types.ts (existing — the source of truth)
type GraphNodeRecord = { id: string; data: { label: string; vertexType: VertexType } };
type GraphEdgeRecord = {
  id: string; source: string; target: string;
  sourceHandle?: number;   // numeric index, 0 = top, 1 = bottom
  targetHandle?: number;   // ABSENT (not null) = "use role default"
};
type GraphSlice = { nodes: GraphNodeRecord[]; edges: GraphEdgeRecord[] };
```

**The `graph.rs` stub comment sketches a *flat* `Node { id, vertex_type,
label }` — that shape will NOT round-trip the TS payload.** Use the exact
structs below. The `#[serde(rename_all = "camelCase")]` and the nested
`data` wrapper are both load-bearing.

```rust
// crates/zxw/src/graph.rs
use serde::Deserialize;

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GraphSlice {
    pub nodes: Vec<GraphNodeRecord>,
    pub edges: Vec<GraphEdgeRecord>,
}

#[derive(Deserialize, Debug, Clone)]
pub struct GraphNodeRecord {
    pub id: String,
    pub data: VertexData,
}

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VertexData {
    pub label: String,
    pub vertex_type: VertexType,
}

#[derive(Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum VertexType {
    Z, Empty, X, W, H, Zbox, Xbox, And,
}

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GraphEdgeRecord {
    pub id: String,
    pub source: String,
    pub target: String,
    // None = field absent in JSON = "use role default".
    // 0 = top, 1 = bottom (see src/lib/graph/serialization.ts).
    // The compute layer treats all legs of a symmetric tensor as
    // equivalent and ignores the index for v1; it must still
    // deserialize cleanly, hence Option rather than a required u32.
    pub source_handle: Option<u32>,
    pub target_handle: Option<u32>,
}
```

**Cross-references to keep in sync:**
- TS shapes: `src/lib/graph/types.ts`
- Handle-index semantics + role defaults: `src/lib/graph/serialization.ts`
  (`handleIdToIndex` / `indexToHandleId` — module-private; Rust does not
  call these, but the numeric meaning is defined there).

**Round-trip test (mandatory).** Add a `tests/graph_serde.rs` that
deserializes a hand-written JSON payload (matching what
`projectDocument()` emits) into `GraphSlice` and re-serializes it,
asserting field equality. This catches camelCase/flatten drift the moment
it lands.

---

### 4.1 Rust phase parser (`crates/zxw/src/phase.rs`)

Direct port of the JS grammar in Phase 1. Same recursive-descent shape:

```rust
pub enum PhaseError {
    UnknownVariable(String),
    UnexpectedToken { found: String, position: usize },
    Empty,
    TrailingInput { position: usize },
    NonFinite(f64),
}

pub fn parse_phase(input: &str) -> Result<f64, PhaseError>;
```

**Behaviour checklist — JS quirks the Rust port must mirror exactly.**
These come from the JS implementation and are easy to drop on a port.
The cross-language fixture below pins each one with a test case, so a
port that misses any of them fails CI.

1. **`PhaseResult` field is `value`, not `radians`.** The plan's earlier
   TS snippet used `radians`; the landed shape is `{ ok: true, value:
   number } | …`. Use `value` in Rust so WASM-bound serde types don't
   drift.
2. **Unicode `×` (U+00D7) and `÷` (U+00F7) accepted** as synonyms for
   `*` / `/`. Plan originally mentioned only Unicode `−`; JS also takes
   `×` / `÷` so the user can paste from a typeset source without
   retyping. Plus `π` (U+03C0) is a fourth pi spelling alongside `\pi` /
   `pi` / `PI`.
3. **Unary `+` exists** (and `--3` works via two stacked unary `-`).
   Easy to forget; fixture has a case.
4. **Identifier-aware error messages.** `parsePhase("pi2")` returns
   "Unknown variable 'pi2'", not silent `pi` + orphan `2`. The word
   consumer refuses to match `pi` when followed by `[A-Za-z0-9]`; same
   rule for `\<word>` (`\alpha2` → "Unknown variable '\alpha2'", not
   just `'\alpha'`). Rust port's `try_consume_word` needs the same
   boundary check.
5. **Finiteness gate.** JS ends with `Number.isFinite(value)`. Rust port
   must call `f64::is_finite()` — otherwise a division that produces
   `inf` or `NaN` propagates into the tensor builder and corrupts every
   downstream contraction. Returns `PhaseError::NonFinite(value)`.

**Cross-language tests.** A shared test fixture (a JSON table of inputs and
expected outputs) lives at `crates/zxw/tests/fixtures/phase_grammar.json`.
Both `crates/zxw/tests/phase_grammar.rs` and `src/lib/phase/parser.test.ts`
load it and assert equality — guarantees the parsers stay in sync.

> 🚫 **Hard prerequisite — Phase 3 cannot land without this.** Today
> `src/lib/phase/parser.test.ts` is **52 inline cases** and
> `crates/zxw/tests/fixtures/phase_grammar.json` **does not exist**
> (the `tests/fixtures/` directory is absent). The refactor must happen
> **in the same PR as the Rust parser port**: lift the 52 cases into the
> shared JSON fixture, rewrite `parser.test.ts` to load it, and write
> `phase_grammar.rs` to load the same file. Adding a new parser case is
> then a one-file edit and both sides stay locked. A Rust parser landed
> without the shared fixture is unpinnable and will silently drift.

### 4.2 The `Tensor` type

Wrap `ndarray::ArrayD<Complex<f64>>`. Provide:

```rust
pub type Complex = num_complex::Complex<f64>;
pub struct Tensor {
    data: ndarray::ArrayD<Complex>,
}

impl Tensor {
    pub fn shape(&self) -> &[usize];
    pub fn scalar(c: Complex) -> Self;        // shape []
    pub fn zeros(shape: &[usize]) -> Self;
    pub fn contract(self, other: Self, axis: (usize, usize)) -> Self;
    pub fn to_dense_json(&self) -> DenseJson; // { shape, data: [(re, im), …] }
}
```

`contract(a, b, (i, j))` removes axis `i` of `a` and axis `j` of `b`,
summing their product. That's all the frontend needs for v1.

### 4.3 Per-vertex builders (one function each)

Each takes `arity: usize` plus `phase: f64` (already parsed) where applicable
and returns a `Tensor`. All builders use shape `(2,) * arity` so we get
uniform contraction semantics.

**Conventions (locked — do not change without bumping schema version):**

- **Spiders (`z`, `x`):** unnormalized copy-indices. `(0,0,…,0) → 1`,
  `(1,1,…,1) → e^{i·phase}`, all mixed-index entries → 0. No `√2`
  factors; the spider is *not* unitary for arity ≠ 2.
- **H-box:** unitary, `1/√2 · [[1,1],[1,-1]]`. This is the only builder
  with a normalization factor in v1.
- **W-node:** **unnormalized single-hot** — any index with exactly one
  bit set → 1, all others → 0. No `/√n`. (Matches the AND convention;
  the normalized physics W-state is a Phase 6 concern.) Directionality
  is a renderer concern only; all legs are equivalent for the tensor.
- **AND-gate:** unnormalized indicator — the all-1s index → 1, else 0.
- **zbox / xbox (v1):** **single-phase diagonal.**
  `z_box(arity, phase)` → diagonal tensor with `e^{i·phase}` at the
  all-1s index and `1` at every other index. `x_box` is the
  H-conjugated form. Multi-phase (2^arity independent phases) is
  deferred to Phase 6; the label carries one expression today, so one
  phase it is.
- **empty:** scalar `1` (0 legs).

| Builder | Tensor shape | Non-zero entries |
|---|---|---|
| `z_spider(arity, phase)` | `(2,)*arity` | `(0,0,…,0) → 1`, `(1,1,…,1) → e^{i·phase}` |
| `x_spider(arity, phase)` | `(2,)*arity` | Same as Z but in X basis (H⊗…⊗H applied to Z spider). |
| `w_node(arity)` | `(2,)*arity` | Any `i` with exactly one bit set → 1; else 0. (Unnormalized; directional in the renderer only.) |
| `h_box()` | `(2, 2)` | `1/√2 · [[1,1],[1,-1]]`. Fixed arity 2; for larger circuits the user chains H-boxes. |
| `z_box(arity, phase: f64)` | `(2,)*arity` | Diagonal: all-1s index → `e^{i·phase}`, all others → 1. |
| `x_box(arity, phase: f64)` | `(2,)*arity` | Same but X basis (H⊗…⊗H applied to z_box). |
| `empty()` | `[]` (scalar) | 1. Constant. |
| `and_gate(arity)` | `(2,)*arity` | All-1s index → 1, else 0. |

**Edge cases / decisions to surface:**

- **Empty vertex** — see D3. Default plan: treat as scalar `1` (0 legs).
  If you want it to be a 1-leg identity (i.e. a wire), say so and we'll
  change it.
- **H-box arity** — fixed at 2 today; if we want general Hadamards
  (n-arity controls) we'd add an `h_general(arity)`. Not for v1.
- **Directional vertices (W, AND)** — the renderer draws them with a
  "single input at the top, N outputs at the bottom". For the *tensor* we
  treat all legs as equivalent (W with k legs is the k-leg W state; AND
  with k legs is the k-input AND). This is the standard convention and
  matches what ZXW libraries do.
- **Box parameters (v1 = single phase, multi-phase = Phase 6).** The
  label-as-phase convention carries exactly one expression; in v1
  `z_box` / `x_box` take a single `phase: f64` and apply it to the
  all-1s diagonal entry (see the Conventions block above). 2^arity
  independent phases require a richer `label` encoding and are deferred
  to Phase 6.

### 4.4 Tests for Phase 3

Property-style tests using `approx::assert_relative_eq` on complex numbers:

- `z_spider(2, 0)` equals the identity (up to global phase, with proper
  normalisation).
- `h_box() · h_box()` equals identity.
- `z_spider(2, π)` is the Pauli-Z matrix.
- `w_node(2)` has the four non-zero entries summing to a valid density
  (sanity).
- Round-trip: build the same tensor from JSON and from the builder;
  assert element-wise equality.

---

## 5. Phase 4 — Contraction algorithm

### 5.1 Naive sequential

For each edge `(u, v)` in input order:

1. Look up the two tensors `t_u` and `t_v`.
2. Pick one axis from each (leg bookkeeping — see below).
3. `t_u.contract(t_v, (axis_u, axis_v))`. One of them is the result; the
   other becomes its tensor (we keep one canonical "current" tensor per
   vertex, replacing it with the contracted version in a small union-find
   of "groups" so multi-edges chain cleanly).
4. After all edges, walk the remaining groups to compute the output tensor.

> **Union-find source.** The grouping union-find is hand-rolled in v1
> (~30 lines, path compression + union-by-rank) — see §3.3 for the
> buy-vs-build rationale and the Phase 6 flip condition to
> `petgraph::unionfind`. Do not reach for a standalone union-find crate.

**Leg bookkeeping — the invariant that makes this correct.** Each vertex
`v` starts with `arity(v) = degree(v)` free legs indexed `0..arity(v)`.
The naïve "pick any unused axis" line only holds for **fully symmetric
spiders**; once an H-box or a directional node joins a group, the running
tensor's axes are *distinguishable*, and contracting the wrong axis gives
a numerically wrong result. Track the mapping explicitly:

```rust
// One entry per group. The group tensor's axis i corresponds to
// free_axes[i] = (vertex_id, leg_index_within_that_vertex).
struct Group {
    tensor: Tensor,
    free_axes: Vec<(VertexId, usize)>,
}
```

**To contract edge `(u, v)` where `u ∈ group_gu`, `v ∈ group_gv`:**

1. Find the position `pos_u` of `(u, leg_u)` in `group_gu.free_axes` —
   that's the axis in `group_gu.tensor` to contract. (For the first edge
   out of a fresh vertex, `leg_u` is any of `u`'s remaining legs; record
   the choice so the *next* edge out of `u` picks a different one.)
2. Symmetrically find `pos_v` in `group_gv.free_axes`.
3. `group_gu.tensor.contract(group_gv.tensor, (pos_u, pos_v))`.
4. Remove both entries from `free_axes`; concatenate the remainder
   (`gu`'s, then `gv`'s — order matters for §5.4's output ordering).
5. If `gu ≠ gv`, union the groups; the surviving group owns the new
   tensor and merged `free_axes`. If `gu == gv` (self-loop case), see
   §5.6 — it's a *trace*, a different code path.

"Any free axis works" is true **only** for symmetric tensors; the
`(vertex_id, leg_index)` map is what generalizes correctness to H-boxes,
directional nodes, and anything non-symmetric Phase 6 adds.

**Worked example — Z–H–Z chain (3 vertices, 2 edges).**

```
Vertices:  z1 (Z, arity 2, legs 0,1)   h (H-box, arity 2, legs 0,1)   z2 (Z, arity 2, legs 0,1)
Edges:     (z1, h),  (h, z2)

Initial groups (one per vertex):
  G_z1 { tensor: z_spider(2, φ1),  free_axes: [(z1,0), (z1,1)] }
  G_h  { tensor: h_box(),          free_axes: [(h,0),  (h,1)]  }
  G_z2 { tensor: z_spider(2, φ2),  free_axes: [(z2,0), (z2,1)] }

After edge (z1, h):  contract axis pos(z1,0) of G_z1 [pos 0] with
  axis pos(h,0) of G_h [pos 0]. Result shape (2,2,2):
  G_z1h { tensor: z1⊗h contracted,  free_axes: [(z1,1), (h,1)] }
  (axis 0 was z1.0, axis 1 was h.0; both consumed)
  Note: z1.1 is now axis 0 of G_z1h.tensor, h.1 is axis 1.

After edge (h, z2): we need h.1 — but h now lives in G_z1h. Look up
  (h,1) in G_z1h.free_axes → pos 1. Look up (z2,0) in G_z2 → pos 0.
  Contract G_z1h.tensor axis 1 with G_z2.tensor axis 0.
  G_z1hz2 { tensor: (2,2,2),  free_axes: [(z1,1), (z2,1)] }

Final: G_z1hz2 has two open legs (z1.1, z2.1) → TensorResult shape (2,2).
Output axis order: [(z1,1), (z2,1)] per §5.4.
```

Without the `free_axes` map, step 2's "look up `(h,1)` in the merged
group" would be guesswork — and contracting the wrong axis here silently
returns a wrong matrix that still has the right shape.

**Progress callback.** The `compute_tensor` entry point (§5.5) accepts an
optional `on_progress: Option<&dyn Fn(usize, usize)>` invoked after each
edge is contracted with `(contracted_so_far, total_edges)`. When `None`
(native tests, or when the caller doesn't need progress), the loop skips the
call with zero overhead. The callback crosses the WASM boundary in Phase 5
via `wasm_bindgen`'s `Closure` type — see §6.1.

### 5.2 Complexity

Naive is fine for graphs with ≤ ~12 open legs / ≤ ~30 total legs. Past that,
exponential blow-up. Phase 6 covers optimal contraction ordering.

### 5.3 Tests for Phase 4

End-to-end cases:

- Single Z spider with 3 legs, no edges → `Tensor` of shape `(2,2,2)` with
  exactly 2 non-zero entries.
- Z-H-Z chain: build a 3-vertex/2-edge graph (Z arity 2, H, Z arity 2),
  compute, verify against the hand-derived matrix `H Z(α) H = X(α)`.
- A real-world small circuit (e.g. Bell-state prep) → assert the output
  tensor matches the expected 4×1 dense column (|Φ+⟩).
- Fully contracted graph (no open legs) → scalar; assert ≈ 1 for trivial
  cases, ≈ 0 for cancelling cases.

### 5.4 Output format

Default: **dense JSON**, shape + flat array of `{re, im}` pairs:

```json
{
  "shape": [2, 2, 2],
  "data": [[1.0, 0.0], [0.0, 0.0], [0.0, 0.0], [0.0, 0.0], …]
}
```

Sparse output (Phase 6+ if needed) — only non-zero entries + their
indices. Skipped for v1 because the typical output arity is small.

**Open-leg output axis ordering (locked).** Output axes are ordered by
**first appearance of the owning vertex in input `graph.nodes` order,
then by leg index within that vertex**. This falls out of the §5.1
`free_axes` walk if, when the surviving group is materialized at the end,
you stable-sort its `free_axes` by `(node_order_index(vertex_id),
leg_index)`. Stable across runs; required so the UI's dense table and the
§5.3 cross-tests are reproducible. Do not leave axis order up to
`HashMap` iteration.

### 5.5 Label parse fallback (D2)

The compute entry point catches per-spider phase-parse errors and
substitutes phase 0 so a single unparseable label can't fail the whole
computation. The caught error is attached to the result so the UI can
surface it.

```rust
/// Top-level entry point: build per-vertex tensors, contract along edges,
/// return the resulting tensor (or an error).
pub fn compute_tensor(
    graph: &GraphSlice,
    on_progress: Option<&dyn Fn(usize, usize)>,
) -> Result<TensorResult, ComputeError>;

pub struct TensorResult {
    pub shape: Vec<usize>,
    pub data: Vec<(f64, f64)>,          // (re, im) pairs
    pub warnings: Vec<String>,          // per-spider parse fallbacks go here
}
```

Rules:

- **Empty label on a spider** → `parsePhase("")` returns `Ok(0)`. Clean
  default; no warning.
- **LaTeX-wrapped numeric like `"$0.5$"`** → strip delimiters, parse.
  No warning.
- **Unparseable label like `"Z"`** (a free-form name a user typed into
  a spider) → catch the error, append to `warnings`, substitute phase 0
  for that spider. Don't hard-fail the computation.
- **Non-spider labels** (H, W, AND, empty) are never parsed; they
  contribute nothing to `warnings` regardless of content.

UI side (§6.4) renders `warnings` as a collapsible "warnings (N)" block
above the result.

### 5.6 Graph-shape edge cases (locked v1 policy)

The §5.1 union-find naturally produces one tensor per connected
component. These decisions pin what `compute_tensor` does with
non-trivial graph shapes:

- **Disconnected components (≥2 components, or isolated vertices).**
  **Outer-product** all per-component tensors into a single
  `TensorResult`. Shape is the concatenation of component shapes in
  input `graph.nodes` order. If no component has open legs, the result
  is a scalar — the product of each component's scalar value. This is
  the most semantically honest v1 behavior, but note the outer product
  can blow up the output shape exponentially; flag this as a Phase 6
  optimization target (likely: return per-component results instead,
  which changes the `TensorResult` shape and the worker protocol).
- **Self-loops (edge from `v` to `v`).** **Reject in v1** with
  `ComputeError::SelfLoopUnsupported { vertex_id }`. A self-loop is a
  *trace* over two legs of the *same* tensor — a distinct code path
  from inter-vertex contraction (sum over the diagonal, no group
  merge). Punting keeps §5.1 single-purpose; trace support is a Phase 6
  item.
- **Multi-edges (≥2 edges between the same pair `(u, v)`).**
  **Supported for free** — each edge is a separate contraction that
  consumes one remaining leg from each side. Two edges between `u` and
  `v` contract two of `u`'s legs with two of `v`'s; the `free_axes`
  bookkeeping handles it without a special case (as long as `u` and
  `v` each have enough legs — otherwise `ComputeError::DegreeOverflow`).
- **Empty graph (0 nodes, 0 edges).** Returns
  `TensorResult { shape: [], data: [(1.0, 0.0)], warnings: [] }` — the
  scalar multiplicative identity. Do not error on empty input.
- **Vertex of degree > arity budget.** A vertex has `arity = degree`
  free legs; builders take `arity: usize` so this is self-consistent.
  But if a *non-symmetric* node (e.g. a future arity-2-only H-box) is
  asked for arity ≠ 2, return `ComputeError::ArityUnsupported`.

Add a `SelfLoopUnsupported`, `DegreeOverflow`, and `ArityUnsupported`
variant to `ComputeError` (see `crates/zxw/src/error.rs`).

---

## 6. Phase 5 — WASM bindings + Web Worker + frontend

> **Design decision.** The v1 plan called for a direct lazy-import → call
> pattern. That blocks the main thread during contraction and provides no
> progress or cancellation. Phase 5 now uses a **Web Worker** from the
> start — the worker owns the WASM instance, the main thread communicates
> via message-passing, and the frontend wrapper API accepts an
> `AbortSignal` + `onProgress` callback. This is the foundation; future
> phases (optimal contraction ordering, symbolic arithmetic) slot in
> behind the same worker boundary without changing the UI.

### 6.1 Rust side (`wasm.rs`, feature-gated)

**API version constant.** The WASM module exports a version string so the
frontend can assert compatibility before calling any compute function. The
constant is injected at build time from `Cargo.toml`'s `version`:

```rust
#[cfg(feature = "wasm")]
use wasm_bindgen::prelude::*;

/// Return the crate version string. The frontend asserts it matches the
/// expected value before calling any compute function — prevents subtle
/// serde_wasm_bindgen errors when a browser caches an old .wasm file
/// after a deploy that changes the JsValue contract.
#[cfg(feature = "wasm")]
#[wasm_bindgen]
pub fn compute_api_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}
```

**Panic hook (install before anything else).** A Rust panic inside WASM
(e.g. an `ndarray` bounds error mid-contraction, an arithmetic overflow,
a slice index out of range) silently aborts the worker with no diagnostic
by default — the worker just dies and the main thread sees an opaque
"computation error". Install `console_error_panic_hook` so panics surface
as JS `console.error` calls with a Rust backtrace. This is the difference
between a 30-second debug and a silent worker death in production.

Add `console_error_panic_hook` to `Cargo.toml` under the `wasm` feature:

```toml
[dependencies]
# …
console_error_panic_hook = { version = "0.1", optional = true }

[features]
wasm = ["dep:wasm-bindgen", "dep:serde-wasm-bindgen", "dep:console_error_panic_hook"]
```

Install it once on module init:

```rust
#[cfg(feature = "wasm")]
#[wasm_bindgen(start)]
pub fn init_panic_hook() {
    console_error_panic_hook::set_once();
}
```

The `#[wasm_bindgen(start)]` attribute makes the JS glue call `init_panic_hook`
automatically when the module instantiates — no per-function boilerplate,
no way to forget it in a new entry point.

**Progress callback.** The contraction loop calls back into JS periodically.
Use `js_sys::Function` (a raw JS function reference) so the Rust side stays
agnostic of the caller environment (worker, test harness, etc.):

```rust
#[cfg(feature = "wasm")]
#[wasm_bindgen]
pub fn compute_tensor(
    input: JsValue,
    on_progress: Option<js_sys::Function>,
) -> Result<JsValue, JsValue> {
    let graph: zxw::GraphSlice = serde_wasm_bindgen::from_value(input)
        .map_err(|e| JsValue::from_str(&format!("invalid input: {e}")))?;

    // Wrap the JS callback in a Rust closure. When None, the contraction
    // loop skips the progress call with zero overhead.
    let progress: Option<Box<dyn Fn(usize, usize)>> = on_progress.map(|f| {
        Box::new(move |current: usize, total: usize| {
            let _ = f.call2(
                &JsValue::NULL,
                &JsValue::from_f64(current as f64),
                &JsValue::from_f64(total as f64),
            );
        }) as Box<dyn Fn(usize, usize)>
    });

    let result = zxw::compute_tensor(&graph, progress.as_deref())
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    serde_wasm_bindgen::to_value(&result)
        .map_err(|e| JsValue::from_str(&e.to_string()))
}
```

The native `compute_tensor` (in `lib.rs`, not `#[wasm_bindgen]`) accepts
`Option<&dyn Fn(usize, usize)>` directly — no `JsValue` translation needed.
This keeps unit tests simple: pass `None` for progress, or a Rust closure
that pushes into a `Vec` for assertion.

### 6.2 Web Worker architecture

The frontend does **not** import the WASM module directly. Instead, it
spawns a `Worker` that owns the module. The main thread and worker
communicate via structured-clone message-passing.

**Message protocol** (`src/lib/compute/types.ts`):

```ts
import type { GraphSlice } from "@/lib/graph/types";
import type { TensorResult } from "./result-types";

// ── Main → Worker ──────────────────────────────────────────────
export type WorkerRequest =
  | { type: "compute"; requestId: string; graph: GraphSlice }
  | { type: "cancel"; requestId: string }
  | { type: "version-check" };

// ── Worker → Main ──────────────────────────────────────────────
export type WorkerResponse =
  | { type: "progress"; requestId: string; contracted: number; total: number }
  | { type: "result";  requestId: string; result: TensorResult }
  | { type: "error";   requestId: string; error: string }
  | { type: "version-ok";       version: string }
  | { type: "version-mismatch"; expected: string; actual: string };
```

Every message carries a `requestId` so the main-thread client can
multiplex concurrent calls (though v1 only allows one at a time — the
"Compute" button is disabled while a computation is in flight).

**Worker script** (`src/lib/compute/worker.ts`):

```ts
// This file runs in a Web Worker context — no DOM, no React, no store.
// It loads the WASM module once at startup and services compute
// requests sent from the main thread.

let wasm: typeof import("../../../public/wasm/zxw") | null = null;

async function ensureWasm() {
  if (!wasm) {
    wasm = await import("../../../public/wasm/zxw");
    await wasm.default(); // init() — fetches the .wasm artifact
  }
  return wasm;
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;

  switch (msg.type) {
    case "version-check": {
      const w = await ensureWasm();
      self.postMessage({
        type: "version-ok",
        version: w.compute_api_version(),
      });
      break;
    }

    case "compute": {
      const w = await ensureWasm();
      try {
        // Progress callback: the Rust contraction loop calls this
        // after each edge, and we relay it to the main thread.
        const onProgress = (current: number, total: number) => {
          self.postMessage({
            type: "progress",
            requestId: msg.requestId,
            contracted: current,
            total,
          });
        };

        const result = w.compute_tensor(msg.graph, onProgress);
        self.postMessage({ type: "result", requestId: msg.requestId, result });
      } catch (err) {
        self.postMessage({
          type: "error",
          requestId: msg.requestId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      break;
    }

    case "cancel": {
      // v1 cooperative cancellation: the Rust progress callback can
      // throw to unwind the contraction. The worker catches the throw
      // and sends an "error" with "cancelled" so the main-thread
      // promise rejects with an AbortError.
      //
      // Until cooperative cancellation is wired through the WASM
      // boundary, "cancel" is a no-op on the worker side. The
      // main-thread client discards responses for cancelled
      // requestIds, and the UI shows "Cancelling…" until the
      // current contraction finishes naturally.
      break;
    }
  }
};
```

**Cooperative cancellation (future enhancement).** The Rust `on_progress`
closure can be designed to return a `Result<(), CancelToken>` so the loop
can break early. For v1 the cancellation is *soft* — the UI discards the
result of a cancelled request, and the computation runs to completion in
the worker (wasting CPU but not blocking the main thread). Full cooperative
cancellation is a follow-up item tracked in Phase 6.

### 6.3 Frontend wrapper (`src/lib/compute/index.ts`)

The main-thread client that components import. It owns the worker lifecycle,
performs a version check on first use, and exposes an `AbortSignal`-aware
`computeTensor`:

```ts
import { nanoid } from "nanoid";
import type { GraphSlice } from "@/lib/graph/types";
import type { WorkerRequest, WorkerResponse } from "./types";
import type { TensorResult } from "./result-types";

// Source of truth for the expected version: the built wasm's package.json.
// `wasm-pack` emits one at public/wasm/zxw/package.json (see
// https://rustwinds.github.io/npmw/proposals/wasm-pack-package-json.html),
// so importing it directly keeps the frontend and the crate version locked
// without a hand-maintained constant that drifts the moment Cargo.toml bumps.
import wasmPkg from "../../../public/wasm/zxw/package.json";
const EXPECTED_WASM_VERSION = wasmPkg.version;

// ── Worker lifecycle ───────────────────────────────────────────
//
// workerPromise is a memo of the *current* init attempt. The trap to
// avoid: if init rejects and the rejected promise is cached, every
// subsequent computeTensor() call fails immediately with no retry —
// the user has to reload the page. Reset to null on any failure so
// the next call tries again from scratch.

let workerPromise: Promise<Worker> | null = null;

function resetWorkerPromise<T>(err: T): never {
  workerPromise = null;
  throw err;
}

async function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const worker = new Worker(
        new URL("./worker.ts", import.meta.url),
        { type: "module" },
      );

      try {
        // Version handshake — fail early if the deployed .wasm doesn't
        // match what this frontend build expects. The catch below turns
        // any failure (worker load error, version mismatch, timeout)
        // into a retriable state by resetting workerPromise to null.
        const version = await new Promise<string>((resolve, reject) => {
          const onMsg = (e: MessageEvent<WorkerResponse>) => {
            const m = e.data;
            if (m.type === "version-ok") {
              worker.removeEventListener("message", onMsg);
              resolve(m.version);
            } else if (m.type === "version-mismatch") {
              worker.removeEventListener("message", onMsg);
              reject(
                new Error(
                  `WASM version mismatch: frontend expects ${m.expected}, ` +
                  `deployed module is ${m.actual}. Clear browser cache or ` +
                  `redeploy the matching WASM artifact.`,
                ),
              );
            }
          };
          worker.addEventListener("message", onMsg);
          worker.postMessage({ type: "version-check" } satisfies WorkerRequest);
        });

        if (version !== EXPECTED_WASM_VERSION) {
          throw new Error(
            `WASM version mismatch: expected ${EXPECTED_WASM_VERSION}, ` +
            `got ${version}`,
          );
        }

        return worker;
      } catch (err) {
        worker.terminate();
        // Critical: reset the memo so the next computeTensor() call
        // spins up a fresh worker instead of permanently rejecting.
        return resetWorkerPromise(err);
      }
    })();
  }
  return workerPromise;
}

// ── Public API ─────────────────────────────────────────────────

export type ComputeCallbacks = {
  /** Called after each edge is contracted: (contracted, total). */
  onProgress?: (contracted: number, total: number) => void;
  /** Abort to cancel the computation. The promise rejects with an
   *  AbortError; the worker keeps running (v1 soft cancel). */
  signal?: AbortSignal;
};

export async function computeTensor(
  graph: GraphSlice,
  callbacks?: ComputeCallbacks,
): Promise<TensorResult> {
  const worker = await getWorker();
  const requestId = nanoid();
  const { signal, onProgress } = callbacks ?? {};

  return new Promise<TensorResult>((resolve, reject) => {
    // If already aborted, fail immediately.
    if (signal?.aborted) {
      reject(new DOMException("Computation cancelled", "AbortError"));
      return;
    }

    const onMessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      if (msg.requestId !== requestId) return; // not ours

      switch (msg.type) {
        case "progress":
          onProgress?.(msg.contracted, msg.total);
          break;
        case "result":
          cleanup();
          resolve(msg.result);
          break;
        case "error":
          cleanup();
          reject(new Error(msg.error));
          break;
      }
    };

    const onAbort = () => {
      worker.postMessage({ type: "cancel", requestId });
      cleanup();
      reject(new DOMException("Computation cancelled", "AbortError"));
    };

    const cleanup = () => {
      worker.removeEventListener("message", onMessage);
      signal?.removeEventListener("abort", onAbort);
    };

    signal?.addEventListener("abort", onAbort, { once: true });
    worker.addEventListener("message", onMessage);
    worker.postMessage({ type: "compute", requestId, graph });
  });
}
```

**Key properties of this design:**

- **Lazy.** The worker (and the WASM binary) are only loaded on the first
  `computeTensor` call, not at page load.
- **Version-gated.** If the deployed `.wasm` is the wrong version, the
  error is surfaced immediately as a rejected Promise with a clear message
  ("clear browser cache or redeploy").
- **Abort-safe.** The caller passes an `AbortController.signal`; aborting
  it rejects the promise. v1 uses *soft cancel* (the worker keeps running
  but the UI discards the result). Full cooperative cancel is a Phase 6
  enhancement.
- **Testable.** Vitest can mock the `Worker` constructor, or the worker
  module can be imported directly in a Node context (with `initSync` and a
  mock `postMessage`).

### 6.4 UI hookup

- **Toolbar button** (next to Export JSON): `Compute`. Disabled while a
  computation is in flight. Reads `doc.graph` from the store, creates an
  `AbortController`, and calls `computeTensor(graph, { onProgress, signal })`.
- **Progress bar.** While computing, the toolbar shows a determinate
  progress bar (`contracted / total` edges) fed by `onProgress`. A
  **Cancel** button next to it calls `abortController.abort()`.
- **Result panel.** Opens as a side sheet or modal on success. Contents:
  - Shape summary (e.g. `2 × 2 × 2`).
  - Dense value table for ≤ 64 entries. Larger outputs: first 32 entries +
    "… and N more".
  - Per-vertex parse warnings rendered as a collapsible **"Warnings (N)"**
    section (see §5.5 fallback rules).
- **Error display.** Worker-failed-to-load, version mismatch, and compute
  errors (unknown vertex type, inconsistent graph, phase parse failures
  that couldn't fall back) surface as an inline error card replacing the
  result panel. Reuses the existing toast/alert pattern until a proper
  notification system is warranted.
- **Worker teardown.** The worker is long-lived (one per page session). It
  is terminated on page unload via `window.addEventListener("beforeunload",
  () => worker.terminate())`, but otherwise stays warm for subsequent
  compute requests.

---

## 7. Phase 6 — Optimisation (later, but planned)

Out of scope for the v1 deliverable but worth sketching so the data model
supports it:

- **ZXW rewrites** — spider fusion, identity removal, π-commutation,
  bialgebra, Hopf, Euler expansion. Each is a graph rewrite (small,
  local) that reduces the diagram without changing its semantics.
  Implemented as pure functions over `GraphSlice` that return a new
  `GraphSlice`. **This is the trigger to adopt `petgraph`** (§3.3 flip
  condition): model the working graph as a
  `petgraph::stable_graph::StableGraph<VertexData, ()>` and implement
  each rewrite rule as a subgraph-match → replace operation.
- **Multi-phase boxes** — extend `label` (or add a `params` field, or
  accept multiple labels on a single vertex) so a `zbox`/`xbox` can carry
  `2^arity` independent phases.
- **Contraction order** — replace the naive sequential loop with a
  cost-model + tree search via [`cotengrust`](https://github.com/jcmgray/cotengrust)
  (the Rust backend of `cotengra`, the de-facto Python contraction-order
  optimizer in quantum computing). **Adopt when** a real user graph
  exceeds the naïve complexity ceiling (§5.2: ~12 open legs / ~30 total
  legs) — see §3.3 flip condition. Expose it as a separate
  `compute_tensor_optimized` entry point so the naïve path stays as a
  correctness oracle in tests. Alternative: [`omeco`](https://docs.rs/omeco)
  (smaller, less battle-tested).
- **Exact arithmetic** — switch from `Complex<f64>` to a symbolic phase
  representation (e.g. multiples of π stored as `Rational × π`) plus a
  small evaluator. Helps when you want to *prove* two diagrams are equal.
- **Symbolic phases** — accept `\alpha`, `\beta`, etc. in the parser,
  returning a symbolic expression rather than a number.
- **Sparse tensors** — for big diagrams the dense representation blows up.
  CSR/COO with a small symbolic hash would help.
- **Cooperative cancellation** — the Rust progress callback returns
  `Result<(), CancelToken>` so the contraction loop can unwind early when
  the user hits Cancel. v1 soft-cancel already works from the UI side; this
  makes the worker stop wasting CPU.

These all live behind the same `compute_tensor` boundary so the frontend
doesn't change.

---

## 8. Repo / build updates that go alongside

| File | Change |
|---|---|
| `AGENTS.md` | **Already partly landed.** Stale path reference `doc/plans/zxw-compute-backend.md` → `doc/plans.md` (still present in the "Rust compute layer" section). Vertex-type list (8) ✓. Label-as-phase convention ✓. `crates/zxw/` layout ✓. Verify against the current §3.1 single-`nodes.rs` layout after Phase 3 task #0 lands. |
| `.gitignore` | Add `crates/zxw/target`, `crates/zxw/pkg`, `public/wasm/`. |
| `package.json` | Add `"build:wasm"` script ✓ (already present); `katex` dep for Phase 0 ✓. |
| `doc/readme.md` | Note compute capability and `pnpm build:wasm` step. |
| `pnpm-workspace.yaml` | No change — pnpm workspace is JS-only; Rust workspace is separate. |
| `crates/zxw/src/*.rs` headers | Every source-file header comment cites `doc/plans/zxw-compute-backend.md` (the old path). Bulk-replace with `doc/plans.md` as part of the Phase 3 task #0 `lib.rs` reconciliation. |
| `crates/zxw/Cargo.toml` | Add `console_error_panic_hook` under the `wasm` feature (§6.1). **No graph/contraction crate in v1** — see §3.3. `petgraph` and `cotengrust` are Phase 6 additions, gated on their flip conditions. |

---

## 9. Verification ladder

Acceptance is gated on each phase passing the next rung:

1. `cargo build` + `cargo test` clean on `crates/zxw`.
2. `pnpm build:wasm` produces a working WASM module.
3. `cargo test` covers Phase 3 tensor identities + Phase 4 contraction
   cases. JS/Rust parser cross-tests pass.
4. A `vitest` unit test for `src/lib/compute/index.ts` mocks the WASM
   module (so CI stays JS-only) and asserts the wrapper contract.
5. Manual smoke: open the app, drop a few vertices, click `Compute`, see
   a sensible result.

---

## 10. Risks / open design questions

- **WASM bundle size.** `ndarray` adds ~150 KB before gzip; OK for a
  desktop-first tool, but if we ever ship mobile we'll want a slim build
  with the optional `wasm` feature flag (already in the plan).
- **Phase-as-label conflation.** A user who named a vertex "Z" (text
  label) gets a warning at compute time and the spider silently uses
  phase 0. Mitigation lives in the warning panel; we could add a
  confirmation dialog at first mismatch but that's friction.

- **Worker initialisation cost.** The worker + WASM binary are loaded
  lazily on first `computeTensor` call, which adds ~200–500 ms of
  cold-start latency (network fetch + WASM instantiation). For a
  Compute button that's clicked once per editing session this is fine,
  but if the interaction model evolves to "recompute on every edit"
  the worker should be pre-warmed on page load (or the WASM module
  should be preloaded via `<link rel="preload">`).

- **Soft cancel wastes CPU.** v1 cancellation is "soft" — the worker
  runs to completion and the UI discards the result. For graphs with
  30+ edges this wastes seconds of CPU. Full cooperative cancellation
  (the Rust progress callback returns a `Result` that unwinds the
  contraction loop) is tracked as a Phase 6 enhancement.

- **Disconnected-component output blow-up.** v1 outer-products all
  components into one `TensorResult` (§5.6). For graphs with many
  components and many open legs, the output shape is the product of
  the component shapes — exponential blow-up. Phase 6 likely returns
  per-component results, which changes the worker protocol.

> **Previously open, now resolved:**
> - **Main-thread blocking** → Web Worker moves computation off the
>   main thread (Phase 5 design).
> - **No progress or cancellation** → `onProgress` callback +
>   `AbortSignal` (Phase 5 design).
> - **WASM version drift** → `compute_api_version()` handshake on
>   worker init; expected version derived from the built wasm's
>   `package.json` so it can't drift on a Cargo.toml bump (§6.3).
> - **Directional convention for W/AND** → **renderer-only**. The
>   tensor treats all legs of W and AND as equivalent (standard ZXW
>   convention). Locked in §4.3 + the conventions block.
> - **Graph-document validity** → locked v1 policy in §5.6:
>   disconnected components outer-producted; self-loops rejected with
>   `ComputeError::SelfLoopUnsupported`; multi-edges supported; empty
>   graph → scalar 1.
> - **zbox/xbox v1 semantics** → **single-phase diagonal** (all-1s
>   index → `e^{iφ}`, else 1). Multi-phase deferred to Phase 6. §4.3.

---
