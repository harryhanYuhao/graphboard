# AGENTS.md

Guidance for ZCode agents working in this repository. The detailed companion
doc is `CLAUDE.md` (gitignored) — read it before changing editor/selection
behavior.

## What this is

Graph Board is an online graph editor for **ZXW calculus** (a quantum
computing diagrammatic calculus). Client-side only Next.js app: users place
  vertices, connect them with edges, compute the represented tensor via a
  Rust/WASM compute layer, and export the graph as JSON. No server —
  client-side only, with persistence in `localStorage` plus manual file
  export.

## Commands

Uses **pnpm** (see `pnpm-workspace.yaml`).

- `pnpm dev` — dev server (Next.js, Turbopack)
- `pnpm build` — production build into `.next/`
- `pnpm start` — serve the production build
- `pnpm lint` — ESLint (`eslint-config-next`, core-web-vitals + TypeScript)
- `pnpm test` / `pnpm test:watch` / `pnpm test:ui` — vitest (jsdom env).
  Pure-function helpers and store actions are covered; renderer
  components have a thin test surface (snapshotting a styled body
  pixel-for-pixel isn't worth the maintenance burden today).

Typecheck runs through `next build` and the VS Code TS SDK
(`.vscode/settings.json`); no dedicated `typecheck` script.

## Layout

- `src/app/` — Next.js App Router entry (`page.tsx` → `GraphEditor`, single page).
- `src/components/graph-editor/` — editor UI. `VertexNode.tsx` is the body;
  it composes `VertexGlyphs.tsx` (SVG shapes), `VertexHandles.tsx` (React
  Flow `<Handle>`s), `VertexLabelEditor.tsx` (inline phase/text edit), plus
  `VertexPropertyPanel.tsx`, `VertexSwatch.tsx`, `VertexTypeMenu.tsx`,
  `GraphToolbar.tsx`, dialog components.
- `src/lib/graph/edge-geometry.ts` — pure edge-endpoint math (rotation-aware)
  for `StraightCenterEdge`. Keep geometry here, not in the component, so it
  is unit-testable without React Flow.
- `src/lib/keyboard/shortcuts.ts` — **display-only** shortcut registry.
  `src/components/graph-editor/useKeyboardShortcuts.ts` is the actual
  dispatch. If you add a shortcut, add it to both.
- `src/store/graph-store.ts` — Zustand store, single source of truth for graph state.
- `src/store/selectors.ts` — pure selector functions over `GraphStore` state
  (e.g. `selectSelectedNodeIds`, `hasSelection`).
- `src/lib/graph/` — pure graph logic: `types.ts`, `operations.ts`
  (create/delete), `serialization.ts` (document + `localStorage`),
  `vertex-types.ts` (ZXW generator metadata).
- `src/lib/hooks/` — small reusable React hooks (e.g. `useTrackedDraft`).
- `src/lib/download.ts`, `src/lib/filename.ts` — JSON export helpers.
- `src/lib/compute/` — browser-side wrapper around the Rust/WASM compute
  layer. `index.ts` owns the Web Worker lifecycle and exposes
  `computeTensor(graph, callbacks)` (the single entry point components
  call); `worker.ts` is the worker that lazy-loads the wasm; `types.ts`
  is the main↔worker message protocol; `result-types.ts` mirrors the
  Rust `TensorResult`. See §"Rust compute layer" below before touching it.
- `crates/zxw/` — Rust compute layer (ZXW calculus tensor evaluation).
  See `doc/plans.md` for the full plan; the
  short version is below.
- `scripts/build-wasm.sh` — `wasm-pack build` driver.
- `scripts/ping-wasm.mts` — smoke test for the WASM pipeline.
- `src/test-utils/factories.ts` — shared `makeVertex` / `makeEdge`
  factories for vitest. Use these in new tests so a future change
  to the `VertexNode` / `GraphEdge` types surfaces here, not in
  every test file.
- `src/types/file-system-access.d.ts` — typings for the File System Access API.

## Architecture rules

- **State flow:** all graph state lives in one Zustand store
  (`useGraphStore`). Components read slices and dispatch actions — no local
  state for graph data. React Flow runs in controlled mode: `nodes`/`edges`
  come from the store, and `onNodesChange`/`onEdgesChange` route back into
  store actions via `applyNodeChanges`/`applyEdgeChanges`.
- **Undo/redo** is powered by `zundo` (`temporal` middleware) on
  `useGraphStore.temporal`. Structural mutations (add/delete vertex/edge,
  label/phase edits) are tracked normally; **visual** changes (drag, select
  toggle) are deliberately kept off the undo stack by pausing the temporal
  store for the gesture and pushing a single pre-gesture snapshot on end.
  Drag handlers (`onNodeDragStart`/`Stop`) own this pause/resume logic — see
  the long comment block in `graph-store.ts` before touching it. `hydrate`,
  `importGraphJson`, and `clear` call `temporal.getState().clear()` so a new
  document doesn't carry the old undo history.
- **Keep mutation logic in `src/lib/graph/operations.ts`** — call it from the
  store, not inline in components.
- **Editor modes** (`EditorMode` in `src/lib/graph/types.ts`): `"select" |
  "add-vertex" | "add-edge"`. `setMode` clears selection and any pending edge
  source on every switch.
- **Edge creation is click-to-connect only** (no drag-connect): in `add-edge`
  mode, the first vertex click sets `pendingEdgeSourceId`, the second
  connects them via `handleVertexClick`. Drag-connect is disabled
  (`nodesConnectable={false}`).
- **Selection & deletion:** React Flow's built-in click selection plus a
  global `Backspace`/`Delete` keydown listener that calls `deleteSelected()`
  (which also removes edges connected to deleted nodes). There is no
  marquee/rubber-band selection.
- **Custom React Flow types** (registered memoized in `GraphEditor.tsx`):
  - `vertex` → `VertexNode.tsx` — composes `VertexGlyphs` + `VertexHandles` +
    `VertexLabelEditor`. Handles are placed per `isDirectionalVertex` (see
    below); a single source handle accepts any number of fan-out connections.
  - `straight-center` → `StraightCenterEdge.tsx` — straight line whose
    endpoints come from `src/lib/graph/edge-geometry.ts` (node centers, or
    the rotating top-edge dot for directional targets), **not** React Flow's
    default border-to-border.
- **Handles & directional vertices:** `HANDLE_IDS` in
  `src/lib/graph/types.ts` (`center-source`, `center-target`, `top`) is the
  contract shared by operations, serializer, and renderer — don't sprinkle
  the string literals elsewhere. `isDirectionalVertex(type)` (in
  `vertex-types.ts`) selects the W / And-gate layout (visible `top` target
  dot + centered source) vs the symmetric layout (centered target + source).
  Persisted handle ids are **numeric indices** (0 = top, 1 = bottom),
  translated by `handleIdToIndex` / `indexToHandleId` in `serialization.ts`.
- **Vertex rotation** is a **view-slice** concern: the runtime `VertexNode`
  carries `rotation` as a top-level field (outside `data`), persisted under
  `view.nodes[].rotation`. It is CSS-only — the compute layer never sees it.
  It affects edge endpoint math (`edge-geometry.ts`), not the graph.

## Conventions

- Path alias `@/*` → `src/*`.
- Any component touching the store, `window`, or React Flow must be a
  `"use client"` component.
- Styling is **Tailwind CSS v4** (config-less, via `@tailwindcss/postcss`);
  write utility classes inline. Icons from `lucide-react`.
- IDs via `nanoid`.
- **Vertex types** are the ZXW generators plus two boundary markers:
  `"z" | "empty" | "x" | "w" | "h" | "zbox" | "xbox" | "and" | "input" | "output"`,
  see `src/lib/graph/vertex-types.ts`. `VERTEX_TYPES` is the single source
  of truth for shape/color/size (and optional `glyph`) consumed by
  `VertexNode`, `VertexSwatch`, `VertexTypeMenu`, and `VertexPropertyPanel`
  — keep them in sync when adding/changing a type. The predicates
  `isSpiderType(type)` (label is a phase), `isDirectionalVertex(type)`
  (W / And gate handle layout), and `isBoundaryVertex(type)`
  (`input` / `output` — not tensors, declare open legs of the result) are
  the single sources of truth for those three behaviors.

### Rust compute layer

The Rust crate `crates/zxw/` is the compute boundary — it consumes the
`graph` slice of a `GraphDocument` (see §"Document shape (v1)" below)
and returns a tensor result. Same crate, two build targets:

- **Native** — `cargo test -p zxw`, `cargo build -p zxw`. No WASM, no
  browser. Used by Rust-side unit + integration tests.
- **WASM** — `pnpm build:wasm`. Runs `wasm-pack build crates/zxw
  --target web --features wasm --out-dir public/wasm/zxw`. Output is
  gitignored; the Next.js dev server serves it as a static asset.

When to rebuild the wasm: any time Rust source changes. The dev server
itself doesn't watch the wasm, so refresh the browser after a rebuild.

The frontend calls into the wasm through `src/lib/compute/index.ts` →
`computeTensor(graph, callbacks)`. That entry point spawns a Web Worker
(`worker.ts`) that lazy-loads `public/wasm/zxw/zxw.js` and runs the
contraction off the main thread. On first use a **version handshake**
refuses to call a stale cached `.wasm`: the worker returns
`compute_api_version()` and the wrapper compares it against the version
imported from `public/wasm/zxw/package.json` (emitted by `wasm-pack` on
every build). `onProgress` and an `AbortSignal` plumb through to the
UI; v1 cancel is *soft* (main thread discards the result, the worker
runs to completion — cooperative cancellation is a Phase 6 item). The
compute wrapper reads only `doc.graph`, never `doc.view`.

WASM exports (in `crates/zxw/src/wasm.rs`, feature-gated to `wasm`):

- `ping()` — round-trip smoke test used by `scripts/ping-wasm.mts`.
- `compute_api_version()` — crate version, for the handshake above.
- `compute_tensor(input, on_progress?)` — real entry point. `input` is a
  `GraphSlice` JS object (camelCase); returns a `TensorResult` JS object.
  Structural errors throw a JS `Error`; per-spider phase-parse failures
  are **not** errors — they surface on `result.warnings` (plan §5.5).
- `init_panic_hook()` — `#[wasm_bindgen(start)]`, auto-runs on
  instantiation so panics reach `console.error` instead of aborting
  silently.

`src/lib/compute/result-types.ts` mirrors the Rust `TensorResult`
(`crates/zxw/src/contraction.rs`); keep the two in sync when adding
fields. `index.test.ts` asserts the field names.

Public plan: `doc/plans.md`. Treat that doc as the contract — if you
change the compute boundary, update the plan too.

### Label as phase (spider / box types)

For `z`, `x`, `zbox`, `xbox` the vertex `label` carries **the phase
expression**, not a free-form name. For `empty`, `w`, `h`, `and` the
label is decoration only. The split is exposed via
`isSpiderType(vertexType)` in `src/lib/graph/vertex-types.ts` — that's
the single source of truth for "should this label be parsed as a
phase?".

- A label that is exactly `$...$` or `$$...$$` is rendered with KaTeX
  (see `src/lib/label/renderLabel.ts`) and parsed as a phase by
  `src/lib/phase/parser.ts`. Anything else renders as plain text.
- An empty label on a spider means phase 0 (identity).
- Phase grammar (v1, numeric only): numbers, `\pi`, `+ - * / ( )`,
  unary minus / plus. Free variables (`\alpha`, `\beta`, …) are
  errors in v1; Phase 6 introduces symbolic arithmetic.

The Rust compute layer ports the same grammar
(`crates/zxw/src/phase.rs`) so labels parse identically on both sides
of the WASM boundary; `crates/zxw/tests/phase_grammar.rs` pins it.

## Persistence & export gotchas

- Auto-save is debounced (~2s) in `GraphEditor.tsx` after node/edge changes.
- `localStorage` key: `graph-board-document`.
- All storage functions guard `typeof window === "undefined"` for SSR safety.
- JSON export (`exportJson` → `src/lib/download.ts`) prefers the File System
  Access API (`window.showSaveFilePicker`) and falls back to anchor-download.
  `src/lib/filename.ts` sanitizes the title into a safe filename.

## Document shape (v1): graph vs view

Persisted documents (`GraphDocument`, see `src/lib/graph/types.ts`) are
**split** into two parallel slices:

- **`graph`** — graph-theoretic info only. `nodes: { id, data: { label,
  vertexType } }[]` and `edges: { id, source, target, sourceHandle?,
  targetHandle? }[]` (handle fields are numeric indices, see §"Handles"
  above). This is the contract that the future Rust/WASM compute layer (and
  any external researcher's tooling) consumes.
- **`view`** — visual info only. `nodes: { id, position, rotation? }[]` and
  `edges: { id }[]` today; future edge curvature, group colors, etc. will
  live here.

The runtime store still holds React Flow's own `Node`/`Edge` objects
(`VertexNode` / `GraphEdge`) because that's what React Flow consumes.
Conversion happens at the persistence boundary in `serialization.ts`:

- `projectDocument(runtime)` → v1 doc (called from `saveGraphDocument`
  and `exportGraphJson`).
- `hydrateDocument(doc)` → runtime objects (called from `loadGraphDocument`
  consumers — i.e. the store's `hydrate` action).

**Rules of thumb:**

- The compute boundary (`src/lib/compute/` when it lands) reads only
  `doc.graph` — never `doc.view`.
- Selection (`selected`), `origin`, React Flow's `type` discriminator
  (`"vertex"` / `"straight-center"`), and runtime `measured` /
  `internals.*` fields are **never** persisted. (Pre-v1, selection
  accidentally survived reloads — the split fixes that.)
- Schema versioning lives in `CURRENT_SCHEMA_VERSION` (= `1`). Bump it
  when the shape changes again and add a migration step in
  `loadGraphDocument` / `importGraphJson`.
