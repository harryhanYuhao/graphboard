// src/components/graph-editor/VertexPropertyPanel.tsx
//
// Floating popover shown when exactly one vertex is selected. Lets the user
// change the vertex's type (ZXW generator), edit its label, and adjust its
// rotation without needing to double-click the vertex body.
//
// Positioning: anchored to the vertex's flow-space position transformed
// into screen space via React Flow's `flowToScreenPosition`. Re-anchors
// on viewport changes (pan/zoom) and on drag because both flow through
// React Flow state that this component subscribes to.
//
// Auto-dismiss: when the selection count drops to 0 or grows past 1
// (multi-select, box-select, deselect, deletion), the component returns
// `null`. React Flow's own selection handlers (e.g. pane click clears
// selection, marquee selects many) drive that for free.

"use client";

import { useMemo, useState } from "react";
import { useReactFlow, useViewport } from "@xyflow/react";
import { useGraphStore } from "@/store/graph-store";
import { VERTEX_TYPES, VERTEX_TYPE_MAP } from "@/lib/graph/vertex-types";
import { normalizeRotation } from "@/lib/graph/serialization";
import type { VertexType } from "@/lib/graph/types";
import { VertexSwatch } from "./VertexSwatch";

// Cursor-snap distance (px) between the panel and the selected vertex.
const PANEL_OFFSET_PX = 12;

// Conservative estimate of the vertex's rendered radius in pixels (used to
// place the panel clear of the body so it doesn't sit on top of the shape).
// Vertex sizes come from `VERTEX_TYPE_MAP[*].size`, expressed in rem; we
// convert to px and halve for the radius. The exact match isn't critical —
// the panel just needs to not overlap the body.
function approxVertexRadiusPx(vertexType: VertexType): number {
  const meta = VERTEX_TYPE_MAP[vertexType];
  const sizeRem = meta.size;
  return (sizeRem * 16) / 2 + 4;
}

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
  const { flowToScreenPosition } = useReactFlow();
  // Subscribe to viewport so the panel re-anchors on pan/zoom. The hook
  // re-renders on transform changes; we only read it for the side effect.
  useViewport();

  // Exactly one vertex selected. Otherwise hide.
  const selectedVertex = useMemo(() => {
    const selected = nodes.filter((node) => node.selected);
    return selected.length === 1 ? selected[0] : null;
  }, [nodes]);

  // Convert the selected vertex's flow-space position to screen space.
  // Recomputes on:
  //   - selected vertex change (different flow position)
  //   - viewport change (transform updated, `useViewport` re-rendered us)
  const screenPosition = useMemo(() => {
    if (!selectedVertex) return null;
    return flowToScreenPosition({
      x: selectedVertex.position.x,
      y: selectedVertex.position.y,
    });
  }, [selectedVertex, flowToScreenPosition]);

  // Local draft for the label input so we don't push every keystroke into
  // the store (which would clutter the undo stack). Tracked alongside the
  // vertex id and the last-known label so we can reset on selection switch
  // or when an external edit (undo, programmatic change) updates the label.
  const [labelDraft, setLabelDraft] = useState("");
  const [trackedId, setTrackedId] = useState<string | null>(null);
  const [trackedLabel, setTrackedLabel] = useState<string | null>(null);

  // Rotation draft + tracker. Same pattern as the label: local copy so
  // we don't push every keystroke / slider tick into the store, with a
  // tracked value to detect external changes (undo, etc.).
  const [rotationDraft, setRotationDraft] = useState(0);
  const [trackedRotation, setTrackedRotation] = useState<number | null>(null);
  // True for the duration of a slider drag, so the drift check below
  // doesn't reset the draft on every tick. The store IS being updated
  // on every tick (for live preview) — the draft is too — so resetting
  // it would be a no-op write but it would also force a `return null`
  // on this render and cause a brief mount/unmount flicker of the
  // panel. State (not a ref) because the drift check needs to read it
  // during render, which the react-hooks/refs rule forbids for refs.
  const [isDraggingRotationSlider, setIsDraggingRotationSlider] =
    useState(false);

  // Reset the drafts when the tracked vertex id / label / rotation drifts
  // from the store. Done during render (not in an effect) — the React-
  // recommended replacement for `useEffect` that just mirrors props into
  // local state. See https://react.dev/learn/you-might-not-need-an-effect
  if (
    selectedVertex &&
    (trackedId !== selectedVertex.id ||
      trackedLabel !== selectedVertex.data.label ||
      (trackedRotation !== selectedVertex.rotation &&
        !isDraggingRotationSlider))
  ) {
    setTrackedId(selectedVertex.id);
    setTrackedLabel(selectedVertex.data.label);
    setLabelDraft(selectedVertex.data.label);
    setTrackedRotation(selectedVertex.rotation);
    setRotationDraft(selectedVertex.rotation);
    // Bail out of this render; the next render uses the fresh state.
    return null;
  }

  if (!selectedVertex || !screenPosition) return null;

  const vertexRadius = approxVertexRadiusPx(selectedVertex.data.vertexType);

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
      className="pointer-events-auto absolute z-20"
      style={{
        // Top-right of the vertex body: anchor to the right edge plus a
        // small gap, vertically aligned with the vertex center.
        left: screenPosition.x + vertexRadius + PANEL_OFFSET_PX,
        top: screenPosition.y - vertexRadius,
      }}
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
