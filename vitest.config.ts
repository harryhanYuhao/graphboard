// vitest.config.ts
//
// Test runner config. Uses jsdom so tests can touch `window`, `document`,
// and React Testing Library's renderHook can mount real React effects.
//
// The `@/*` path alias mirrors tsconfig.json so tests can resolve
// `@/lib/...` and `@/store/...` the same way the app does.
//
// See: https://vitest.dev/config/

import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    css: false,
  },
});