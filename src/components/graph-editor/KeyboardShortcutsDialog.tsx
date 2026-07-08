// src/components/graph-editor/KeyboardShortcutsDialog.tsx
//
// Centered modal that lists every keyboard shortcut the editor responds
// to. Mirrors the visual + a11y shape of `ConfirmationDialog` so the two
// feel like siblings:
//   - backdrop click closes
//   - Escape closes
//   - first focusable (the close button) is auto-focused on open
//   - dialog body scrolls if the content overflows
//
// The shortcut list comes from `getShortcutGroups()` (deferred to render
// time so the modifier symbol resolves at first paint).

"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { getShortcutGroups } from "@/lib/keyboard/shortcuts";

interface KeyboardShortcutsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function KeyboardShortcutsDialog({
  isOpen,
  onClose,
}: KeyboardShortcutsDialogProps) {
  const closeRef = useRef<HTMLButtonElement>(null);

  // Focus the close button on open so screen readers land somewhere
  // sensible and Esc-to-close is one keypress away.
  useEffect(() => {
    if (isOpen) {
      closeRef.current?.focus();
    }
  }, [isOpen]);

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
    }
  };

  const handleBackdropClick = (event: React.MouseEvent) => {
    if (event.target === event.currentTarget) {
      onClose();
    }
  };

  if (!isOpen) return null;

  const groups = getShortcutGroups();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcuts-title"
    >
      <div
        className="relative w-full max-w-xl rounded-lg bg-white p-6 shadow-xl"
        onKeyDown={handleKeyDown}
      >
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-300"
          aria-label="Close shortcuts dialog"
        >
          <X size={20} />
        </button>

        <div className="space-y-4">
          <h2
            id="shortcuts-title"
            className="text-xl font-semibold text-slate-900"
          >
            Keyboard shortcuts
          </h2>

          <div className="max-h-[70vh] space-y-5 overflow-y-auto pr-1">
            {groups.map((group) => (
              <section key={group.title}>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {group.title}
                </h3>
                <ul className="divide-y divide-slate-100 rounded-md border border-slate-100">
                  {group.entries.map((entry) => (
                    <li
                      key={entry.description}
                      className="flex items-center justify-between gap-4 px-3 py-2"
                    >
                      <span className="text-sm text-slate-700">
                        {entry.description}
                      </span>
                      <span className="flex shrink-0 items-center gap-1">
                        {entry.keys.map((key, index) => (
                          <span
                            key={`${key}-${index}`}
                            className="flex items-center gap-1"
                          >
                            {index > 0 && (
                              <span className="text-xs text-slate-400">
                                +
                              </span>
                            )}
                            <kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[11px] text-slate-700">
                              {key}
                            </kbd>
                          </span>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>

          <p className="border-t border-slate-100 pt-3 text-xs text-slate-500">
            Press <kbd className="rounded border border-slate-200 bg-slate-50 px-1 font-mono text-[11px]">?</kbd>{" "}
            any time to reopen this dialog. Shortcuts are suppressed while a
            text field is focused.
          </p>
        </div>
      </div>
    </div>
  );
}