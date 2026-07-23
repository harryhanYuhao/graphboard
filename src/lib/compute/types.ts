// src/lib/compute/types.ts
//
// Message protocol between the main thread (`src/lib/compute/index.ts`)
// and the Web Worker (`src/lib/compute/worker.ts`). Every message
// carries a `requestId` (except `version-check` / `version-ok`, which
// are a one-shot handshake at worker init) so the main-thread client
// can multiplex concurrent calls — though v1 only allows one in-flight
// compute (the Compute button is disabled while pending).
//
// See `doc/plans.md` §6.2 for the full design rationale.

import type { GraphSlice } from "@/lib/graph/types";
import type { ComputeErrorKind, TensorResult } from "./result-types";

// ── Main → Worker ──────────────────────────────────────────────────

export type WorkerRequest =
  | { type: "compute"; requestId: string; graph: GraphSlice }
  | { type: "cancel"; requestId: string }
  | { type: "version-check" };

// ── Worker → Main ──────────────────────────────────────────────────

export type WorkerResponse =
  | {
      type: "progress";
      requestId: string;
      contracted: number;
      total: number;
    }
  | { type: "result"; requestId: string; result: TensorResult }
  | {
      type: "error";
      requestId: string;
      error: string;
      /** Classified kind, so the UI doesn't substring-sniff `error`. */
      errorKind?: ComputeErrorKind;
    }
  | { type: "version-ok"; version: string };
