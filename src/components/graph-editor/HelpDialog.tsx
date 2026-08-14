// src/components/graph-editor/HelpDialog.tsx
//
// Modal listing every editor shortcut. Sibling shape to `ConfirmationDialog`
// (backdrop/Escape close, close button auto-focused, scrollable body). The
// shortcut list comes from `getShortcutGroups()` (deferred to render time so
// the modifier symbol resolves at first paint).

"use client";

import { useEffect, useRef } from "react";
import { GraduationCap, X } from "lucide-react";
import { getShortcutGroups } from "@/lib/keyboard/shortcuts";

interface HelpDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** Opens the intro guide; this dialog closes first so they don't stack. */
  onShowIntro?: () => void;
}

export function HelpDialog({
  isOpen,
  onClose,
  onShowIntro,
}: HelpDialogProps) {
  const closeRef = useRef<HTMLButtonElement>(null);

  // Focus the close button on open so Esc-to-close is one keypress away.
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

  // Close before opening the intro so they don't stack. Stays presentational.
  const handleShowIntro = () => {
    onClose();
    onShowIntro?.();
  };

  if (!isOpen) return null;

  const groups = getShortcutGroups();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="help-title"
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
          aria-label="Close help dialog"
        >
          <X size={20} />
        </button>

        <div className="space-y-4">
          <h2
            id="help-title"
            className="text-xl font-semibold text-slate-900"
          >
            Help
          </h2>

          <button
            type="button"
            onClick={handleShowIntro}
            className="flex w-full items-center gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-left text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-300"
          >
            <GraduationCap size={18} className="shrink-0 text-slate-500" />
            <span>Show intro guide</span>
          </button>

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
