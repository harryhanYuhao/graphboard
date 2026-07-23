// src/components/graph-editor/ComputeResultDialog.tsx
//
// Modal that shows the result of clicking the Compute button (plan
// §6.4). The parent (`GraphToolbar`) owns the `computePromise` +
// `progress` state; this dialog awaits the promise and renders:
//   - while pending: a determinate progress bar fed by `progress`
//     (contracted / total edges),
//   - on success: a shape summary using `inputCount`/`outputCount`,
//     a value grid (rows = inputs, cols = outputs when both > 0), and
//     a collapsible warnings block,
//   - on error: an inline error card with the message + remediation hint.
//
// Mirrors the visual + a11y shape of `KeyboardShortcutsDialog` /
// `ConfirmationDialog` so the modals feel like siblings: backdrop click
// closes, Escape closes, first focusable auto-focused on open.

"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import type {
  ComputeErrorKind,
  TensorResult,
} from "@/lib/compute/result-types";
import { bitsToLabel, formatComplex } from "@/lib/compute/matrix-format";
import { classifyComputeError, ComputeError } from "@/lib/compute/errors";

type Status = "loading" | "ok" | "error";

interface ComputeResultDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** The promise returned by `computeTensor`. Null when no compute in flight. */
  computePromise: Promise<TensorResult> | null;
  /** Progress updates from the contraction loop, or null while idle. */
  progress: { contracted: number; total: number } | null;
}

export function ComputeResultDialog({
  isOpen,
  onClose,
  computePromise,
  progress,
}: ComputeResultDialogProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [result, setResult] = useState<TensorResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<ComputeErrorKind>("unknown");
  const [warningsOpen, setWarningsOpen] = useState(false);

  // Await the parent-supplied promise. The state-reset that would
  // normally live at the top of an effect is done by the parent
  // remounting this component via a `key` — see GraphToolbar — so the
  // effect body itself only runs the async work and updates state from
  // inside the promise callbacks.
  useEffect(() => {
    if (!isOpen || !computePromise) return;

    let cancelled = false;

    computePromise
      .then((r) => {
        if (cancelled) return;
        setResult(r);
        setStatus("ok");
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        // DOMException from AbortSignal carries name "AbortError".
        if (e instanceof DOMException && e.name === "AbortError") {
          setError("Computation cancelled.");
          setErrorKind("unknown");
        } else if (e instanceof ComputeError) {
          setError(e.message);
          setErrorKind(e.kind);
        } else {
          const message = e instanceof Error ? e.message : String(e);
          setError(message);
          setErrorKind(classifyComputeError(message));
        }
        setStatus("error");
      });

    closeRef.current?.focus();

    return () => {
      cancelled = true;
    };
  }, [isOpen, computePromise]);

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
        className="relative w-full max-w-2xl rounded-lg bg-white p-6 shadow-xl"
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
            <LoadingView progress={progress} />
          )}

          {status === "ok" && result && (
            <ResultView result={result} warningsOpen={warningsOpen} onToggleWarnings={() => setWarningsOpen(v => !v)} />
          )}

          {status === "error" && (
            <ErrorView message={error ?? "Unknown error"} kind={errorKind} />
          )}
        </div>
      </div>
    </div>
  );
}

// ---- Sub-views -------------------------------------------------------------

function LoadingView({
  progress,
}: {
  progress: { contracted: number; total: number } | null;
}) {
  // Determinate bar when the worker has reported progress; indeterminate
  // spinner otherwise (e.g. during the initial wasm fetch before the
  // first edge is contracted).
  const hasProgress = progress !== null && progress.total > 0;
  const pct = hasProgress
    ? Math.round(((progress!.contracted / progress!.total) * 100))
    : 0;

  return (
    <div className="space-y-2">
      <p className="text-sm text-slate-600">
        Contracting
        {hasProgress
          ? ` — edge ${progress!.contracted} / ${progress!.total}`
          : "… (fetching + instantiating WASM on first run)"}
      </p>
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
        <div
          className={[
            "h-full rounded-full bg-slate-900 transition-all",
            hasProgress ? "" : "animate-pulse w-1/3",
          ].join(" ")}
          style={hasProgress ? { width: `${pct}%` } : undefined}
        />
      </div>
    </div>
  );
}

