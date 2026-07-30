// src/lib/hooks/useCompute.ts
//
// Owns the full "compute tensor" lifecycle: kicking off the contraction
// in the WASM worker, surfacing progress, and exposing the state the
// result dialog consumes. Both the toolbar button and the Cmd/Ctrl+Enter
// keyboard shortcut call `requestCompute`, so compute orchestration has
// exactly one home — it lives outside the Zustand store on purpose,
// because the store is reserved for graph state and a one-shot async
// computation (plus its promise/progress state) doesn't belong there.
//
// The returned state feeds `<ComputeResultDialog>`, which is rendered by
// `GraphEditor` alongside the other top-level dialogs.

"use client";

import { useCallback, useRef, useState } from "react";
import { useGraphStore } from "@/store/graph-store";
import { computeTensor, type ComputeCallbacks } from "@/lib/compute";
import type { TensorResult } from "@/lib/compute/result-types";
import { projectDocument } from "@/lib/graph/serialization";
import { PERSISTED_IDS } from "@/lib/graph/types";

export interface ComputeState {
  /** Whether the result dialog is open. */
  computeOpen: boolean;
  /** Promise returned by `computeTensor`; null while idle. */
  computePromise: Promise<TensorResult> | null;
  /** Progress updates from the contraction loop, or null while idle. */
  progress: { contracted: number; total: number } | null;
  /**
   * Monotonic counter bumped on each `requestCompute`. Used as the
   * dialog's `key` so it remounts per run, resetting its internal
   * ok/error state cleanly.
   */
  computeSeq: number;
  /** Kick off a contraction and open the dialog. */
  requestCompute: () => void;
  /** Soft-cancel any in-flight computation and close the dialog. */
  closeCompute: () => void;
}

export function useCompute(): ComputeState {
  const [computeOpen, setComputeOpen] = useState(false);
  const [computePromise, setComputePromise] = useState<
    Promise<TensorResult> | null
  >(null);
  const [progress, setProgress] = useState<{
    contracted: number;
    total: number;
  } | null>(null);
  const [computeSeq, setComputeSeq] = useState(0);
  // Keep the AbortController in a ref so `closeCompute` can cancel via a
  // callback that closes over the *current* controller, not a stale
  // state capture.
  const abortRef = useRef<AbortController | null>(null);

  const requestCompute = useCallback(() => {
    // Read a snapshot of the current graph from the store and project
    // to the persisted `GraphSlice` shape the compute layer expects. We
    // use `useGraphStore.getState()` rather than reactive reads because
    // we want the state *at request time*, not on every change.
    const state = useGraphStore.getState();
    const doc = projectDocument({
      id: PERSISTED_IDS.localDocument,
      title: state.title,
      nodes: state.nodes,
      edges: state.edges,
      createdAt: state.createdAt,
      updatedAt: new Date().toISOString(),
    });
    const graph = doc.graph;

    const controller = new AbortController();
    abortRef.current = controller;
    const callbacks: ComputeCallbacks = {
      signal: controller.signal,
      onProgress: (contracted, total) => setProgress({ contracted, total }),
    };

    setProgress({ contracted: 0, total: 0 });
    setComputePromise(computeTensor(graph, callbacks));
    setComputeSeq((n) => n + 1);
    setComputeOpen(true);
  }, []);

  const closeCompute = useCallback(() => {
    // Soft-cancel any in-flight computation when the dialog closes.
    abortRef.current?.abort();
    abortRef.current = null;
    setComputeOpen(false);
    setComputePromise(null);
    setProgress(null);
  }, []);

  return {
    computeOpen,
    computePromise,
    progress,
    computeSeq,
    requestCompute,
    closeCompute,
  };
}
