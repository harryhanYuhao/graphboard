# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development

```bash
pnpm dev          # Start Next.js dev server on http://localhost:3000
pnpm build        # Production build
pnpm start        # Start production server
pnpm lint         # ESLint across the project
```

Formatting is done with Prettier (no separate script — run via `npx prettier --write .` or your editor plugin).

## Architecture

**Graph Board** is an interactive mathematical graph whiteboard — a Next.js 16 (App Router) single-page app with no backend. Graphs are persisted to `localStorage` and exportable as JSON.

### Layer model (bottom-up)

1. **`src/lib/graph/`** — Pure functions, no React dependency.
   - `types.ts` — Core data model: `VertexNode` (extends `@xyflow/react` `Node<VertexData>`), `GraphEdge`, `GraphDocument`, and the `EditorMode` union (`"select" | "add-vertex" | "add-edge" | "delete"`).
   - `operations.ts` — Graph mutations: creating vertices/edges (`nanoid`-generated IDs), deleting selected elements (cascades — deletes edges attached to deleted nodes).
   - `serialization.ts` — `localStorage` persistence under key `"graph-board-document"` and JSON export. Guards against `window` being undefined (SSR-safe).

2. **`src/store/graph-store.ts`** — Zustand store. The single source of truth for all graph state. Bridges the pure `lib/graph` functions to React Flow's `applyNodeChanges` / `applyEdgeChanges` / `addEdge` helpers. Hydrates from `localStorage` on mount (gated behind `hasHydrated` flag to prevent SSR mismatch).

3. **`src/components/graph-editor/`** — React components.
   - `GraphEditor.tsx` — Top-level component wrapping everything in `<ReactFlowProvider>`. Handles mode-dependent pane clicks (add-vertex), keyboard delete, and the hydration loading state. Renders React Flow with `<Background>`, `<Controls>`, and `<MiniMap>`.
   - `GraphToolbar.tsx` — Floating toolbar (select, add-vertex, delete, save, reset). Each mode button sets the active editor mode in the Zustand store.
   - `VertexNode.tsx` — Custom React Flow node rendered as a 48×48 circle with top (target) and bottom (source) handles. Selected state shown with blue ring styling.

4. **`src/app/`** — Next.js App Router entry. `page.tsx` simply renders `<GraphEditor />`.

### Data flow

User interaction → React Flow event handlers (`onNodesChange`, `onEdgesChange`, `onConnect`, `onPaneClick`) → Zustand store actions → pure `lib/graph` functions + React Flow helpers → state update → re-render. Saving is explicit (toolbar save button or store action); auto-save is not implemented.

### Key dependencies

- **@xyflow/react** (v12) — React Flow graph editor library. All node/edge rendering, interaction, and change handling goes through it.
- **zustand** (v5) — Lightweight state management.
- **nanoid** (v5) — ID generation for nodes and edges.
- **lucide-react** — Icon library (used in toolbar).
- **tailwindcss** (v4) — Utility CSS via `@import "tailwindcss"` in globals.css (v4 style, no `tailwind.config.ts`).
- **clsx** — Conditional className helper (available but not yet used in components).
