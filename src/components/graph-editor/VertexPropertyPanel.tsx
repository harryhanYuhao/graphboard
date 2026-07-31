// src/components/graph-editor/VertexPropertyPanel.tsx
//
// Popover shown when exactly one vertex is selected — edit type, label, and
// rotation without double-clicking the body. Docked top-right below the
// toolbar so it doesn't occlude placed vertices. Auto-dismisses (returns
// null) when selection count leaves 1.

"use client";

import { useMemo, useState } from "react";
import { useGraphStore } from "@/store/graph-store";
import {
  VERTEX_TYPES,
  isBoundaryVertex,
  isSpiderType,
} from "@/lib/graph/vertex-types";
import { normalizeRotation } from "@/lib/graph/serialization";
import type { VertexType } from "@/lib/graph/types";
import { useTrackedDraft } from "@/lib/hooks/useTrackedDraft";
import { useKatexReady } from "@/lib/hooks/useKatexReady";
import { renderLabel } from "@/lib/label/renderLabel";
import { parsePhase } from "@/lib/phase/parser";
import { VertexSwatch } from "./VertexSwatch";

export function VertexPropertyPanel() {
  const nodes = useGraphStore((state) => state.nodes);
  const updateVertexLabel = useGraphStore((state) => state.updateVertexLabel);
  const updateVertexType = useGraphStore((state) => state.updateVertexType);
  const updateVertexRotation = useGraphStore(
    (state) => state.updateVertexRotation,
  );
  const updateVertexOrder = useGraphStore(
    (state) => state.updateVertexOrder,
  );
  const onVertexPropertyEditStart = useGraphStore(
    (state) => state.onVertexPropertyEditStart,
  );
  const onVertexPropertyEditEnd = useGraphStore(
    (state) => state.onVertexPropertyEditEnd,
  );

  // Exactly one vertex selected. Otherwise hide.
  const selectedVertex = useMemo(() => {
    const selected = nodes.filter((node) => node.selected);
    return selected.length === 1 ? selected[0] : null;
  }, [nodes]);
  const validationErrors = useGraphStore((state) => state.validationErrors);
  const selectedErrors = selectedVertex
    ? validationErrors[selectedVertex.id] ?? []
    : [];

  // Local drafts avoid pushing every keystroke/tick into the store (which
  // would clutter the undo stack). `trackKey` is the selected vertex id, so
  // switching vertices resets each draft.
  const [labelDraft, setLabelDraft, labelDidReset] = useTrackedDraft({
    source: selectedVertex?.data.label ?? "",
    trackKey: selectedVertex?.id ?? null,
  });

  // True during a slider drag so the drift check below doesn't reset the
  // draft on every tick (which would also cause a one-frame panel flicker).
  const [isDraggingRotationSlider, setIsDraggingRotationSlider] =
    useState(false);

  const [rotationDraft, setRotationDraft, rotationDidReset] = useTrackedDraft({
    source: selectedVertex?.rotation ?? 0,
    trackKey: selectedVertex?.id ?? null,
    skipDriftCheck: isDraggingRotationSlider,
  });

  // Order is only meaningful for boundary (input/output) vertices.
  const [orderDraft, setOrderDraft, orderDidReset] = useTrackedDraft({
    source: selectedVertex?.data.order ?? 0,
    trackKey: selectedVertex?.id ?? null,
  });

  if (!selectedVertex) return null;

  // A draft just queued a reset this render — bail to avoid flashing stale
  // data for one frame before the reset applies.
  if (labelDidReset || rotationDidReset || orderDidReset) return null;

  const commitLabel = () => {
    const trimmed = labelDraft.trim();
    if (trimmed !== selectedVertex.data.label) {
      updateVertexLabel(selectedVertex.id, trimmed);
    }
  };

  const handleTypeChange = (next: VertexType) => {
    if (next !== selectedVertex.data.vertexType) {
      updateVertexType(selectedVertex.id, next);
    }
  };

  // `updateVertexOrder` re-stamps the whole boundary group sequentially, so
  // the committed value lands on the clamped target.
  const commitOrder = (value: number) => {
    if (!Number.isFinite(value)) {
      setOrderDraft(selectedVertex.data.order ?? 0);
      return;
    }
    const clamped = Math.floor(value);
    if (clamped !== selectedVertex.data.order) {
      updateVertexOrder(selectedVertex.id, clamped);
    }
  };

  // Commit rotation and normalize the draft (e.g. 720 → 0). The value is
  // passed in rather than read from `rotationDraft` to avoid stale-closure
  // hazards when called from a slider onChange that just set the draft.
  const commitRotation = (value: number) => {
    if (!Number.isFinite(value)) {
      setRotationDraft(selectedVertex.rotation);
      return;
    }

    const normalized = normalizeRotation(value);

    if (Math.abs(normalized - selectedVertex.rotation) > 0.001) {
      updateVertexRotation(selectedVertex.id, normalized);
    }

    if (value !== normalized) {
      setRotationDraft(normalized);
    }
  };

  const handleResetRotation = () => {
    if (selectedVertex.rotation !== 0) {
      updateVertexRotation(selectedVertex.id, 0);
    }
    setRotationDraft(0);
  };

  return (
    <div
      // Docked top-right below the toolbar (defensive stopPropagation keeps
      // React Flow from treating panel interaction as pane input).
      className="pointer-events-auto absolute right-4 top-20 z-20"
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div className="w-60 rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Vertex
        </div>

        {/* Validation errors from the last compute (if any). */}
        {selectedErrors.length > 0 && (
          <div className="mb-3 space-y-1 rounded-md border border-red-200 bg-red-50 p-2">
            {selectedErrors.map((e, i) => (
              <p key={i} className="text-xs text-red-700">
                {e.message}
              </p>
            ))}
          </div>
        )}

        {/* Type selector — compact swatch grid */}
        <div className="mb-3">
          <label className="mb-1 block text-xs text-slate-600">Type</label>
          <div className="grid grid-cols-4 gap-1">
            {VERTEX_TYPES.map((meta) => {
              const active = meta.type === selectedVertex.data.vertexType;
              return (
                <button
                  key={meta.type}
                  type="button"
                  title={meta.label}
                  onClick={() => handleTypeChange(meta.type)}
                  aria-pressed={active}
                  className={[
                    "flex items-center justify-center rounded-md border p-1.5",
                    active
                      ? "border-slate-900 bg-slate-100"
                      : "border-transparent hover:bg-slate-50",
                  ].join(" ")}
                >
                  <VertexSwatch meta={meta} />
                </button>
              );
            })}
          </div>
        </div>

        {/* Order (boundary vertices only): 0-indexed position within the type
            group, determining the contracted tensor's final axis order. */}
        {isBoundaryVertex(selectedVertex.data.vertexType) && (
          <div className="mb-3">
            <label className="mb-1 block text-xs text-slate-600">Order</label>
            <input
              type="number"
              min={0}
              step={1}
              value={Number.isFinite(orderDraft) ? orderDraft : ""}
              onChange={(event) =>
                setOrderDraft(Number(event.target.value))
              }
              onBlur={() => commitOrder(orderDraft)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  (event.target as HTMLInputElement).blur();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  setOrderDraft(selectedVertex.data.order ?? 0);
                  (event.target as HTMLInputElement).blur();
                }
              }}
              className="w-full rounded-md border border-slate-200 px-2 py-1 text-sm text-slate-900 outline-none focus:border-slate-900"
            />
          </div>
        )}

        {/* Label input — commits on blur/Enter, reverts on Escape. */}
        <div>
          <label className="mb-1 block text-xs text-slate-600">Label</label>
          <input
            type="text"
            value={labelDraft}
            onChange={(event) => setLabelDraft(event.target.value)}
            onBlur={commitLabel}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                (event.target as HTMLInputElement).blur();
              } else if (event.key === "Escape") {
                event.preventDefault();
                setLabelDraft(selectedVertex.data.label);
                (event.target as HTMLInputElement).blur();
              }
            }}
            placeholder="Label"
            className="w-full rounded-md border border-slate-200 px-2 py-1 text-sm text-slate-900 outline-none focus:border-slate-900"
          />

          {/* Live preview: how the label renders (KaTeX or plain text), and
              the parsed phase value/error for spider types. Driven off the
              draft so feedback shows as the user types. */}
          <LabelPreview
            label={labelDraft}
            vertexType={selectedVertex.data.vertexType}
          />
        </div>

        {/* Rotation: precise number input + gestural slider + reset. Stored in
            the view slice (not graph). Slider drag is wrapped in pause/resume
            so intermediate commits collapse into one undo step. */}
        <div className="mt-3 border-t border-slate-100 pt-3">
          <div className="mb-1 flex items-center justify-between">
            <label className="block text-xs text-slate-600">Rotation</label>
            <button
              type="button"
              onClick={handleResetRotation}
              className="text-[11px] text-slate-500 hover:text-slate-900"
            >
              Reset
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              step={1}
              value={Number.isFinite(rotationDraft) ? rotationDraft : ""}
              onChange={(event) => setRotationDraft(Number(event.target.value))}
              onBlur={() => commitRotation(rotationDraft)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  (event.target as HTMLInputElement).blur();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  setRotationDraft(selectedVertex.rotation);
                  (event.target as HTMLInputElement).blur();
                }
              }}
              className="w-full rounded-md border border-slate-200 px-2 py-1 text-sm text-slate-900 outline-none focus:border-slate-900"
            />
            <span className="text-xs text-slate-500">°</span>
          </div>
          <input
            type="range"
            min={0}
            max={360}
            step={1}
            value={Number.isFinite(rotationDraft) ? rotationDraft : 0}
            // Pointer capture keeps pointerup firing on the slider even if the
            // cursor leaves the bounds mid-drag (avoids leaking a paused undo).
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              setIsDraggingRotationSlider(true);
              onVertexPropertyEditStart();
            }}
            onPointerUp={(event) => {
              event.currentTarget.releasePointerCapture(event.pointerId);
              setIsDraggingRotationSlider(false);
              onVertexPropertyEditEnd();
            }}
            onChange={(event) => {
              const next = Number(event.target.value);
              setRotationDraft(next);
              commitRotation(next);
            }}
            className="mt-2 w-full accent-slate-700"
          />
        </div>
      </div>
    </div>
  );
}

