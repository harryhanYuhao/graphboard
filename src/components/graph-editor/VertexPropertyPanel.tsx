// src/components/graph-editor/VertexPropertyPanel.tsx
//
// Floating popover shown when exactly one vertex is selected. Lets the user
// change the vertex's type (ZXW generator), edit its label, and adjust its
// rotation without needing to double-click the vertex body.
//
// Positioning: docked to the right edge of the screen (top-right, below
// the toolbar). Docking (rather than anchoring next to the selected
// vertex) keeps the panel from occluding other vertices in the canvas —
// the cost is that it now overlaps the right strip of the canvas, but
// that strip is out of the way of typical vertex placement.
//
// Auto-dismiss: when the selection count drops to 0 or grows past 1
// (multi-select, box-select, deselect, deletion), the component returns
// `null`. React Flow's own selection handlers (e.g. pane click clears
// selection, marquee selects many) drive that for free.

"use client";

import { useMemo, useState } from "react";
import { useGraphStore } from "@/store/graph-store";
import {
  VERTEX_TYPES,
  isSpiderType,
} from "@/lib/graph/vertex-types";
import { normalizeRotation } from "@/lib/graph/serialization";
import type { VertexType } from "@/lib/graph/types";
import { useTrackedDraft } from "@/lib/hooks/useTrackedDraft";
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

  // Local drafts so we don't push every keystroke / slider tick into
  // the store (which would clutter the undo stack). Each draft tracks
  // the source value + the selected vertex's id, so a switch to a
  // different vertex — even one with the same label / rotation —
  // resets the draft.
  const [labelDraft, setLabelDraft, labelDidReset] = useTrackedDraft({
    source: selectedVertex?.data.label ?? "",
    trackKey: selectedVertex?.id ?? null,
  });

  // True for the duration of a slider drag, so the drift check below
  // doesn't reset the draft on every tick. The store IS being updated
  // on every tick (for live preview) — the draft is too — so resetting
  // it would be a no-op write but it would also force a `return null`
  // on this render and cause a brief mount/unmount flicker of the
  // panel. State (not a ref) because the hook reads it during render.
  const [isDraggingRotationSlider, setIsDraggingRotationSlider] =
    useState(false);

  const [rotationDraft, setRotationDraft, rotationDidReset] = useTrackedDraft({
    source: selectedVertex?.rotation ?? 0,
    trackKey: selectedVertex?.id ?? null,
    skipDriftCheck: isDraggingRotationSlider,
  });

  if (!selectedVertex) return null;

  // Either draft just queued a reset this render — bail so the panel
  // doesn't flash stale data for one frame before the reset applies
  // on the next render.
  if (labelDidReset || rotationDidReset) return null;

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

  // Commit a rotation value to the store and canonicalize the local
  // draft to the normalized form (e.g. user typed 720 → input shows 0
  // after commit, canvas stays at 0°). The value is passed in rather
  // than read from `rotationDraft` to dodge stale-closure hazards
  // when this is called from a slider onChange that just set the draft.
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
      // Docked to the right edge, top-aligned below the toolbar.
      // `right-4 top-20` lines up roughly with the toolbar's vertical
      // position and leaves a 16px gap from the screen edge.
      className="pointer-events-auto absolute right-4 top-20 z-20"
      // Stop the panel from being treated as part of the React Flow
      // surface — it's an absolute-positioned sibling, but defensive.
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div className="w-60 rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Vertex
        </div>

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

        {/* Label input — commits on blur / Enter, reverts on Escape.
            Mirrors the double-click-to-edit behavior already inside
            VertexNode. */}
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

          {/* Live preview — shows how the label renders (KaTeX for
              `$...$` / `$$...$$`, plain text otherwise) and, for spider
              types where the label is interpreted as a phase
              expression, the parsed value or error. Driven off the
              draft so the user sees feedback as they type, before
              commit. */}
          <LabelPreview
            label={labelDraft}
            vertexType={selectedVertex.data.vertexType}
          />
        </div>

        {/* Rotation — number input (precise) + slider (gestural) + reset.
            Stored in the view slice, not the graph slice (see types.ts).
            Slider drag is wrapped in a pause/resume so the many
            intermediate commits during a drag collapse into one undo
            step — same trick the canvas uses for node dragging. */}
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
            // Pointer capture keeps pointerup firing on the slider even
            // if the cursor leaves the bounds mid-drag — without this
            // a fast drag past the edge would leak a paused temporal.
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
//
// Two stacked hints below the label input:
//
//   - "Renders": what the label will look like inside the vertex body
//     (KaTeX for `$...$` / `$$...$$`, plain text otherwise). Lets the
//     user see their LaTeX take shape as they type.
//
//   - "Phase" (spider types only): the parsed value of the label as
//     a phase expression, in radians plus a π multiple. Errors get a
//     red message — the compute entry point (Phase 4) will silently
//     fall back to phase 0 in this case, but surfacing the error here
//     gives the user a chance to fix it before they hit Compute.
//
// The preview is hidden when both (a) the label is empty and (b) the
// vertex type isn't a spider — for empty labels on H / W / AND /
// empty there's nothing meaningful to show.

function LabelPreview({
  label,
  vertexType,
}: {
  label: string;
  vertexType: VertexType;
}) {
  const isSpider = isSpiderType(vertexType);
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
          // `renderLabel` is XSS-safe — plain text path is
          // HTML-escaped, and the KaTeX path uses `trust: false` so
          // user LaTeX can't smuggle links into the editor canvas.
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
    // Empty label → parsePhase returns Ok(0). Show "0 rad" so the
    // user knows an empty spider is identity, not undefined.
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

// Express `rad` as a multiple of π with up to 4 decimal places.
// Researchers think in multiples of π; showing both rad and π
// avoids the mental gymnastics of converting 3.1416 back to π.
function formatPiMultiple(rad: number): string {
  const ratio = rad / Math.PI;
  // `toFixed(4)` is enough resolution for typical phase inputs;
  // a researcher typing `0.123456789` sees it all the way through.
  return ratio.toFixed(4);
}
