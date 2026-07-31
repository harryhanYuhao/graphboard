// Message protocol between the main thread (`index.ts`) and the Web
// Worker (`worker.ts`). Compute messages carry a `requestId` so the
// client can multiplex calls; `version-check` / `version-ok` are a
// one-shot init handshake.

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
