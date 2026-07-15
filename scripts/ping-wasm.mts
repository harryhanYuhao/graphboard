import { readFileSync } from "node:fs";
import { initSync, ping } from "../public/wasm/zxw/zxw.js";

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
