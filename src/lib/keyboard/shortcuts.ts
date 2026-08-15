// src/lib/keyboard/shortcuts.ts
//
// Display-only registry of every editor shortcut. The actual dispatch
// lives in src/components/graph-editor/useKeyboardShortcuts.ts and must
// be kept in sync — this list is for discoverability, not dispatch.
// Render `⌘` on macOS, `Ctrl` elsewhere; detection is deferred to first
// render so SSR doesn't hit a missing `window`.

"use client";

export type ShortcutEntry = {
  description: string;
  keys: string[];
};

export type ShortcutGroup = {
  title: string;
  entries: ShortcutEntry[];
};

// "⌘" on macOS, "Ctrl" elsewhere. Called from render code (never at
// module top level) so SSR doesn't crash on a missing `window`.
export function modifierSymbol(): string {
  if (typeof window === "undefined") return "Ctrl";

  // navigator.platform is deprecated but still the most reliable Mac
  // signal; fall back to userAgent for older browsers.
  const platform =
    window.navigator.platform ||
    (window.navigator as Navigator & { userAgent?: string }).userAgent ||
    "";
  return /Mac|iPhone|iPad|iPod/i.test(platform) ? "⌘" : "Ctrl";
}

export function getShortcutGroups(): ShortcutGroup[] {
  const mod = modifierSymbol();

  return [
    {
      title: "Modes",
      entries: [
        { description: "Switch to select mode", keys: ["S"] },
        { description: "Switch to add-vertex mode", keys: ["V"] },
        { description: "Switch to add-edge mode", keys: ["E"] },
      ],
    },
    {
      title: "Selection",
      entries: [
        { description: "Select all", keys: [mod, "A"] },
        {
          description:
            "Clear pending edge sources, then selection, then return to select mode",
          keys: ["Esc"],
        },
      ],
    },
    {
      title: "Edit",
      entries: [
        { description: "Delete selected", keys: ["Backspace", "Del"] },
        { description: "Cut", keys: [mod, "X"] },
        { description: "Copy", keys: [mod, "C"] },
        { description: "Paste", keys: [mod, "V"] },
        { description: "Duplicate selected", keys: [mod, "D"] },
        { description: "Undo", keys: [mod, "Z"] },
        { description: "Redo", keys: [mod, "Shift", "Z"] },
        { description: "Redo (alternate)", keys: [mod, "Y"] },
        { description: "Save", keys: [mod, "S"] },
        {
          description: "Pick a vertex type by index (add-vertex mode only)",
          keys: ["1", "—", "9"],
        },
      ],
    },
    {
      title: "Tabs",
      entries: [
        { description: "Switch to previous tab", keys: [mod, "Shift", "["] },
        { description: "Switch to next tab", keys: [mod, "Shift", "]"] },
      ],
    },
    {
      title: "View",
      entries: [
        { description: "Fit view to all nodes and edges", keys: ["F"] },
      ],
    },
    {
      title: "Compute",
      entries: [
        {
          description: "Compute the represented tensor",
          keys: [mod, "Enter"],
        },
      ],
    },
    {
      title: "Help",
      entries: [{ description: "Show this dialog", keys: ["?"] }],
    },
  ];
}