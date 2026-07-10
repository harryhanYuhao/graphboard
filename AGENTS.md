# AGENTS.md

Guidance for ZCode agents working in this repository. The detailed companion
doc is `CLAUDE.md` (gitignored) — read it before changing editor/selection
behavior.

## What this is

Graph Board is an online graph editor for **ZXW calculus** (a quantum
computing diagrammatic calculus). Client-side only Next.js app: users place
vertices, connect them with edges, and export the graph as JSON. No backend —
persistence is `localStorage` plus manual file export.

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
- `src/components/graph-editor/` — editor UI (canvas, toolbar, custom node/edge).
- `src/store/graph-store.ts` — Zustand store, single source of truth for graph state.
- `src/store/selectors.ts` — pure selector functions over `GraphStore` state
  (e.g. `selectSelectedNodeIds`, `hasSelection`).
- `src/lib/graph/` — pure graph logic: `types.ts`, `operations.ts`
  (create/delete), `serialization.ts` (document + `localStorage`),
  `vertex-types.ts` (ZXW generator metadata).
- `src/lib/hooks/` — small reusable React hooks (e.g. `useTrackedDraft`).
- `src/lib/download.ts`, `src/lib/filename.ts` — JSON export helpers.
- `crates/zxw/` — Rust compute layer (ZXW calculus tensor evaluation).
  See `doc/plans/zxw-compute-backend.md` for the full plan; the
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
  - `vertex` → `VertexNode.tsx` — full-size transparent `Handle`s (target +
    source) overlaid so connections snap to node center.
  - `straight-center` → `StraightCenterEdge.tsx` — straight line between node
    *centers* (from `internals.positionAbsolute` + measured size), not
    React Flow's default border-to-border.

## Conventions

- Path alias `@/*` → `src/*`.
- Any component touching the store, `window`, or React Flow must be a
  `"use client"` component.
- Styling is **Tailwind CSS v4** (config-less, via `@tailwindcss/postcss`);
  write utility classes inline. Icons from `lucide-react`.
- IDs via `nanoid`.
- **Vertex types** are the ZXW generators (`"z" | "empty" | "x" | "w" | "h" | "zbox" | "xbox" | "and"`),
  see `src/lib/graph/vertex-types.ts`). `VERTEX_TYPES` is the single source
  of truth for shape/color/size consumed by both `VertexNode` and
  `VertexTypeMenu` — keep them in sync when adding/changing a type.

### Rust compute layer (Phase 2+)

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

When the frontend (Phase 5) calls into the wasm, it goes through
`src/lib/compute/index.ts` — a thin wrapper that lazy-imports
`public/wasm/zxw/zxw.js` and hops the `GraphSlice` through
`serde_wasm-bindgen`. The compute wrapper reads only `doc.graph`, never
`doc.view`.

Public plan: `doc/plans/zxw-compute-backend.md`. Treat that doc as the
contract — if you change the compute boundary, update the plan too.

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

The Rust compute layer (Phase 3+) ports the same grammar so labels
parse identically on both sides of the WASM boundary.

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
  vertexType } }[]` and `edges: { id, source, target }[]`. This is the
  contract that the future Rust/WASM compute layer (and any external
  researcher's tooling) consumes.
- **`view`** — visual info only. `nodes: { id, position }[]` and `edges:
  { id }[]` today; future edge curvature, group colors, etc. will live
  here.

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
