// src/lib/keyboard/shortcuts.test.ts
//
// The shortcut registry is a pure-function module — every entry
// maps a description to the keys that trigger it. The tests assert
// (1) the structural shape (groups, entries), (2) the modifier
// symbol on Mac vs non-Mac, and (3) that every entry the hook
// dispatches on also appears in the registry so the help dialog
// doesn't lie.

import { afterEach, describe, expect, it } from "vitest";
import { getShortcutGroups, modifierSymbol } from "./shortcuts";

describe("modifierSymbol", () => {
  const originalPlatform = window.navigator.platform;

  afterEach(() => {
    // Restore navigator.platform after each test so the global
    // doesn't leak across files.
    Object.defineProperty(window.navigator, "platform", {
      value: originalPlatform,
      writable: true,
      configurable: true,
    });
  });

  it("returns ⌘ on Mac", () => {
    Object.defineProperty(window.navigator, "platform", {
      value: "MacIntel",
      writable: true,
      configurable: true,
    });
    expect(modifierSymbol()).toBe("⌘");
  });

  it("returns ⌘ on iPhone / iPad", () => {
    Object.defineProperty(window.navigator, "platform", {
      value: "iPhone",
      writable: true,
      configurable: true,
    });
    expect(modifierSymbol()).toBe("⌘");
  });

  it("returns Ctrl on Windows", () => {
    Object.defineProperty(window.navigator, "platform", {
      value: "Win32",
      writable: true,
      configurable: true,
    });
    expect(modifierSymbol()).toBe("Ctrl");
  });

  it("returns Ctrl on Linux", () => {
    Object.defineProperty(window.navigator, "platform", {
      value: "Linux x86_64",
      writable: true,
      configurable: true,
    });
    expect(modifierSymbol()).toBe("Ctrl");
  });
});

describe("getShortcutGroups", () => {
  it("returns the documented group structure", () => {
    const groups = getShortcutGroups();
    const titles = groups.map((g) => g.title);
    expect(titles).toEqual([
      "Modes",
      "Selection",
      "Edit",
      "View",
      "Help",
    ]);
  });

  it("every group has a non-empty entries array", () => {
    for (const group of getShortcutGroups()) {
      expect(group.entries.length).toBeGreaterThan(0);
      for (const entry of group.entries) {
        expect(entry.description.length).toBeGreaterThan(0);
        expect(entry.keys.length).toBeGreaterThan(0);
        for (const key of entry.keys) {
          expect(key.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("covers every dispatch key the hook listens for", () => {
    // If a new shortcut is added to useKeyboardShortcuts.ts but not
    // to the registry, the help dialog is incomplete. Read every key
    // from the registry (flattened) and assert the known dispatch
    // keys are present.
    const allKeys = new Set<string>();
    for (const group of getShortcutGroups()) {
      for (const entry of group.entries) {
        for (const key of entry.keys) {
          allKeys.add(key.toLowerCase());
        }
      }
    }

    // From useKeyboardShortcuts.ts single-key switch:
    expect(allKeys.has("s")).toBe(true); // select mode
    expect(allKeys.has("v")).toBe(true); // add-vertex mode
    expect(allKeys.has("e")).toBe(true); // add-edge mode
    expect(allKeys.has("f")).toBe(true); // fit view
    expect(allKeys.has("?")).toBe(true); // help
    expect(allKeys.has("esc")).toBe(true); // escape ladder
    expect(allKeys.has("del")).toBe(true); // delete

    // From useKeyboardShortcuts.ts modifier-bearing branch:
    expect(allKeys.has("a")).toBe(true); // select all
    expect(allKeys.has("d")).toBe(true); // duplicate
    expect(allKeys.has("c")).toBe(true); // copy
    expect(allKeys.has("x")).toBe(true); // cut
    expect(allKeys.has("z")).toBe(true); // undo
    expect(allKeys.has("y")).toBe(true); // redo
  });

  it("includes the modifier symbol in the Edit group entries", () => {
    // The Edit group references [mod, ...] shortcuts. We don't pin
    // a specific symbol here — just check that some entry in that
    // group uses the platform-appropriate symbol.
    const editGroup = getShortcutGroups().find((g) => g.title === "Edit");
    expect(editGroup).toBeDefined();
    const flattened = editGroup!.entries.flatMap((e) => e.keys);
    // Either "Ctrl" or "⌘" depending on platform — both are fine.
    expect(flattened.some((k) => k === "Ctrl" || k === "⌘")).toBe(true);
  });
});

describe("modifierSymbol SSR safety", () => {
  it("returns 'Ctrl' when window is undefined", async () => {
    // Use vi.stubGlobal to simulate SSR. The function reads
    // `typeof window === 'undefined'` first, so this path is
    // independent of navigator state.
    const originalWindow = globalThis.window;
    // @ts-expect-error - intentionally stripping window for SSR sim
    delete (globalThis as { window?: unknown }).window;
    try {
      expect(modifierSymbol()).toBe("Ctrl");
    } finally {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
  });
});