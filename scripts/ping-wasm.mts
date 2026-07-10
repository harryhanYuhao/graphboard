// scripts/ping-wasm.mts
//
// End-to-end smoke test for the WASM pipeline:
//   1. Run `pnpm build:wasm` to produce `public/wasm/zxw/`.
//   2. Run this script (`pnpm ping:wasm`).
//   3. It loads the wasm-pack output via `initSync({ module: bytes })`
//      (Node-friendly — bypasses the async fetch path that's intended
//      for browsers), calls `ping()`, asserts the result is `"pong"`.
//
// If this script exits 0, the wasm-pack → JS glue → import → call
// chain is healthy end-to-end. Used as part of Phase 2 verification.

import { readFileSync } from "node:fs";
import { initSync, ping } from "../public/wasm/zxw/zxw.js";

// wasm-pack --target web emits an async `init()` that defaults to
// fetching the .wasm via a URL — works in the browser, broken under
// Node (`file://` fetch is restricted). Use `initSync` with the bytes
// read off disk instead. Functionally equivalent; just synchronous
// and avoids the network code path.
const wasmBytes = readFileSync(
  new URL("../public/wasm/zxw/zxw_bg.wasm", import.meta.url),
);
initSync({ module: wasmBytes });

const result = ping();
if (result !== "pong") {
  console.error(`ping() returned ${JSON.stringify(result)}, expected "pong"`);
  process.exit(1);
}
console.log(`ping: ${result}`);