function ResultView({
  result,
  warningsOpen,
  onToggleWarnings,
}: {
  result: TensorResult;
  warningsOpen: boolean;
  onToggleWarnings: () => void;
}) {
  const { shape, data, warnings, inputCount, outputCount } = result;
  return (
    <div className="space-y-3">
      <ShapeSummary
        shape={shape}
        inputCount={inputCount}
        outputCount={outputCount}
        scalarValue={shape.length === 0 ? data[0] : null}
      />
      <ValueTable shape={shape} data={data} inputCount={inputCount} outputCount={outputCount} />
      {warnings.length > 0 && (
        <WarningsBlock
          warnings={warnings}
          open={warningsOpen}
          onToggle={onToggleWarnings}
        />
      )}
    </div>
  );
}

function ShapeSummary({
  shape,
  inputCount,
  outputCount,
  scalarValue,
}: {
  shape: number[];
  inputCount: number;
  outputCount: number;
  scalarValue: [number, number] | null;
}) {
  if (shape.length === 0) {
    // Scalar — show the constant value.
    const [re, im] = scalarValue ?? [0, 0];
    const imStr = Math.abs(im) < 1e-12 ? "" : `${im >= 0 ? "+" : "−"}${Math.abs(im).toFixed(4)}i`;
    return (
      <p className="text-sm text-slate-700">
        <span className="font-medium">Constant</span> — value{" "}
        <code className="rounded bg-slate-100 px-1 font-mono text-xs">
          {re.toFixed(4)}{imStr}
        </code>
        .
      </p>
    );
  }

  // With boundaries: 2^m × 2^n matrix (rows = outputs, cols = inputs).
  // Matrix convention: M(out_bits, in_bits) = T(in_bits | out_bits),
  // both in big-endian bit order. See ValueTable for the basis labels.
  if (inputCount + outputCount > 0) {
    const nRows = 2 ** outputCount;
    const nCols = 2 ** inputCount;
    const extraLegs = shape.length - inputCount - outputCount;
    return (
      <p className="text-sm text-slate-700">
        <span className="font-medium">
          {nRows} × {nCols} matrix
        </span>{" "}
        ({outputCount} output{outputCount === 1 ? "" : "s"} × {inputCount} input
        {inputCount === 1 ? "" : "s"})
        {extraLegs > 0 && (
          <span className="text-slate-500"> + {extraLegs} dangling leg{extraLegs === 1 ? "" : "s"}</span>
        )}
      </p>
    );
  }

  // No boundaries but rank > 0 — show raw shape.
  const shapeStr = shape.join(" × ");
  return (
    <p className="text-sm text-slate-700">
      <span className="font-medium">Tensor</span> — shape{" "}
      <code className="rounded bg-slate-100 px-1 font-mono text-xs">{shapeStr}</code>.
    </p>
  );
}

