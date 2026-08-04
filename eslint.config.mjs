import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".netlify/**",
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // wasm-pack output (Phase 2+). Generated JS/TS bindings — not
    // hand-written, not lint-worthy.
    "public/wasm/**",
    "doc/**",
  ]),
]);

export default eslintConfig;
