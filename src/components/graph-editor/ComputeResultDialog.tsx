// src/components/graph-editor/ComputeResultDialog.tsx
//
// Modal that shows the result of clicking the Compute button. Today
// (Phase 2 smoke test) it calls `pingWasm()` and displays the round-trip
// result, proving the browser → wasm pipeline works before the real
// compute engine (Phase 4/5) lands.
//
// Mirrors the visual + a11y shape of `KeyboardShortcutsDialog` /
// `ConfirmationDialog` so the three modals feel like siblings:
//   - backdrop click closes
//   - Escape closes
//   - first focusable (the close button) is auto-focused on open
//
// When Phase 5 lands, this dialog grows a tensor result panel
// (shape summary + dense value table + warnings block, see plan §6.4).
// The status state machine here (`idle` → `loading` → `ok`|`error`) is
// the skeleton that panel will hang off of.

"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { pingWasm } from "@/lib/compute";

type Status = "loading" | "ok" | "error";

interface ComputeResultDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ComputeResultDialog({
  isOpen,
  onClose,
}: ComputeResultDialogProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Kick off the ping on open. The state-reset that would normally
  // live at the top of the effect (setStatus("loading"), etc.) is
  // done by the parent remounting this component via a `key` — see
  // GraphToolbar — so the effect body itself only runs the async work
  // and updates state from inside the promise callbacks (not
  // synchronously, which lint and React both discourage).
  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    pingWasm()
      .then((r) => {
        if (cancelled) return;
        setResult(r);
        setStatus("ok");
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setStatus("error");
      });

    closeRef.current?.focus();

    return () => {
      cancelled = true;
    };
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="compute-title"
    >
      <div
        className="relative w-full max-w-lg rounded-lg bg-white p-6 shadow-xl"
        onKeyDown={handleKeyDown}
      >
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-300"
          aria-label="Close compute result"
        >
          <X size={20} />
        </button>

        <div className="space-y-3">
          <h2
            id="compute-title"
            className="text-xl font-semibold text-slate-900"
          >
            Compute
          </h2>

          {status === "loading" && (
            <p className="text-sm text-slate-600">
              Calling WASM… (fetching + instantiating the module on first
              run)
            </p>
          )}

          {status === "ok" && (
            <div className="space-y-2">
              <p className="text-sm text-slate-600">
                <span className="font-medium text-slate-900">
                  WASM pipeline OK.
                </span>{" "}
                Phase 2 <code className="rounded bg-slate-100 px-1 font-mono text-xs">ping()</code>{" "}
                returned:
              </p>
              <pre className="rounded-md border border-slate-200 bg-slate-50 p-3 font-mono text-sm text-slate-900">
                {JSON.stringify(result)}
              </pre>
              <p className="text-xs text-slate-500">
                The real tensor-contraction engine (Phase 4/5) is not yet
                wired up — this is a smoke test of the browser → wasm
                boundary only.
              </p>
            </div>
          )}

          {status === "error" && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-red-700">
                WASM call failed.
              </p>
              <pre className="max-h-60 overflow-y-auto rounded-md border border-red-200 bg-red-50 p-3 font-mono text-xs text-red-900">
                {error ?? "Unknown error"}
              </pre>
              <p className="text-xs text-slate-500">
                Check that <code className="rounded bg-slate-100 px-1 font-mono text-xs">public/wasm/zxw/</code>{" "}
                exists and is up to date — rebuild with{" "}
                <code className="rounded bg-slate-100 px-1 font-mono text-xs">pnpm build:wasm</code>.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
