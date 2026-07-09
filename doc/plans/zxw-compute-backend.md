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
  (the AGENTS.md snippet that lists only five is stale; we fix it in passing).
- Vertex data is `{ label: string, vertexType: VertexType }`. **No dedicated
  phase field** — by user decision, `label` *is* the phase for spider types
  (`z`, `x`, `zbox`, `xbox`); for other vertex types it's free-form text.
  Empty label on a spider = phase 0. Phase 1 below pins this convention in
  code; Phase 0 adds the matching LaTeX rendering that the user types into.
- The user's stated architecture decision: a single Rust crate compiled to
  WASM (`wasm-pack`), consumed from a thin frontend wrapper. Reconfirmed in
  user memory and AGENTS.md ("future Rust/WASM compute layer").

### Goal of this plan

A working end-to-end pipeline:

```
React Flow graph  →  GraphDocument (JSON)  →  Rust/WASM  →  TensorResult
```

…that returns a numerically meaningful tensor for arbitrary ZXW graphs
(including phase semantics carried in `label`), with a `Compute` button in
the toolbar to drive it and a result panel to display shape + values.

### Conventions introduced in this plan (lock these in)

| Vertex type | `label` semantics |
|---|---|
| `z`, `x`, `zbox`, `xbox` | Phase expression, optionally LaTeX. Empty = phase 0. |
| `empty`, `w`, `h`, `and` | Free-form text. Not parsed for compute. |

**LaTeX detection rule** (UI): if the label contains `$…$` or `$$…$$`,
render with KaTeX; otherwise plain text. Standard Markdown convention.
Applies to **all** vertex types (so a user can put math in any label as
decoration); the *parse* step only fires for the four spider types.

---

## 1. Phase 0 — LaTeX rendering for `label`

**Why first.** Phase expressions in ZXW are math (α, β, π/4, e^{iφ}). Without
LaTeX, the only way to write a phase is raw text ("alpha", "pi/4") — ugly and
ambiguous. KaTeX gives us proper rendering with one tiny dep, and it's
useful independently of compute (any vertex can show math in its label).

**Scope.** Small, self-contained UI feature. ~half a day.

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

**Verification.**

- `pnpm build` clean.
- Vitest cases for `isLatexLabel` and `renderLabel`:
  - `"\\alpha"` (no delimiters) → plain text.
  - `"$\\alpha$"` → KaTeX HTML containing an `annotation` element.
  - `"$$\\frac{\\pi}{4}$$"` → KaTeX block.
  - Empty label → empty HTML.
- Manual: open the editor, type `$\alpha + \frac{\pi}{4}$` into a Z spider
  label, see it rendered.

---

## 2. Phase 1 — `label`-as-phase convention + JS phase parser

**Why second.** Phase 0 gives us the *display*. Phase 1 gives us the *meaning*:
the same string the user typed is what the Rust compute layer will parse at
runtime. The JS parser in this phase gives the property panel a live preview
("= 0.785 rad"); Phase 3 ports the same grammar to Rust.

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
term    := factor (('*' | '/') factor)*
factor  := number | '\pi' | 'pi' | 'PI' | '(' phase ')' | unary
unary   := '-' factor
number  := [0-9]+ ('.' [0-9]+)?
```

- `\pi` evaluates to a constant (≈ 3.14159…).
- Any other named token (`\alpha`, `\beta`, `\theta`, …) is an **error** in
  v1 — Phase 6 introduces symbolic arithmetic.
- Whitespace ignored. Unicode minus `−` accepted alongside ASCII `-`.

**Parser API.**

```ts
// src/lib/phase/parser.ts
export type PhaseResult =
  | { ok: true; radians: number }
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

## 3. Phase 2 — Cargo workspace + `zxw` crate + WASM build

### 3.1 Workspace layout

Single Rust crate with a `wasm` feature flag, kept under a new top-level
`crates/` directory. A single crate is enough for v1; split into multiple
crates (`zxw-core` vs `zxw-wasm`) only if compile times or boundaries demand.

