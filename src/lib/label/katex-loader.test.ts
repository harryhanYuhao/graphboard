// Pins the KaTeX lazy-loader (`./katex-loader.ts`): the chunk is memoized,
// and a failed import is NOT cached — `ensureKatex` retries on the next
// call so a transient network error doesn't degrade every LaTeX label for
// the whole session. The `katex` module is mocked via a hoisted flag so the
// first test run can simulate a failing chunk fetch and the second a
// successful one (the mock factory re-runs per `vi.resetModules()`).

import { beforeEach, describe, expect, it, vi } from "vitest";

const importState = vi.hoisted(() => ({ fail: false }));

vi.mock("katex", async () => {
  if (importState.fail) {
    throw new Error("chunk fetch failed");
  }
  return {
    __esModule: true,
    default: { renderToString: (s: string) => `<span>${s}</span>` },
  };
});

// Re-import the loader fresh per test so its module-scope memo resets (and
// the katex mock factory re-runs against the current `importState.fail`).
async function freshLoader() {
  vi.resetModules();
  return import("./katex-loader");
}

describe("katex-loader", () => {
  beforeEach(() => {
    importState.fail = false;
  });

  it("caches the resolved module and flips isKatexReady", async () => {
    const loader = await freshLoader();
    expect(loader.isKatexReady()).toBe(false);

    loader.ensureKatex();
    await vi.waitFor(() => expect(loader.isKatexReady()).toBe(true));
    expect(loader.getKatex()).not.toBeNull();
  });

  it("does not cache a failed import — the next call retries and succeeds", async () => {
    importState.fail = true;
    const loader = await freshLoader();
    expect(loader.isKatexReady()).toBe(false);

    // First attempt fails (transient network error). The memo must not hold
    // the rejection.
    loader.ensureKatex();
    await vi.waitFor(() => expect(loader.isKatexReady()).toBe(false));

    // The network recovers; a later call re-imports and succeeds.
    importState.fail = false;
    loader.ensureKatex();
    await vi.waitFor(() => expect(loader.isKatexReady()).toBe(true));
    expect(loader.getKatex()).not.toBeNull();
  });
});