// ---- Live label preview -----------------------------------------------------
// Two hints below the label input: "Renders" (how the label displays) and
// "Phase" (spider types only: parsed phase value or error). Hidden when the
// label is empty and the type isn't a spider.

function LabelPreview({
  label,
  vertexType,
}: {
  label: string;
  vertexType: VertexType;
}) {
  const isSpider = isSpiderType(vertexType);
  // Re-render once KaTeX loads so a LaTeX preview upgrades to rendered math.
  useKatexReady();
  if (label === "" && !isSpider) return null;

  const rendered = renderLabel(label);

  return (
    <div className="mt-1.5 rounded border border-slate-100 bg-slate-50 px-2 py-1.5 text-xs">
      <div className="flex items-baseline gap-2">
        <span className="w-12 shrink-0 text-[10px] uppercase tracking-wide text-slate-400">
          Renders
        </span>
        {label === "" ? (
          <span className="italic text-slate-400">empty</span>
        ) : (
          // `renderLabel` is XSS-safe (escaped text; KaTeX `trust: false`).
          <span
            className="text-slate-900"
            dangerouslySetInnerHTML={{ __html: rendered.html }}
          />
        )}
      </div>
      {isSpider && <PhaseHint label={label} />}
    </div>
  );
}

function PhaseHint({ label }: { label: string }) {
  const r = parsePhase(label);
  if (r.ok) {
    // Empty label parses as Ok(0); show it so users see identity, not undefined.
    return (
      <div className="mt-1 flex items-baseline gap-2 border-t border-slate-100 pt-1">
        <span className="w-12 shrink-0 text-[10px] uppercase tracking-wide text-slate-400">
          Phase
        </span>
        <span className="text-slate-900">
          {r.value.toFixed(4)} rad
          {r.value !== 0 && (
            <span className="ml-1.5 text-slate-500">
              ({formatPiMultiple(r.value)}π)
            </span>
          )}
        </span>
      </div>
    );
  }
  return (
    <div className="mt-1 flex items-baseline gap-2 border-t border-slate-100 pt-1">
      <span className="w-12 shrink-0 text-[10px] uppercase tracking-wide text-slate-400">
        Phase
      </span>
      <span className="text-rose-600">{r.error}</span>
    </div>
  );
}

// Express `rad` as a multiple of π (researchers think in π multiples).
function formatPiMultiple(rad: number): string {
  const ratio = rad / Math.PI;
  // toFixed(4) is enough resolution for typical phase inputs.
  return ratio.toFixed(4);
}
