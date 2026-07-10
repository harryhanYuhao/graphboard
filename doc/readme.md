# ZXW graph board

## Current Functionality

- Select and create edges and different types of nodes
- Node property can by edited via vertex property panel 
- Export and import from `json` file.
- Various custom keyboard shortcuts 
- Help menu. (Can be toggled with keyboard shortcuts `?`)

## How to use

### Change Between Different Modes

There are three major modes, selection, vertex, and edge.
We can change to these modes by pressing `s`, `v`, or `e`.
In selection mode, left click selects the vertex.
In vertex mode, left click creates vertex.
In edge mode, clicking two nodes sequentially connects the two nodes.

### Selection 

In selection mode, click vertices or edge to select. Command/Ctrl + click to add or remove selection. Shift and drag to select in a box.

### Vertex and Edges

Click the vertex icon and click on the canvas to create different vertices. 

To create edge, enter the edge mode (by clicking edge icon on menu), and click two vertices in terms to create edge. 

## Building the WASM compute layer

The Rust compute layer lives at `crates/zxw/`. It is built to WebAssembly
and served as a static asset at `public/wasm/zxw/`.

- `pnpm build:wasm` — runs `wasm-pack build` and writes the output to
  `public/wasm/zxw/` (gitignored).
- `cargo test -p zxw` — runs the Rust-side tests natively.
- `pnpm ping:wasm` — builds + smoke-tests the wasm pipeline (calls
  `ping()`, asserts `"pong"`).

Requires a Rust toolchain (1.96+) and `wasm-pack` (0.15+).
Re-run `pnpm build:wasm` after any change to Rust source. 


