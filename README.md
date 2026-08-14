# Graph Board for ZXW

An online graph board for the **ZXW calculus**
Live at [zxwgraphboard.netlify.app](https://zxwgraphboard.netlify.app/).
ZXW calculus is a specific king of tensor network
that can present complex linear algebraic computations in diagrams.
Users place vertices, wire them with edges, and compute the tensor the
diagram represents via a Rust/WASM backend. Client-side only — no server;
documents persist in `localStorage` with manual file export.

## Documentation

- **User guides + dev docs:** [zxwgraphboard-doc.netlify.app](https://zxwgraphboard-doc.netlify.app/)
  (source: the `doc/zxw-graphboard-doc` git submodule).
- **Operating manual for this repo:** `AGENTS.md` — commands, layout,
  architecture invariants, persistence rules.
- **Compute-backend design:** `doc/plans.md` — the contract for the Rust
  compute layer; its status block at the top says which phases have landed.

## Getting started

- `pnpm dev` — dev server (Next.js).
- `pnpm test` — frontend tests (vitest).
- `cargo test` — Rust compute-layer tests (`cargo llvm-cov --workspace`
  for coverage).
- `pnpm ping:wasm` — quick smoke test of the WASM pipeline.

## Building

- `pnpm build:wasm` — build the Rust backend via `wasm-pack`
  (`scripts/build-wasm.sh`). Run before `pnpm build` and after any Rust
  change. Output lands in `public/wasm/zxw/` (gitignored).
- `pnpm build` — build the frontend into `.next/`.

## Deploying

Manual Netlify deploy: `pnx netlify deploy --prod`
(`pnx` = pnpm exec; `--prod` = production). `netlify.toml` runs
`build:wasm` + `build` before uploading `.next/`; the wasm binaries are
never committed.

## Repo notes

- Two git submodules: `doc/zxw-graphboard-doc` (docs site) and
  `crates/cartographer` (treewidth research CLI, kept for planned later
  integration).
- Two Rust crates in the root Cargo workspace; `default-members` keeps
  `cargo test` on the `zxw` compute crate.