```
graph-board/
├── crates/
│   └── zxw/
│       ├── src/
│       │   ├── lib.rs                # pub use of public API
│       │   ├── graph.rs              # ZXW graph data model (serde)
│       │   ├── phase.rs              # LaTeX phase parser (Rust port)
│       │   ├── tensor.rs             # Tensor / Complex wrappers
│       │   ├── spiders.rs            # Z/X spider builders
│       │   ├── boxes.rs              # Z/X box builders
│       │   ├── nodes.rs              # W / H / empty / and builders
│       │   ├── contraction.rs        # Naive sequential contraction
│       │   ├── error.rs              # thiserror types
│       │   └── wasm.rs               # #[wasm_bindgen] entry points (gated)
│       ├── tests/
│       │   ├── phase_grammar.rs      # matches the JS parser's tests
│       │   ├── tensor_correctness.rs # spider+box identities, H·H = I, etc.
│       │   └── contraction.rs        # small graphs, end-to-end
│       ├── Cargo.toml
│       └── pkg/                      # wasm-pack output, gitignored
└── …
```

### 3.2 Top-level `Cargo.toml` (workspace)

```toml
[workspace]
resolver = "2"
members = ["crates/zxw"]

[profile.release]
lto = true
opt-level = "z"
codegen-units = 1
panic = "abort"     # smaller WASM
```

### 3.3 `crates/zxw/Cargo.toml`

```toml
[package]
name = "zxw"
version = "0.1.0"
edition = "2021"

[features]
default = []
wasm = ["dep:wasm-bindgen", "dep:serde-wasm-bindgen"]

[dependencies]
serde = { version = "1", features = ["derive"] }
serde_json = "1"
num-complex = "0.4"
ndarray = "0.15"
thiserror = "1"
wasm-bindgen = { version = "0.2", optional = true }
serde-wasm-bindgen = { version = "0.6", optional = true }

[dev-dependencies]
approx = "0.5"          # float-approx for tensor equality in tests
```

**Why these crates**

- `ndarray` for N-dim tensor storage + einsum-style contraction. Hand-rolled
  indexing is doable but ndarray is well-tested and gives us `.remove_axis()`
  + `.fold_axis()` for free.
- `num-complex` for `Complex<f64>`. Phases need exact trig for Clifford
  values (sin/cos of multiples of π/4) — `num-complex::Complex::from_polar`
  is enough at v1; symbolic-exact arithmetic is a later phase.
- `serde` + `serde_json` for the `GraphSlice` contract on both sides (WASM
  uses `serde_wasm_bindgen` to hop into JS values).
- `thiserror` for ergonomic error enums.

### 3.4 WASM build pipeline

- The `wasm` feature flag in the crate.
- A top-level script `scripts/build-wasm.sh` that runs
  `wasm-pack build crates/zxw --target web --features wasm --out-dir ../../public/wasm/zxw`.
- Output is committed nowhere; `.gitignore` excludes `public/wasm/`. Add a
  `pnpm` script: `"build:wasm": "bash scripts/build-wasm.sh"`.
- Dev loop: `pnpm dev` (Next.js) + run `pnpm build:wasm` whenever Rust
  changes. Document the loop in `doc/readme.md`.

**Verification for Phase 2**

- `cargo test -p zxw` runs the empty crate + compiles cleanly.
- `pnpm build:wasm` produces `public/wasm/zxw/zxw_bg.wasm` and the JS glue.
- A trivial `#[wasm_bindgen] fn ping() -> &'static str { "pong" }` round-trips
  from a one-off `pnpm tsx scripts/ping-wasm.ts` script.

---

## 4. Phase 3 — Rust phase parser + Tensor model + per-vertex builders

### 4.1 Rust phase parser (`crates/zxw/src/phase.rs`)

Direct port of the JS grammar in Phase 1. Same recursive-descent shape:

```rust
pub enum PhaseError {
    UnknownVariable(String),
    UnexpectedToken { found: String, position: usize },
    Empty,
    TrailingInput { position: usize },
}

pub fn parse_phase(input: &str) -> Result<f64, PhaseError>;
```

**Cross-language tests.** A shared test fixture (a JSON table of inputs and
expected outputs) lives at `crates/zxw/tests/fixtures/phase_grammar.json`.
Both `crates/zxw/tests/phase_grammar.rs` and `src/lib/phase/parser.test.ts`
load it and assert equality — guarantees the parsers stay in sync.

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

