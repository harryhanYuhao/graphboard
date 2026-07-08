// src/lib/keyboard/shortcuts.ts
//
// Display-only registry of every keyboard shortcut the editor responds
// to. The actual key→action dispatch lives in
// src/components/graph-editor/useKeyboardShortcuts.ts and must be kept in
// sync with the entries below — this list exists for discoverability, not
// as the dispatch table. If you add a shortcut, add it here too.
//
// Platform: we render `⌘` on macOS and `Ctrl` elsewhere. Detection is
// deferred to first render so SSR doesn't trip on a missing window.

"use client";

export type ShortcutEntry = {
  description: string;
  keys: string[];
};

export type ShortcutGroup = {
  title: string;
  entries: ShortcutEntry[];
};

// "Cmd" on macOS, "Ctrl" elsewhere. Called from render code, never at
// module top level, so SSR (where `window` is undefined) doesn't crash.
export function modifierSymbol(): string {
  if (typeof window === "undefined") return "Ctrl";

  // navigator.platform is deprecated but still the most reliable signal
  // for Mac vs not-Mac at the platform level across browsers. Fall back
  // to userAgent for older browsers.
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
        { description: "Delete selected", keys: ["Del"] },
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
          keys: ["1", "—", "8"],
        },
      ],
    },
    {
      title: "View",
      entries: [
        { description: "Fit view to all nodes and edges", keys: ["F"] },
      ],
    },
    {
      title: "Help",
      entries: [{ description: "Show this dialog", keys: ["?"] }],
    },
  ];
}