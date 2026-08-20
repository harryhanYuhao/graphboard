// vitest.setup.ts
//
// Runs before every test file. Pulls in jest-dom's matchers
// (`toBeInTheDocument`, `toHaveClass`, etc.) and installs a per-worker
// in-memory localStorage (see below).

import "@testing-library/jest-dom/vitest";
import { beforeEach } from "vitest";

// Node ≥24 ships a native `localStorage` global; with `--localstorage-file`
// (the `pnpm test` script) it is a process-level SQLite store, so every
// parallel test file shares ONE store and a `save()` in one file leaks into
// `hydrate()` in another — the intermittent failures in
// graph-store_tabs.test.ts and onboarding/intro.test.ts. jsdom's
// `window.localStorage` is that same shared store, so replace both globals
// with a fresh in-memory Storage (one per worker) and clear it before each
// test.
function createInMemoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear() {
      data.clear();
    },
    getItem(key: string) {
      return data.has(key) ? data.get(key)! : null;
    },
    key(index: number) {
      return [...data.keys()][index] ?? null;
    },
    removeItem(key: string) {
      data.delete(key);
    },
    setItem(key: string, value: string) {
      data.set(key, String(value));
    },
  };
}

function installInMemoryLocalStorage(): void {
  const storage = createInMemoryStorage();
  const targets: object[] = [globalThis];
  if (typeof window !== "undefined") targets.push(window);

  for (const target of targets) {
    try {
      Object.defineProperty(target, "localStorage", {
        value: storage,
        writable: true,
        configurable: true,
      });
    } catch {
      try {
        (target as { localStorage?: Storage }).localStorage = storage;
      } catch {
        // Non-configurable in this environment; leave the existing store.
      }
    }
  }
}

installInMemoryLocalStorage();

beforeEach(() => {
  localStorage.clear();
});
