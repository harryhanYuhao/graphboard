// Owns the "compute tensor" lifecycle: kicks off the contraction in the
// WASM worker, surfaces progress, and exposes state for the result dialog.
// Both the toolbar button and Cmd/Ctrl+Enter call `requestCompute`, so
// orchestration lives here (not the Zustand store, which holds only graph
// state).

"use client";

import { useCallback, useRef, useState } from "react";
import { useGraphStore } from "@/store/graph-store";
import { computeTensor, type ComputeCallbacks } from "@/lib/compute";
import { ComputeError } from "@/lib/compute/errors";
import type { TensorResult } from "@/lib/compute/result-types";
import { projectDocument } from "@/lib/serialisation";
import { PERSISTED_IDS } from "@/lib/graph/types";
import { validateGraphForCompute } from "@/lib/graph/validate";

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

    // Structural validation runs before the worker — catches bad W
    // topology, boundary degree, H-box arity, dangling refs, etc. so the
    // user gets immediate feedback without a WASM round-trip.
    const errors = validateGraphForCompute(graph);
    // Publish errors to the store on every compute — valid graph clears
    // the map (empty), invalid graph lights up the offending vertices.
    useGraphStore.getState().setValidationErrors(errors);
    if (errors.length > 0) {
      const first = errors[0];
      // The promise is already-rejected; attach a no-op catch now so it
      // can't become an unhandled rejection before the dialog mounts and
      // reads it. The dialog still settles via its own `.then`/`.catch`.
      const rejected = Promise.reject<never>(
        new ComputeError(first.kind, first.message),
      );
      rejected.catch(() => {});
      setProgress(null);
      setComputePromise(rejected);
      setComputeSeq((n) => n + 1);
      setComputeOpen(true);
      return;
    }

    // Cancel any in-flight run before starting a new one. Both runs would
    // otherwise post to the single-threaded worker and run serially, with
    // the older run's `onProgress` overwriting the new dialog's progress
    // bar (and Cancel only ever aborting the newest run).
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    const callbacks: ComputeCallbacks = {
      signal: controller.signal,
      onProgress: (contracted, total) => {
        // A newer request has replaced this controller — drop the stale
        // run's progress instead of clobbering the current dialog.
        if (abortRef.current !== controller) return;
        setProgress({ contracted, total });
      },
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
