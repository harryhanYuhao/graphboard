// vitest.setup.ts
//
// Runs once before the test suite. Pulls in jest-dom's matchers
// (`toBeInTheDocument`, `toHaveClass`, etc.) so component/hook tests can
// write readable assertions against the rendered DOM.
//
// `localStorage` is exposed as a global alias for `window.localStorage`
// because jsdom doesn't always surface it on `globalThis` across
// vitest's worker isolation boundaries — see the comment in
// `useKeyboardShortcuts.test.ts` ("throws under jsdom if localStorage
// isn't on the global … which can happen intermittently across test
// isolation boundaries"). Tests that touch localStorage can then just
// write `localStorage.clear()` and have it work in either environment.

import "@testing-library/jest-dom/vitest";

if (typeof window !== "undefined" && typeof globalThis.localStorage === "undefined") {
  Object.defineProperty(globalThis, "localStorage", {
    value: window.localStorage,
    writable: true,
    configurable: true,
  });
}