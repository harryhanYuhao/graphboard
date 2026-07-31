// Owns the "compute tensor" lifecycle: kicks off the contraction in the
// WASM worker, surfaces progress, and exposes state for the result dialog.
// Both the toolbar button and Cmd/Ctrl+Enter call `requestCompute`, so
// orchestration lives here (not the Zustand store, which holds only graph
// state).

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
  /** Bumped per `requestCompute`; used as the dialog `key` to reset its state per run. */
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
  // Ref so `closeCompute` aborts the current controller, not a stale capture.
  const abortRef = useRef<AbortController | null>(null);

  const requestCompute = useCallback(() => {
    // Snapshot the graph at request time (getState, not reactive) and
    // project to the `GraphSlice` shape the compute layer expects.
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
