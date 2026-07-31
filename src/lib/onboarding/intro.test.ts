// The intro gate is a localStorage flag. Beyond the read/write contract,
// the SSR guard matters: `shouldShowIntro()` must return false when
// `window` is undefined, or SSR (dialog closed) and first paint disagree.

import { afterEach, describe, expect, it } from "vitest";
import {
  INTRO_LOCAL_STORAGE_KEY,
  hasSeenIntro,
  markIntroSeen,
  shouldShowIntro,
} from "./intro";

describe("intro gate", () => {
  // jsdom gives a real localStorage; clear the flag between cases.
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
  // `window` is stripped to simulate SSR; the module checks `typeof window`
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
    // Must be false so SSR markup matches first paint.
    expect(shouldShowIntro()).toBe(false);
  });
});