function ValueTable({
  shape,
  data,
  inputCount,
  outputCount,
}: {
  shape: number[];
  data: [number, number][];
  inputCount: number;
  outputCount: number;
}) {
  if (shape.length === 0) {
    // Scalar — value shown in ShapeSummary.
    return null;
  }

  // `fmt` / `bitsToLabel` live in `matrix-format.ts` (shared with tests).
  const fmt = formatComplex;

  // The compute layer emits the result with shape
  //   [in_1, ..., in_n, out_1, ..., out_m]
  // in row-major order. Flattening: data[col * 2^m + row] where
  //   col = big-endian input bits,  row = big-endian output bits.
  // So the matrix view M(row, col) is a reshape of `data` into
  // (2^outputCount) rows × (2^inputCount) cols. This matches the
  // requested convention M(2*c+d, 2*a+b) = T(ab | cd).
  const nRows = 2 ** outputCount;
  const nCols = 2 ** inputCount;

  // The result tensor's shape length should equal nRows+nCols dims.
  // If there are leftover non-boundary legs (shape.length > inputCount
  // + outputCount), the clean 2D matrix doesn't apply — render a flat
  // list with explicit indices so the user still sees every value.
  if (shape.length !== inputCount + outputCount) {
    const tooLarge = data.length > 64;
    const display = tooLarge ? data.slice(0, 32) : data;
    return (
      <div className="space-y-1">
        <p className="text-xs text-slate-500">
          Tensor has non-boundary open legs — showing flat values.
        </p>
        <pre className="max-h-60 overflow-y-auto rounded-md border border-slate-200 bg-slate-50 p-3 font-mono text-xs text-slate-900">
          {display.map((v, i) => `[${i}] ${fmt(v)}`).join("\n")}
        </pre>
        {tooLarge && (
          <p className="text-xs text-slate-500">
            … and {data.length - 32} more entries
          </p>
        )}
      </div>
    );
  }

  // Build a row-major reshape. `data[col * nRows + row]` gives M(row, col).
  // Truncate if absurdly large (would blow up the DOM).
  const tooLarge = nRows * nCols > 64;
  const rowsToShow = tooLarge ? Math.min(nRows, 8) : nRows;
  const colsToShow = tooLarge ? Math.min(nCols, 8) : nCols;

  return (
    <div className="overflow-x-auto rounded-md border border-slate-200">
      <table className="border-collapse text-xs">
        <thead>
          <tr>
            {/* Top-left corner: labels the axes. */}
            <th className="border-b border-r border-slate-200 px-2 py-1 text-[10px] font-normal text-slate-500">
              {outputCount === 0 ? "" : "out\\in"}
            </th>
            {Array.from({ length: colsToShow }, (_, c) => (
              <th
                key={c}
                className="border-b border-slate-200 px-2 py-1 text-right font-mono text-[10px] font-normal text-slate-500"
              >
                {bitsToLabel(c, inputCount)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rowsToShow }, (_, r) => (
            <tr key={r} className="last:border-0">
              <th className="border-r border-slate-200 px-2 py-1 text-left font-mono text-[10px] font-normal text-slate-500">
                {bitsToLabel(r, outputCount)}
              </th>
              {Array.from({ length: colsToShow }, (_, c) => {
                const v = data[c * nRows + r];
                return (
                  <td
                    key={c}
                    className="px-2 py-1 text-right font-mono text-slate-800"
                  >
                    {fmt(v)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {tooLarge && (
        <p className="px-2 py-1 text-[10px] text-slate-500">
          Truncated to first {rowsToShow} × {colsToShow} of {nRows} × {nCols}.
        </p>
      )}
    </div>
  );
}

function WarningsBlock({
  warnings,
  open,
  onToggle,
}: {
  warnings: string[];
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="rounded-md border border-amber-200 bg-amber-50">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-amber-900"
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        Warnings ({warnings.length})
      </button>
      {open && (
        <ul className="border-t border-amber-200 px-3 py-2 text-xs text-amber-800">
          {warnings.map((w, i) => (
            <li key={i} className="py-0.5">{w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ErrorView({
  message,
  kind,
}: {
  message: string;
  kind: ComputeErrorKind;
}) {
  // Remediation hint per error kind. `kind` comes from the structured
  // `ComputeError` thrown by the compute wrapper (see
  // `src/lib/compute/errors.ts`) — no more substring sniffing of the
  // human-readable message.
  const hint = (() => {
    switch (kind) {
      case "version-mismatch":
        return (
          <>
            Rebuild with{" "}
            <code className="rounded bg-slate-100 px-1 font-mono">pnpm build:wasm</code>{" "}
            and refresh the page.
          </>
        );
      case "load-failed":
        return (
          <>
            Check that{" "}
            <code className="rounded bg-slate-100 px-1 font-mono">public/wasm/zxw/</code>{" "}
            exists and is up to date.
          </>
        );
      case "vertex-not-found":
      case "h-box-arity":
      case "boundary-degree":
      case "degree-overflow":
        return <>This is a graph-structure error — check the highlighted vertex or edge.</>;
      default:
        return null;
    }
  })();

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-red-700">Compute failed.</p>
      <pre className="max-h-60 overflow-y-auto rounded-md border border-red-200 bg-red-50 p-3 font-mono text-xs text-red-900 whitespace-pre-wrap">
        {message}
      </pre>
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
    </div>
  );
}