| Builder | Tensor shape | Non-zero entries |
|---|---|---|
| `z_spider(arity, phase)` | `(2,)*arity` | `(0,0,…,0) → 1`, `(1,1,…,1) → e^{i·phase}` |
| `x_spider(arity, phase)` | `(2,)*arity` | Same as Z but in X basis (H⊗…⊗H applied to Z spider). |
| `w_node(arity)` | `(2,)*arity` | Any `i` with exactly one bit set → 1; else 0. (Directional in the renderer only.) |
| `h_box()` | `(2, 2)` | Standard 2×2 Hadamard, `1/√2 · [[1,1],[1,-1]]`. Fixed arity 2; for larger circuits the user chains H-boxes. |
| `z_box(arity, phases: &[f64])` | `(2,)*arity` | Diagonal in Z basis with `2^arity` independent phases (full generality). |
| `x_box(arity, phases: &[f64])` | `(2,)*arity` | Same but X basis. |
| `empty()` | `[]` (scalar) | 1. Constant. |
| `and_gate(arity)` | `(2,)*arity` | All `1`s → 1, else 0. |

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
- **Box parameters** — `phases: &[f64]` accepts `2^arity` phases. The
  label-as-phase convention only carries a single expression; multiple
  phases for box types need a different encoding. Defer multi-phase boxes
  to Phase 6; for v1 the box builders accept only a single phase and
  ignore the others (or refuse to render — TBD with D4).

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

**Leg bookkeeping.** Each vertex `v` starts with `arity(v) = degree(v)`
free legs indexed `0..arity(v)`. When we contract edge `(u, v)`:

