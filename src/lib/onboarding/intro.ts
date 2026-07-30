// src/lib/onboarding/intro.ts
//
// First-run gate for the intro guide. The guide auto-opens exactly once per
// browser; we stamp a localStorage flag the first time `hydrate()` opens it
// (not when it closes), so the intro never reappears even if the user
// force-closes the tab mid-tour or reloads.
//
// Conventions mirror `src/lib/graph/serialization.ts`: module-level key
// constant, SSR-guarded, fail-soft. These are pure functions with no React,
// so they unit-test cleanly.

export const INTRO_LOCAL_STORAGE_KEY = "graph-board-seen-intro";

// True once `markIntroSeen()` has written the flag. Returns false on the
// server (where `window` is undefined) so SSR and first client paint agree
// — never auto-open during server rendering.
export function hasSeenIntro(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(INTRO_LOCAL_STORAGE_KEY) !== null;
  } catch {
    // localStorage can throw (private mode, disabled storage). Treat as
    // not-seen rather than crashing the hydration path.
    return false;
  }
}

// Stamp the flag so the intro doesn't auto-open again. SSR no-op; a thrown
// write (e.g. quota / private mode) is swallowed — worst case the intro
// reappears next load, which is harmless.
export function markIntroSeen(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(INTRO_LOCAL_STORAGE_KEY, "1");
  } catch {
    // Ignore — see hasSeenIntro's catch for rationale.
  }
}

// Named for readability at call sites: "if (shouldShowIntro()) open it".
// Returns false during SSR — auto-opening a modal is inherently a
// client-only concern, and `hydrate()` (the only caller) runs in a
// client effect anyway, but the explicit guard keeps the semantics
// unambiguous and prevents any future caller from tripping on SSR.
export function shouldShowIntro(): boolean {
  if (typeof window === "undefined") return false;
  return !hasSeenIntro();
}
