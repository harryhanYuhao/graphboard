# Graph board for zxw

This app is a online graph board for zxw calculus. 

## Getting Started

- Development server: `pnpm dev`.
- Test: `pnpm test`
- Build: `pnpm build`, which will produce contents in the `.next` folder.

The back-end is in Rust (in the Root Dir)

- Test: `cargo test` 



## Project Structure

┌────────────────────────────────────────────────────────────────────────┐
│                       Browser (Next.js client)                         │
│                                                                        │
│  ┌──────────────┐    ┌─────────────────┐    ┌────────────────────────┐ │
│  │  React UI    │───▶│ graph-store.ts  │───▶│ graph/operations.ts    │ │
│  │  components  │◀───│ (Zustand+zundo) │◀───│ vertex-types.ts        │ │
│  └──────┬───────┘    └────────┬────────┘    └──────────┬─────────────┘ │
│         │                     │                        │               │
│         │              debounced ~2s                   │               │
│         │                     ▼                        │               │
│         │            ┌────────────────────┐            │               │
│         │            │ graph/             │            │               │
│         │            │ serialization.ts   │            │               │
│         │            └─────────┬──────────┘            │               │
│         │              ┌───────┴───────┐               │               │
│         │              ▼               ▼               │               │
│         │      localStorage      "Save" file (FS       │               │
│         │      (auto-save)       Access API)            │             │
│         │                                                │             │
│         │      ┌─────────────────────────────────────┐   │             │
│         │      │ graph slice  ←  projectDocument     │   │             │
│         │      │ (no view fields;                   │   │             │
│         │      │  what compute consumes)            │   │             │
│         │      └─────────────────┬───────────────────┘   │             │
│         │                        │                       │             │
│         │                Phase 5: hand off              │             │
│         │                        │                       │             │
│         │                        ▼                       │             │
│         │              ┌────────────────────┐            │             │
│         │              │ src/lib/compute/   │            │             │
│         │              │   (lazy load)      │            │             │
│         │              └─────────┬──────────┘            │             │
│         │                        │                       │             │
└─────────┼────────────────────────┼───────────────────────┘─────────────┘
          │                        │ dynamic import
          │                        ▼
┌─────────┼────────────────────────────────────────────────────────────────┐
│         │       Browser WASM sandbox  (zxw_bg.wasm)                       │
│  public/wasm/zxw/                                                         │
│         │       ┌────────────────────────────────────┐                    │
│  zxw.js ┼──────▶│  zxw::compute_tensor(graph_slice)  │                    │
│  zxw_bg │       └─────────────────┬──────────────────┘                    │
│  .wasm  │                         │                                       │
│         │                         ▼                                       │
│         │   ┌─────────────────────────────────────────┐                   │
│         │   │  crates/zxw/src/                         │                   │
│         │   │  phase.rs  →  graph.rs  →  tensor.rs     │                   │
│         │   │  spiders.rs / boxes.rs / nodes.rs       │                   │
│         │   │  contraction.rs  →  wasm.rs              │                   │
│         │   └─────────────────────────────────────────┘                   │
│         │   Rust crate  (single source, builds native OR wasm)            │
└──────────────────────────────────────────────────────────────────────────┘
