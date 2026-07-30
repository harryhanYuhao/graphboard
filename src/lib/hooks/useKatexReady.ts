// src/lib/hooks/useKatexReady.ts
//
// Subscribes a component to the KaTeX lazy-load signal. Returns `true`
// once the KaTeX chunk has resolved, so a component that renders a
// LaTeX label (via `renderLabel`) re-renders at that moment instead of
// staying on the pre-load escaped-text fallback.
//
// Use it in any component that calls `renderLabel` and may show LaTeX.
// Plain-text labels never touch KaTeX, so this only matters for the
// LaTeX path — but it's cheap (one `useSyncExternalStore` subscription
// that resolves once) so calling it unconditionally in those two
// components is fine.

"use client";

import { useSyncExternalStore } from "react";
import {
  getKatexReadySnapshot,
  subscribeKatexReady,
} from "@/lib/label/katex-loader";

export function useKatexReady(): boolean {
  return useSyncExternalStore(
    subscribeKatexReady,
    getKatexReadySnapshot,
    // SSR snapshot: KaTeX isn't loaded server-side, so report not-ready.
    // LaTeX labels server-render as escaped text and hydrate to math on
    // the client once the chunk loads.
    () => false,
  );
}
