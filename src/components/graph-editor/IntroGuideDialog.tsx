// src/components/graph-editor/IntroGuideDialog.tsx
//
// First-run onboarding stepper. Auto-opens once per browser (gate in the
// store's `hydrate()`, keyed off `graph-board-seen-intro`); reopenable from
// Help. Sibling shape to `HelpDialog` (backdrop/Escape close,
// primary button auto-focused). Pure/presentational — the store owns the
// "seen" flag, stamped at open so any close path counts.

"use client";

import { useEffect, useRef, useState } from "react";
import {
  Calculator,
  GitBranch,
  PlusCircle,
  Pencil,
  X,
  type LucideIcon,
} from "lucide-react";
import { modifierSymbol } from "@/lib/keyboard/shortcuts";

interface IntroGuideDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

interface IntroStep {
  icon: LucideIcon;
  title: string;
  body: React.ReactNode;
}

function buildSteps(mod: string): IntroStep[] {
  return [
    {
      icon: PlusCircle,
      title: "Place a vertex",
      body: (
        <>
          Press <Kbd>V</Kbd> to enter add-vertex mode, then click anywhere on
          the canvas to drop a vertex.
          Press number keys to change vertex types.
        </>
      ),
    },
    {
      icon: GitBranch,
      title: "Connect vertices",
      body: (
        <>
          Press <Kbd>E</Kbd>, click one vertex, then click another to connect
          them with an edge.
        </>
      ),
    },
    {
      icon: Pencil,
      title: "Edit the phase",
      body: (
        <>
          Double-click a vertex&apos;s label to edit its phase. An empty label
          means phase 0. Latex supported.
        </>
      ),
    },
    {
      icon: Calculator,
      title: "Compute & get help",
      body: (
        <>
          Press <Kbd>{mod}</Kbd>+<Kbd>Enter</Kbd> to compute the represented
          tensor. Press <Kbd>?</Kbd> any time to reopen this guide.
        </>
      ),
    },
  ];
}

// Inline <kbd> chip matching the other dialogs; local helper keeps step bodies clean.
function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[11px] text-slate-700">
      {children}
    </kbd>
  );
}

export function IntroGuideDialog({ isOpen, onClose }: IntroGuideDialogProps) {
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
      aria-labelledby="intro-title"
    >
      <div
        className="relative w-full max-w-md rounded-lg bg-white p-6 shadow-xl"
        onKeyDown={handleKeyDown}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-300"
          aria-label="Close intro guide"
        >
          <X size={20} />
        </button>
        {/* Remounting the stepper on open lets its `useState(0)` initializer
            handle the reset — no effect-driven setState. */}
        <IntroStepper key="intro-stepper" onClose={onClose} />
      </div>
    </div>
  );
}

function IntroStepper({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const nextRef = useRef<HTMLButtonElement>(null);

  const steps = buildSteps(modifierSymbol());
  const stepCount = steps.length;
  const isLast = step === stepCount - 1;

  // Focus the primary button on mount so Esc is one keypress away.
  useEffect(() => {
    nextRef.current?.focus();
  }, []);

  const handleNext = () => {
    if (isLast) {
      onClose();
    } else {
      setStep((s) => Math.min(s + 1, stepCount - 1));
    }
  };

  const handleBack = () => {
    setStep((s) => Math.max(s - 1, 0));
  };

  const current = steps[step];
  const Icon = current.icon;

  return (
    <div className="space-y-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        Welcome to Graph Board
      </p>

      {/* Step body. `key` on the icon forces a fresh element so a future
          enter/exit animation re-mounts per step. */}
      <div className="flex flex-col items-center gap-3 py-2 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-slate-700">
          <Icon key={step} size={28} />
        </span>
        <h2 id="intro-title" className="text-lg font-semibold text-slate-900">
          {current.title}
        </h2>
        <p className="text-sm leading-relaxed text-slate-600">{current.body}</p>
      </div>

      {/* Progress dots */}
      <div className="flex items-center justify-center gap-1.5">
        {steps.map((s, i) => (
          <span
            key={s.title}
            aria-hidden="true"
            className={`h-1.5 w-1.5 rounded-full transition-colors ${i === step ? "bg-slate-700" : "bg-slate-300"
              }`}
          />
        ))}
      </div>

      {/* Footer controls */}
      <div className="flex items-center justify-between border-t border-slate-100 pt-4">
        <button
          type="button"
          onClick={handleBack}
          disabled={step === 0}
          className="rounded px-3 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-0"
        >
          Back
        </button>
        <span className="text-xs text-slate-400">
          {step + 1} / {stepCount}
        </span>
        <button
          ref={nextRef}
          type="button"
          onClick={handleNext}
          className="rounded bg-slate-800 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-400"
        >
          {isLast ? "Got it" : "Next"}
        </button>
      </div>
    </div>
  );
}