- Take axis 0 of `u` and axis 0 of `v` (or any unused axes — symmetric
  indices, so order doesn't affect the value).
- Remove those axes. `arity(u)` and `arity(v)` both decrement.
- If `u` already belongs to a group with tensor `T_u`, we contract `T_u`
  with `t_v` along an axis of `T_u` (the running contraction's free legs
  are `arity(u) + sum_of_arities_of_others_in_group`, so we use any free
  axis of the group tensor that corresponds to `u`'s slot).

Use a `union-find` of vertex IDs → group IDs, with each group owning one
`Tensor` and a vector of `free_axes` (one per member's remaining legs).
Simplest bookkeeping that works.

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

---

## 6. Phase 5 — WASM bindings + frontend wrapper

### 6.1 Rust side (`wasm.rs`, feature-gated)

```rust
#[cfg(feature = "wasm")]
use wasm_bindgen::prelude::*;

#[cfg(feature = "wasm")]
#[wasm_bindgen]
pub fn compute_tensor(input: JsValue) -> Result<JsValue, JsValue> {
    let graph: zxw::GraphSlice = serde_wasm_bindgen::from_value(input)
        .map_err(|e| JsValue::from_str(&format!("invalid input: {e}")))?;
    let result = zxw::compute_tensor(&graph)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    serde_wasm_bindgen::to_value(&result)
        .map_err(|e| JsValue::from_str(&e.to_string()))
}
```

Re-export `zxw::*` from `lib.rs`; the WASM module is a thin shim.

### 6.2 Frontend side

Create `src/lib/compute/index.ts`:

```ts
// Thin client over the WASM module. Lazy-initialises.
let initPromise: Promise<unknown> | null = null;

async function ensureWasm(): Promise<typeof import("../../../public/wasm/zxw")> {
  if (!initPromise) {
    initPromise = import("../../../public/wasm/zxw").then((m) => m.default());
  }
  await initPromise;
  return import("../../../public/wasm/zxw");
}

export async function computeTensor(graph: GraphSlice): Promise<TensorResult> {
  const wasm = await ensureWasm();
  // Hand wasm the GraphSlice directly — it deserialises via serde_wasm_bindgen.
  return wasm.compute_tensor(graph) as TensorResult;
}
```

### 6.3 UI hookup

- New toolbar button (next to Export JSON): `Compute`. Calls
  `computeTensor(doc.graph)` and shows the result in a side panel.
- Result panel: shape summary + dense value table for small outputs
  (≤ 32 entries). For larger outputs, show first 32 + "total: N".
- Errors (parse failure, unknown vertex type, inconsistent graph) surface
  inline with the panel; the panel reuses the existing `window.alert`
  pattern for now and we revisit when there's a second use case for
  proper toasts.
- Per-vertex parse warnings (from the fallback-to-phase-0 rule) appear
  as a collapsible "warnings (3)" section above the result.

---

## 7. Phase 6 — Optimisation (later, but planned)

Out of scope for the v1 deliverable but worth sketching so the data model
supports it:

- **ZXW rewrites** — spider fusion, identity removal, π-commutation,
  bialgebra, Hopf, Euler expansion. Each is a graph rewrite (small,
  local) that reduces the diagram without changing its semantics.
  Implemented as pure functions over `GraphSlice` that return a new
  `GraphSlice`.
- **Multi-phase boxes** — extend `label` (or add a `params` field, or
  accept multiple labels on a single vertex) so a `zbox`/`xbox` can carry
  `2^arity` independent phases.
- **Contraction order** — replace the naive sequential loop with a
  cost-model + tree search (a la `opt_einsum` / `cotengra`). For now,
  expose the contraction as a separate function so this swap is
  mechanical.
- **Exact arithmetic** — switch from `Complex<f64>` to a symbolic phase
  representation (e.g. multiples of π stored as `Rational × π`) plus a
  small evaluator. Helps when you want to *prove* two diagrams are equal.
- **Symbolic phases** — accept `\alpha`, `\beta`, etc. in the parser,
  returning a symbolic expression rather than a number.
- **Sparse tensors** — for big diagrams the dense representation blows up.
  CSR/COO with a small symbolic hash would help.

These all live behind the same `compute_tensor` boundary so the frontend
doesn't change.

---

## 8. Repo / build updates that go alongside

| File | Change |
|---|---|
| `AGENTS.md` | Fix stale vertex-type list (now 8). Document label-as-phase convention. Add a section on `crates/zxw/` layout + how to build WASM. |
| `.gitignore` | Add `crates/zxw/target`, `crates/zxw/pkg`, `public/wasm/`. |
| `package.json` | Add `"build:wasm"` script; add `katex` dep for Phase 0. |
| `doc/readme.md` | Note compute capability and `pnpm build:wasm` step. |
| `pnpm-workspace.yaml` | No change — pnpm workspace is JS-only; Rust workspace is separate. |

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
- **Directional convention for W/AND.** Renderer vs tensor. We treat the
  tensor as fully symmetric and let the renderer add the visual cue.
  Confirm this matches your convention.
- **Graph-document validity.** What counts as a "valid" ZXW graph for
  computation? Disconnected components? Self-loops (edge from v to v)?
  Multi-edges between the same pair? Decide per builder whether to
  reject loudly or contract silently.

---

## 11. Decisions to lock in before Phase 0 starts

These are the ones I want you to call before any code lands:

- **D1.** Phase unit in user-facing label: any LaTeX the user types
  (e.g. `$\pi/4$`, `$\alpha$`, `0.5\pi`). My rec: any LaTeX, parser
  is permissive about spacing.
- **D2.** Phase parsing tolerance: silent fallback to phase 0 with a
  warning when the label doesn't parse, vs hard error? My rec: silent
  fallback + warning, so old hand-edited graphs don't break.
- **D3.** Empty vertex: scalar 1, 1-leg identity, or something else?
  My rec: scalar 1 (matches ZX-calculus "ground" symbol).
- **D4.** Should box types (`zbox`, `xbox`) be in v1 at all, given the
  single-label limitation? Options: (a) ship them as single-phase for
  v1 (loose semantics), (b) skip them entirely until Phase 6 introduces
  multi-phase encoding, (c) invent a multi-label encoding now
  (`labels: string[]`). My rec: (b) — skip until Phase 6.
- **D5.** Numerical arithmetic (`f64`) vs exact (`Rational × π`) for
  v1? My rec: numerical `f64`. Exact is Phase 6.

Once these are settled I'll spin up a branch and execute Phase 0 + Phase 1.