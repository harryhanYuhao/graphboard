// src/lib/label/katex-loader.ts
//
// Lazy-loads KaTeX as a separate bundle chunk
// KaTeX is ~280KB minified;
//
// Constraint: `renderLabel` is called synchronously from React render
// (results go straight into `dangerouslySetInnerHTML`). A sync function
// cannot `await` an async chunk load. So we do
//   1. On module load we kick off `import("katex")` once (memoized).
//   2. Once it resolves we cache the module and flip `katexReady` to true,
//      then notify subscribers (React components via `useSyncExternalStore`)
//      to re-render. The re-render happens on the *next* tick; meanwhile
//      the rare LaTeX label painted before resolution shows escaped text
//      as a harmless fallback for one frame.
//   3. `renderLabel` reads the cached module synchronously — instant for
//      plain text, instant for LaTeX once the chunk is cached, escaped-text
//      fallback for LaTeX only on that first paint before the chunk lands.
//
// KaTeX's CSS is still loaded eagerly in `src/app/layout.tsx`, so styling
// is present before the JS chunk resolves — a rendered label looks right
// the moment its HTML is produced.

import type Katex from "katex";

type KatexModule = typeof Katex;

// The in-flight / resolved import. Memoized: `import()` dedupes in the
// bundler, but holding the promise means callers never re-trigger it.
let katexPromise: Promise<KatexModule> | null = null;

// The resolved module, or null until the chunk has loaded. Read
// synchronously by `renderLabel`'s LaTeX branch.
let katexModule: KatexModule | null = null;

// `useSyncExternalStore` plumbing: components subscribe so they re-render
// exactly once when the chunk resolves.
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
 * A promise that resolves once the KaTeX chunk has loaded. Useful for
 * tests that need to wait for `renderLabel`'s LaTeX path to be active;
 * production code uses `useKatexReady` for the re-render signal instead.
 */
export function whenKatexReady(): Promise<void> {
  ensureKatex();
  return katexPromise!.then(() => undefined);
}

// Start loading immediately on module evaluation so the chunk is fetching
// in parallel with the rest of the app booting, not waiting for the first
// LaTeX label to be rendered.
ensureKatex();

/**
 * The resolved KaTeX module, or `null` if the chunk hasn't loaded yet.
 * Synchronous — the LaTeX render path reads this directly.
 */
export function getKatex(): KatexModule | null {
  return katexModule;
}

/** True once the KaTeX chunk has loaded and `getKatex()` is non-null. */
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
