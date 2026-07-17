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

## 3. Phase 2 — Cargo workspace + `zxw` crate + WASM build (Finished, Stubs in place)

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

### 3.1 WASM build pipeline

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

> **Pre-Phase-3 prep.** Phase 1's `parser.test.ts` is currently 52 inline
> cases. Refactor it to be data-driven from the JSON fixture before the
> Rust port lands, so adding a new case is a one-file edit.

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

// ── Worker lifecycle ───────────────────────────────────────────

const EXPECTED_WASM_VERSION = "0.1.0";

let workerPromise: Promise<Worker> | null = null;

async function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const worker = new Worker(
        new URL("./worker.ts", import.meta.url),
        { type: "module" },
      );

      // Version handshake — fail early if the deployed .wasm doesn't
      // match what this frontend build expects.
      const version = await new Promise<string>((resolve, reject) => {
        const onMsg = (e: MessageEvent<WorkerResponse>) => {
          const m = e.data;
          if (m.type === "version-ok") {
            worker.removeEventListener("message", onMsg);
            resolve(m.version);
          } else if (m.type === "version-mismatch") {
            worker.removeEventListener("message", onMsg);
            worker.terminate();
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
        worker.terminate();
        throw new Error(
          `WASM version mismatch: expected ${EXPECTED_WASM_VERSION}, ` +
          `got ${version}`,
        );
      }

      return worker;
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

> **Previously open, now resolved by the Phase 5 design:**
> - Main-thread blocking → Web Worker moves computation off the main thread.
> - No progress or cancellation → `onProgress` callback + `AbortSignal`.
> - WASM version drift → `compute_api_version()` handshake on worker init.

---
