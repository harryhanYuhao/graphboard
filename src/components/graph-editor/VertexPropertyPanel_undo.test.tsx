// Pins the rotation-slider undo-gesture contract: dragging pauses the undo
// stack (intermediate ticks don't land), and unmounting the panel mid-drag
// must resume it — otherwise undo silently breaks for the rest of the
// session (pointerup never fires once the vertex is deselected).

import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useGraphStore } from "@/store/graph-store";
import { makeVertexWith } from "@/test-utils/factories";
import { VertexPropertyPanel } from "./VertexPropertyPanel";

describe("VertexPropertyPanel — rotation slider undo gesture", () => {
  beforeEach(() => {
    useGraphStore.getState().reset();
    useGraphStore.temporal.getState().clear();
    useGraphStore.setState({ validationErrors: {} });
    // jsdom lacks pointer capture; the slider's onPointerDown calls it.
    vi.stubGlobal("setPointerCapture", undefined as never);
    (HTMLElement.prototype as unknown as Record<string, unknown>)
      .setPointerCapture = vi.fn();
    (HTMLElement.prototype as unknown as Record<string, unknown>)
      .releasePointerCapture = vi.fn();
  });

  it("unmounting mid-drag resumes the paused undo stack", () => {
    useGraphStore.setState({
      nodes: [makeVertexWith("a", { selected: true, data: { vertexType: "z" } })],
    });

    const { unmount } = render(<VertexPropertyPanel />);
    const slider = screen.getByRole("slider");
    const baseline = useGraphStore.temporal.getState().pastStates.length;

    fireEvent.pointerDown(slider, { pointerId: 1 });

    // The gesture must have paused tracking (intermediate ticks don't land).
    expect(useGraphStore.temporal.getState().isTracking).toBe(false);

    // A mutation while the gesture is active must NOT land on the undo stack.
    useGraphStore.getState().addVertexAt({ x: 0, y: 0 });
    expect(useGraphStore.temporal.getState().pastStates.length).toBe(baseline);

    // Unmounting the panel mid-drag: the cleanup must resume the gesture
    // (which pushes the pre-gesture snapshot), so the stack keeps growing.
    unmount();

    // A subsequent tracked mutation now lands on the stack again.
    useGraphStore.getState().addVertexAt({ x: 24, y: 24 });
    expect(useGraphStore.temporal.getState().pastStates.length).toBe(
      baseline + 2,
    );
  });
});
