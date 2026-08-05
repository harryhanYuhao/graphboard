// src/lib/onboarding/intro.ts
//
// First-run gate for the intro guide: it auto-opens once per browser.
// The flag is stamped when `hydrate()` first opens the guide (not on
// close), so it never reappears even if the tab closes mid-tour.
//
// SSR-guarded and fail-soft, matching `src/lib/serialisation/`.

export const INTRO_LOCAL_STORAGE_KEY = "graph-board-seen-intro";

// True once the flag is written. Returns false on the server so SSR and
// first paint agree — never auto-open during server rendering.
export function hasSeenIntro(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(INTRO_LOCAL_STORAGE_KEY) !== null;
  } catch {
    // localStorage can throw (private mode, disabled storage): treat as
    // not-seen rather than crashing hydration.
    return false;
  }
}

// Stamp the flag so the intro won't auto-open again. SSR no-op; a thrown
// write is swallowed (worst case: it reappears next load).
export function markIntroSeen(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(INTRO_LOCAL_STORAGE_KEY, "1");
  } catch {
    // Ignore — same rationale as hasSeenIntro.
  }
}

// Named for call-site readability. Returns false during SSR.
export function shouldShowIntro(): boolean {
  if (typeof window === "undefined") return false;
  return !hasSeenIntro();
}
