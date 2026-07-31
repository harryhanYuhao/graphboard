// src/lib/label/katex-loader.ts
//
// Lazy-loads KaTeX (~280KB) as a separate chunk. `renderLabel` runs
// synchronously inside React render, so it can't `await` the chunk:
//   1. On module load, kick off `import("katex")` once (memoized).
//   2. On resolve, cache the module and flip `katexReady`, notifying
//      subscribers (via `useSyncExternalStore`) to re-render.
//   3. `renderLabel` reads the cached module synchronously; before the
//      chunk lands, LaTeX labels fall back to escaped text for one frame.
//
// KaTeX's CSS is loaded eagerly in `src/app/layout.tsx`, so styling is
// ready before the JS resolves.

import type Katex from "katex";

type KatexModule = typeof Katex;

// In-flight / resolved import. Held so callers never re-trigger it.
let katexPromise: Promise<KatexModule> | null = null;

// Resolved module, or null until loaded. Read sync by `renderLabel`.
let katexModule: KatexModule | null = null;

// `useSyncExternalStore` plumbing: subscribers re-render once on resolve.
let katexReady = false;
const listeners = new Set<() => void>();

function notifyReady() {
  katexReady = true;
  listeners.forEach((l) => l());
}

/** Kick off the KaTeX import if it hasn't started. Safe to call repeatedly. */
export function ensureKatex(): void {
  if (katexPromise) return;
  katexPromise = import("katex").then((mod) => {
    katexModule = mod.default ?? mod;
    notifyReady();
    return mod;
  });
}

/**
 * Resolves once the KaTeX chunk has loaded. For tests waiting on the
 * LaTeX path; production uses `useKatexReady` for the re-render signal.
 */
export function whenKatexReady(): Promise<void> {
  ensureKatex();
  return katexPromise!.then(() => undefined);
}

// Start loading on module eval so the chunk fetches in parallel with app
// boot rather than waiting for the first LaTeX label.
ensureKatex();

/**
 * Resolved KaTeX module, or `null` if not yet loaded. Sync.
 */
export function getKatex(): KatexModule | null {
  return katexModule;
}

/** True once the chunk has loaded (`getKatex()` is non-null). */
export function isKatexReady(): boolean {
  return katexReady;
}

// --- useSyncExternalStore surface --------------------------------------

export function subscribeKatexReady(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getKatexReadySnapshot(): boolean {
  return katexReady;
}
