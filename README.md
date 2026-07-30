# Graph board for zxw

This app is a online graph board for zxw calculus, which is available at [https://zxwgraphboard.netlify.app/](https://zxwgraphboard.netlify.app/).

Its detailed documentation is in a separate repository and can be found at
	- [zxwgraph-doc github repo](https://github.com/Fabrial-Research/zxw-graphboard-doc)
	- [https://zxwgraphboard-doc.netlify.app/](https://zxwgraphboard-doc.netlify.app/)

## Getting Started

- Development server: `pnpm dev`.
- Frontend Test: `pnpm test`
- Backend Test: `cargo test`
- Quick integration test: `pnpm ping:wasm`
- Build
  - `pnpm build:wasm` builds the rust back end by invoking `./scripts/build-wasm.sh`, which is a wrapper for `wasm-pack`
  - `pnpm build`, builds the frontend, which relies on the backend WASM. 
  - The final build content is placed in the `.next` folder.
  - Always run `pnpm build:wasm` before `pnpm build`.
- Deployment
  - Manual deploy using the following netlify cli
  ```pnx netlify deploy --prod```
  (Here `pnx` is pnpm run executable,`--prod` is flag for production.)
  Run it each time to manually deploy the website to netlify.
  The netlify project is linked to Yuhao's netlify account, and is published in the url [https://zxwgraphboard.netlify.app](https://zxwgraphboard.netlify.app).
  The wasm binary are not committed into the git repository.
  Manual netlify deployment is configured by the file `netlify.toml` to run `pnpm run build:wasm; pnpm run build` before uploading `.next/` to cloud.
  

## Project Structure

* **Browser (Next.js client)**
  * **React UI components**
    * Interact bidirectionally with `graph-store.ts`
    * Connect to the backend WASM layer through `public/wasm/zxw/zxw.js`
  * **State management** `graph-store.ts`
    * Zustand for statge management, and zundo for undo/redo
    * Stage management is the core of the frontend
  * **Graph logic** in `graph/operations.ts` `vertex-types.ts`
  * **Serialization** `graph/serialization.ts`
    * The view slice (for visual) and graph slice (for all graph theoretic properties) are serialized in two different objects
  * **Project document**
    * `projectDocument`
      * Contains the graph slice
      * Excludes view-related fields
      * Represents the data consumed by the compute layer
  * **Compute handoff**
    * the graph slice is passed to rust crates at
      * `src/lib/compute/`, which is loaded lazily by the front-end
* **Browser WASM sandbox**
  * The wasm codes produced by `wasm-pack` is placed in `public/wasm/zxw/`.
  * **WASM entry point**
    * `zxw::compute_tensor(graph_slice)`
  * **Rust implementation** is placed in `crates/zxw/src/`
