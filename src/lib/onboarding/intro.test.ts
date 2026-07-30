// src/lib/onboarding/intro.test.ts
//
// The intro gate is a pure localStorage module — every entry point either
// reads or writes a single flag. The tests pin the read/write contract and,
// importantly, the SSR guard: `shouldShowIntro()` must return false when
// `window` is undefined so SSR and first client paint agree (otherwise the
// server renders closed and the client pops the modal open → hydration
// mismatch).

import { afterEach, describe, expect, it } from "vitest";
import {
  INTRO_LOCAL_STORAGE_KEY,
  hasSeenIntro,
  markIntroSeen,
  shouldShowIntro,
} from "./intro";

describe("intro gate", () => {
  // jsdom gives us a real localStorage; clear the flag between cases so
  // ordering doesn't matter.
  afterEach(() => {
    localStorage.removeItem(INTRO_LOCAL_STORAGE_KEY);
  });

  it("hasSeenIntro is false before the flag is written", () => {
    expect(hasSeenIntro()).toBe(false);
  });

  it("markIntroSeen writes the flag and hasSeenIntro reads it back", () => {
    markIntroSeen();
    expect(hasSeenIntro()).toBe(true);
    expect(localStorage.getItem(INTRO_LOCAL_STORAGE_KEY)).toBe("1");
  });

  it("shouldShowIntro inverts hasSeenIntro", () => {
    expect(shouldShowIntro()).toBe(true);
    markIntroSeen();
    expect(shouldShowIntro()).toBe(false);
  });
});

describe("intro gate SSR safety", () => {
  // `window` is stripped to simulate SSR. The module checks `typeof window`
  // first, so these paths are independent of localStorage state.
  const originalWindow = globalThis.window;

  afterEach(() => {
    (globalThis as { window?: unknown }).window = originalWindow;
  });

  it("hasSeenIntro returns false when window is undefined", () => {
    // @ts-expect-error - intentionally stripping window for SSR sim
    delete (globalThis as { window?: unknown }).window;
    expect(hasSeenIntro()).toBe(false);
  });

  it("markIntroSeen is a no-op when window is undefined", () => {
    // @ts-expect-error - intentionally stripping window for SSR sim
    delete (globalThis as { window?: unknown }).window;
    expect(() => markIntroSeen()).not.toThrow();
  });

  it("shouldShowIntro returns false on SSR (never auto-open during render)", () => {
    // @ts-expect-error - intentionally stripping window for SSR sim
    delete (globalThis as { window?: unknown }).window;
    // Must be false so SSR markup (dialog closed) matches first paint.
    expect(shouldShowIntro()).toBe(false);
  });
});
