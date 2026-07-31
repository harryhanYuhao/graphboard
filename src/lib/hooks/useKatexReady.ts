// Subscribe to the KaTeX lazy-load signal. Returns `true` once the
// chunk resolves, so components rendering LaTeX labels re-render then
// instead of staying on the escaped-text fallback. Use in any
// `renderLabel` caller that may show LaTeX; cheap (one subscription
// resolving once), so unconditional use is fine.

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
    // SSR: KaTeX isn't loaded server-side; labels hydrate to math on the client.
    () => false,
  );
}
