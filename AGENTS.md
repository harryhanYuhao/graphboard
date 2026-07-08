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

No test suite is configured. No dedicated typecheck script — `tsc` runs
through `next build` and the VS Code TS SDK (`.vscode/settings.json`).

## Layout

- `src/app/` — Next.js App Router entry (`page.tsx` → `GraphEditor`, single page).
- `src/components/graph-editor/` — editor UI (canvas, toolbar, custom node/edge).
- `src/store/graph-store.ts` — Zustand store, single source of truth for graph state.
- `src/lib/graph/` — pure graph logic: `types.ts`, `operations.ts`
  (create/delete), `serialization.ts` (document + `localStorage`),
  `vertex-types.ts` (ZXW generator metadata).
- `src/lib/download.ts`, `src/lib/filename.ts` — JSON export helpers.
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
- **Vertex types** are the ZXW generators (`"z" | "empty" | "x" | "w" | "h"`,
  see `src/lib/graph/vertex-types.ts`). `VERTEX_TYPES` is the single source
  of truth for shape/color/size consumed by both `VertexNode` and
  `VertexTypeMenu` — keep them in sync when adding/changing a type.

## Persistence & export gotchas

- Auto-save is debounced (~2s) in `GraphEditor.tsx` after node/edge changes.
- `localStorage` key: `graph-board-document`.
- All storage functions guard `typeof window === "undefined"` for SSR safety.
- JSON export (`exportJson` → `src/lib/download.ts`) prefers the File System
  Access API (`window.showSaveFilePicker`) and falls back to anchor-download.
  `src/lib/filename.ts` sanitizes the title into a safe filename.

## Document shape (v2): graph vs view

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

- `projectDocument(runtime)` → v2 doc (called from `saveGraphDocument`
  and `exportGraphJson`).
- `hydrateDocument(doc)` → runtime objects (called from `loadGraphDocument`
  consumers — i.e. the store's `hydrate` action).

**Rules of thumb:**

- The compute boundary (`src/lib/compute/` when it lands) reads only
  `doc.graph` — never `doc.view`.
- Selection (`selected`), `origin`, React Flow's `type` discriminator
  (`"vertex"` / `"straight-center"`), and runtime `measured` /
  `internals.*` fields are **never** persisted. (Pre-v2, selection
  accidentally survived reloads — the split fixes that.)
- Schema versioning lives in `CURRENT_SCHEMA_VERSION`. The current
  document is **v2**. v1 documents (or untagged ones) are migrated
  forward by `migrateV1ToV2` at load time. When the shape changes again,
  bump the constant and add a new `migrateV2ToV3` step in
  `loadGraphDocument`.
