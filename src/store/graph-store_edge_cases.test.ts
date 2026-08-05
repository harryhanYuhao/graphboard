// Edge-case probing for the Zustand graph store. Each test pins ONE behavior
// of an action or the undo/redo (zundo temporal) machinery. Conventions mirror
// graph-store.test.ts: hit the store directly, reset a baseline in beforeEach,
// and clear the temporal stack between tests.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { useGraphStore } from "./graph-store";
import { makeVertexWith as makeVertex, makeEdge } from "@/test-utils/factories";

// `importJson` reaches into `@/lib/download`'s openTextFileWithPicker. Mock the
// whole module to feed it a canned JSON string (jsdom lacks the FSA API anyway).
// `vi.mocked` lets each test program the return value.
vi.mock("@/lib/download", () => ({
  openTextFileWithPicker: vi.fn(),
  saveTextFileWithPicker: vi.fn(),
}));

import { openTextFileWithPicker, saveTextFileWithPicker } from "@/lib/download";

function resetStore() {
  useGraphStore.setState({
    title: "Untitled Graph",
    createdAt: "2025-01-01T00:00:00.000Z",
    nodes: [],
    edges: [],
    mode: "select",
    hasHydrated: false,
    pendingEdgeSources: [],
    selectedVertexType: "z",
    confirmDialogue: null,
    isHelpOpen: false,
    isExportOpen: false,
    clipboard: null,
    fitViewNonce: 0,
  });
  // Clear the undo/redo stack so prior tests don't leak via snapshots.
  useGraphStore.temporal.getState().clear();
  // Reset the picker mock between tests.
  vi.mocked(openTextFileWithPicker).mockReset();
  vi.mocked(saveTextFileWithPicker).mockReset();
}

beforeEach(resetStore);

// Minimal valid v1 document JSON the import path accepts.
function validDocJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schemaVersion: 1,
    id: "local-document",
    title: "Imported",
    graph: {
      nodes: [{ id: "imp1", data: { label: "lbl", vertexType: "z" } }],
      edges: [],
    },
    view: { nodes: [{ id: "imp1", position: { x: 9, y: 9 } }], edges: [] },
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Undo history lifecycle on document replacement. reset/hydrate/importJson
// all clear the temporal stack so a new document doesn't carry old history.
// ---------------------------------------------------------------------------

describe("undo history lifecycle on document replacement", () => {
  it("reset() clears the undo stack (positive control)", () => {
    useGraphStore.getState().addVertexAt({ x: 0, y: 0 });
    useGraphStore.getState().addVertexAt({ x: 10, y: 10 });
    expect(useGraphStore.temporal.getState().pastStates.length).toBeGreaterThan(0);

    useGraphStore.getState().reset();
    expect(useGraphStore.temporal.getState().pastStates.length).toBe(0);
  });

  it("hydrate() clears the undo stack (positive control)", () => {
    localStorage.clear();
    useGraphStore.getState().addVertexAt({ x: 0, y: 0 });
    expect(useGraphStore.temporal.getState().pastStates.length).toBeGreaterThan(0);

    // Seed localStorage with a doc hydrate will load.
    localStorage.setItem("graph-board-document", validDocJson());
    useGraphStore.getState().hydrate();
    expect(useGraphStore.temporal.getState().pastStates.length).toBe(0);
  });

  it("importJson clears the undo stack after a successful import", async () => {
    // Seed undo history so there's something to clear.
    useGraphStore.getState().addVertexAt({ x: 0, y: 0 });
    useGraphStore.getState().addVertexAt({ x: 10, y: 10 });
    expect(useGraphStore.temporal.getState().pastStates.length).toBeGreaterThan(0);

    vi.mocked(openTextFileWithPicker).mockResolvedValue(validDocJson());
    await useGraphStore.getState().importJson();

    // The canvas was non-empty, so importJson opened the confirm dialog.
    // Simulate the user clicking "Import" — the path that runs applyImport.
    const dialogue = useGraphStore.getState().confirmDialogue;
    expect(dialogue).not.toBeNull();
    dialogue!.onConfirm();

    expect(useGraphStore.temporal.getState().pastStates.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// updateVertexRotation normalization. The store action applies
// normalizeRotation (wrap to [0,360), round float drift) at the boundary so
// every caller gets the canonical value.
// ---------------------------------------------------------------------------

describe("updateVertexRotation normalization", () => {
  it("wraps a value >= 360 into the canonical [0, 360) range", () => {
    useGraphStore.setState({ nodes: [makeVertex("a")] });
    useGraphStore.getState().updateVertexRotation("a", 720);
    expect(useGraphStore.getState().nodes[0].rotation).toBe(0);
  });

  it("wraps a negative value into the canonical [0, 360) range", () => {
    useGraphStore.setState({ nodes: [makeVertex("a")] });
    useGraphStore.getState().updateVertexRotation("a", -90);
    expect(useGraphStore.getState().nodes[0].rotation).toBeCloseTo(270, 6);
  });
});

// ---------------------------------------------------------------------------
// Drag gesture invariants (module-level `dragGesture` controller).
// ---------------------------------------------------------------------------

describe("drag gesture snapshot counting", () => {
  it("one drag with many position changes pushes exactly one pastState", () => {
    useGraphStore.setState({
      nodes: [makeVertex("a", { position: { x: 0, y: 0 } })],
    });
    const baseline = useGraphStore.temporal.getState().pastStates.length;

    useGraphStore.getState().onNodeDragStart();
    // Several intermediate position ticks — all visual, all paused.
    // (Snapped to dots as they land; this test is about undo counting.)
    useGraphStore.getState().onNodesChange([
      { id: "a", type: "position", position: { x: 24, y: 24 } },
    ]);
    useGraphStore.getState().onNodesChange([
      { id: "a", type: "position", position: { x: 48, y: 48 } },
    ]);
    useGraphStore.getState().onNodesChange([
      { id: "a", type: "position", position: { x: 96, y: 96 } },
    ]);
    // While active, nothing lands on the stack.
    expect(useGraphStore.temporal.getState().pastStates.length).toBe(baseline);

    useGraphStore.getState().onNodeDragStop();
    // Exactly ONE snapshot — the pre-drag state — regardless of tick count.
    expect(useGraphStore.temporal.getState().pastStates.length).toBe(
      baseline + 1,
    );
    // The snapshot reflects the pre-drag positions.
    const last =
      useGraphStore.temporal.getState().pastStates[
        useGraphStore.temporal.getState().pastStates.length - 1
      ]!;
    expect(last.nodes![0].position).toEqual({ x: 0, y: 0 });
    // The live node reflects the final drag position (96,96 → dot 108,108).
    expect(useGraphStore.getState().nodes[0].position).toEqual({
      x: 108,
      y: 108,
    });
  });

  it("nested onNodeDragStart without an intervening onNodeDragStop does not double-push", () => {
    // begin is idempotent on the paused flag; two begins + one stop = one
    // pastState delta. The second begin's snapshot wins.
    useGraphStore.setState({
      nodes: [makeVertex("a", { position: { x: 0, y: 0 } })],
    });
    const baseline = useGraphStore.temporal.getState().pastStates.length;

    useGraphStore.getState().onNodeDragStart();
    useGraphStore.getState().onNodesChange([
      { id: "a", type: "position", position: { x: 24, y: 24 } },
    ]);
    // Second begin without a stop — captures the current (24,24) state.
    useGraphStore.getState().onNodeDragStart();
    useGraphStore.getState().onNodesChange([
      { id: "a", type: "position", position: { x: 48, y: 48 } },
    ]);
    useGraphStore.getState().onNodeDragStop();

    // Exactly one snapshot pushed (the most recent begin's capture).
    expect(useGraphStore.temporal.getState().pastStates.length).toBe(
      baseline + 1,
    );
    const last =
      useGraphStore.temporal.getState().pastStates[
        useGraphStore.temporal.getState().pastStates.length - 1
      ]!;
    // The snapshot is the second begin's pre-state (36,36) — the first
    // tick {24,24} snapped to the dot at 36 — not the original {0,0}.
    expect(last.nodes![0].position).toEqual({ x: 36, y: 36 });
  });
});

// ---------------------------------------------------------------------------
// Property-edit gesture invariants (module-level
// `vertexPropertyEditGesture` controller).
// ---------------------------------------------------------------------------

describe("property-edit gesture snapshot counting", () => {
  it("one edit gesture with many changes pushes exactly one pastState", () => {
    useGraphStore.setState({ nodes: [makeVertex("a", { rotation: 0 })] });
    const baseline = useGraphStore.temporal.getState().pastStates.length;

    useGraphStore.getState().onVertexPropertyEditStart();
    useGraphStore.getState().updateVertexRotation("a", 10);
    useGraphStore.getState().updateVertexRotation("a", 45);
    useGraphStore.getState().updateVertexRotation("a", 90);
    expect(useGraphStore.temporal.getState().pastStates.length).toBe(baseline);

    useGraphStore.getState().onVertexPropertyEditEnd();
    expect(useGraphStore.temporal.getState().pastStates.length).toBe(
      baseline + 1,
    );
    const last =
      useGraphStore.temporal.getState().pastStates[
        useGraphStore.temporal.getState().pastStates.length - 1
      ]!;
    // Snapshot reflects the pre-edit rotation.
    expect(last.nodes![0].rotation).toBe(0);
    // Live node has the final edit value.
    expect(useGraphStore.getState().nodes[0].rotation).toBe(90);
  });
});

describe("overlapping drag + property-edit gestures", () => {
  it("each gesture pushes its own snapshot even when overlapping (no pause refcount)", () => {
    // drag and property-edit are separate controllers but share one temporal
    // store; pause/resume is a single boolean, not a refcount. So ending the
    // property edit resumes the shared store and pushes its snapshot, and
    // ending the drag pushes its own independent snapshot too. Both land on
    // pastStates — pinned so a refcounting refactor (which would drop one) is
    // caught.
    useGraphStore.setState({
      nodes: [makeVertex("a", { position: { x: 0, y: 0 }, rotation: 0 })],
    });
    const baseline = useGraphStore.temporal.getState().pastStates.length;

    useGraphStore.getState().onNodeDragStart();
    useGraphStore.getState().onNodesChange([
      { id: "a", type: "position", position: { x: 50, y: 50 } },
    ]);

    // Property edit begins mid-drag.
    useGraphStore.getState().onVertexPropertyEditStart();
    useGraphStore.getState().updateVertexRotation("a", 45);

    // End the property edit first — resumes the shared store, pushes its snapshot.
    useGraphStore.getState().onVertexPropertyEditEnd();
    expect(useGraphStore.temporal.getState().pastStates.length).toBe(
      baseline + 1,
    );

    // End the drag — its snapshot is independent, so it pushes too.
    useGraphStore.getState().onNodeDragStop();
    expect(useGraphStore.temporal.getState().pastStates.length).toBe(
      baseline + 2,
    );
  });
});

// ---------------------------------------------------------------------------
// selectAll / clearSelection: no-op calls must NOT push a pastState
// (helpers return the same references, and the zundo equality compares by
// reference). The undo stack stays reserved for real structural changes.
// ---------------------------------------------------------------------------

describe("selectAll / clearSelection undo-stack side effects", () => {

  it("selectAll on a graph with all nodes already selected does NOT push a pastState", () => {
    useGraphStore.setState({
      nodes: [
        makeVertex("a", { selected: true }),
        makeVertex("b", { selected: true }),
      ],
    });
    useGraphStore.temporal.getState().clear();
    expect(useGraphStore.temporal.getState().pastStates.length).toBe(0);

    useGraphStore.getState().selectAll();
    // No-op call — no pastState pushed.
    expect(useGraphStore.temporal.getState().pastStates.length).toBe(0);
    // The state is the same (all already selected).
    expect(useGraphStore.getState().nodes.every((n) => n.selected)).toBe(true);
  });

  it("selectAll on an empty graph does NOT push a pastState", () => {
    useGraphStore.temporal.getState().clear();
    expect(useGraphStore.temporal.getState().pastStates.length).toBe(0);

    useGraphStore.getState().selectAll();
    expect(useGraphStore.temporal.getState().pastStates.length).toBe(0);
    expect(useGraphStore.getState().nodes).toEqual([]);
  });

  it("clearSelection on a graph with no selection does NOT push a pastState", () => {
    useGraphStore.setState({
      nodes: [
        makeVertex("a", { selected: false }),
        makeVertex("b", { selected: false }),
      ],
    });
    useGraphStore.temporal.getState().clear();
    expect(useGraphStore.temporal.getState().pastStates.length).toBe(0);

    useGraphStore.getState().clearSelection();
    expect(useGraphStore.temporal.getState().pastStates.length).toBe(0);
    expect(useGraphStore.getState().nodes.every((n) => !n.selected)).toBe(true);
  });

  it("selectAll on a graph with at least one unselected node DOES push a pastState", () => {
    useGraphStore.setState({
      nodes: [
        makeVertex("a", { selected: true }),
        makeVertex("b", { selected: false }),
      ],
    });
    useGraphStore.temporal.getState().clear();
    expect(useGraphStore.temporal.getState().pastStates.length).toBe(0);

    useGraphStore.getState().selectAll();
    // b flipped to selected → a real change pushes a pastState.
    expect(useGraphStore.temporal.getState().pastStates.length).toBe(1);
    expect(useGraphStore.getState().nodes.every((n) => n.selected)).toBe(true);
  });

  it("clearSelection on a graph with at least one selected node DOES push a pastState", () => {
    useGraphStore.setState({
      nodes: [
        makeVertex("a", { selected: false }),
        makeVertex("b", { selected: true }),
      ],
    });
    useGraphStore.temporal.getState().clear();
    expect(useGraphStore.temporal.getState().pastStates.length).toBe(0);

    useGraphStore.getState().clearSelection();
    // b flipped to unselected → a real change pushes a pastState.
    expect(useGraphStore.temporal.getState().pastStates.length).toBe(1);
    expect(useGraphStore.getState().nodes.every((n) => !n.selected)).toBe(true);
  });
});

describe("UI-only actions do not push a pastState (nodes/edges unchanged)", () => {
  // The zundo equality short-circuits when the partialized slices are
  // reference-equal. UI-only actions (mode, help/confirm dialogs) touch
  // non-partialized fields, so they don't pollute the undo stack.

  it("setMode does not push a pastState (mode is not in the partialized slice)", () => {
    useGraphStore.setState({ nodes: [makeVertex("a")] });
    useGraphStore.temporal.getState().clear();
    expect(useGraphStore.temporal.getState().pastStates.length).toBe(0);

    useGraphStore.getState().setMode("add-vertex");
    expect(useGraphStore.temporal.getState().pastStates.length).toBe(0);
    expect(useGraphStore.getState().mode).toBe("add-vertex");
  });

  it("openConfirmDialogue / closeConfirmDialogue do not push a pastState", () => {
    useGraphStore.setState({ nodes: [makeVertex("a")] });
    useGraphStore.temporal.getState().clear();
    expect(useGraphStore.temporal.getState().pastStates.length).toBe(0);

    useGraphStore.getState().openConfirmDialogue({
      title: "X",
      message: "y",
      onConfirm: () => {},
    });
    expect(useGraphStore.temporal.getState().pastStates.length).toBe(0);

    useGraphStore.getState().closeConfirmDialogue();
    expect(useGraphStore.temporal.getState().pastStates.length).toBe(0);
  });

  it("openHelp / closeHelp do not push a pastState", () => {
    useGraphStore.setState({ nodes: [makeVertex("a")] });
    useGraphStore.temporal.getState().clear();
    expect(useGraphStore.temporal.getState().pastStates.length).toBe(0);

    useGraphStore.getState().openHelp();
    expect(useGraphStore.temporal.getState().pastStates.length).toBe(0);

    useGraphStore.getState().closeHelp();
    expect(useGraphStore.temporal.getState().pastStates.length).toBe(0);
  });

  it("addSelectedToPendingSources does not push a pastState (pendingEdgeSources is not partialized)", () => {
    useGraphStore.setState({
      mode: "add-edge",
      nodes: [makeVertex("a", { selected: true })],
    });
    useGraphStore.temporal.getState().clear();
    expect(useGraphStore.temporal.getState().pastStates.length).toBe(0);

    useGraphStore.getState().addSelectedToPendingSources();
    // No pastState — the partialized slice is unchanged.
    expect(useGraphStore.temporal.getState().pastStates.length).toBe(0);

    expect(useGraphStore.getState().pendingEdgeSources).toEqual(["a"]);
  });
});

// ---------------------------------------------------------------------------
// setMode from add-edge to add-edge (preserves pending + merges selection).
// ---------------------------------------------------------------------------

describe("setMode from add-edge to add-edge", () => {
  it("preserves existing pending sources when re-entering add-edge", () => {
    useGraphStore.setState({
      mode: "add-edge",
      pendingEdgeSources: ["a", "b"],
    });
    useGraphStore.getState().setMode("add-edge");
    expect(useGraphStore.getState().pendingEdgeSources).toEqual(["a", "b"]);
  });

  it("merges the current selection into pending sources on every add-edge switch", () => {
    // Even already in add-edge, setMode("add-edge") re-merges the selection,
    // so a newly-selected node immediately joins pending.
    useGraphStore.setState({
      mode: "add-edge",
      pendingEdgeSources: ["a"],
      nodes: [
        makeVertex("a", { selected: false }),
        makeVertex("b", { selected: true }), // newly selected
      ],
    });
    useGraphStore.getState().setMode("add-edge");
    expect(useGraphStore.getState().pendingEdgeSources.sort()).toEqual([
      "a",
      "b",
    ]);
  });

  it("dedupes when the current selection overlaps pending sources", () => {
    useGraphStore.setState({
      mode: "add-edge",
      pendingEdgeSources: ["a", "b"],
      nodes: [
        makeVertex("a", { selected: true }), // already in pending
        makeVertex("b", { selected: true }), // already in pending
        makeVertex("c", { selected: false }),
      ],
    });
    useGraphStore.getState().setMode("add-edge");
    // Selection is a subset of pending — re-merging is a no-op.
    expect(useGraphStore.getState().pendingEdgeSources.sort()).toEqual([
      "a",
      "b",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Structural changes during an active drag (temporal store is paused).
// ---------------------------------------------------------------------------

describe("structural changes during an active drag", () => {
  // The drag pauses the temporal store; the structural-apply path doesn't
  // resume for its own set(), so a remove during a drag is applied but NOT
  // recorded (it can't be undone). Known limitation, pinned.
  it("a remove during an active drag is applied but NOT recorded on the undo stack", () => {
    useGraphStore.setState({
      nodes: [makeVertex("a"), makeVertex("b")],
    });
    useGraphStore.temporal.getState().clear();
    const baseline = useGraphStore.temporal.getState().pastStates.length;

    useGraphStore.getState().onNodeDragStart();
    useGraphStore
      .getState()
      .onNodesChange([{ id: "a", type: "remove" }]);

    // The remove IS applied (the store reflects it)...
    expect(useGraphStore.getState().nodes.map((n) => n.id)).toEqual(["b"]);
    // ...but NOT recorded (temporal store is paused).
    expect(useGraphStore.temporal.getState().pastStates.length).toBe(baseline);

    // After the drag ends, only the drag's snapshot lands on the stack —
    // the remove is gone for good.
    useGraphStore.getState().onNodeDragStop();
    expect(useGraphStore.temporal.getState().pastStates.length).toBe(
      baseline + 1,
    );
  });
});

// ---------------------------------------------------------------------------
// updateVertex* with NaN / Infinity inputs.
// ---------------------------------------------------------------------------

describe("updateVertexRotation with degenerate inputs", () => {
  it("normalizes NaN to 0", () => {
    useGraphStore.setState({ nodes: [makeVertex("a", { rotation: 45 })] });
    useGraphStore.getState().updateVertexRotation("a", NaN);
    expect(useGraphStore.getState().nodes[0].rotation).toBe(0);
  });

  it("normalizes +Infinity to 0", () => {
    useGraphStore.setState({ nodes: [makeVertex("a", { rotation: 45 })] });
    useGraphStore.getState().updateVertexRotation("a", Infinity);
    expect(useGraphStore.getState().nodes[0].rotation).toBe(0);
  });

  it("normalizes -Infinity to 0", () => {
    useGraphStore.setState({ nodes: [makeVertex("a", { rotation: 45 })] });
    useGraphStore.getState().updateVertexRotation("a", -Infinity);
    expect(useGraphStore.getState().nodes[0].rotation).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// updateVertex* actions on a non-existent node id.
// ---------------------------------------------------------------------------

describe("updateVertex* on a non-existent node id", () => {
  // The .map-based actions return a new array reference even when no node
  // matches; zundo compares references, so a pastState IS pushed — a no-op
  // the user can "undo" to a visually-identical state. Pinned; fixing would
  // require every action to short-circuit on no-change.

  it("updateVertexLabel on a missing id is a silent no-op on node contents", () => {
    useGraphStore.setState({ nodes: [makeVertex("a")] });
    useGraphStore.getState().updateVertexLabel("does-not-exist", "x");
    expect(useGraphStore.getState().nodes).toHaveLength(1);
    expect(useGraphStore.getState().nodes[0].id).toBe("a");
  });

  it("updateVertexType on a missing id is a silent no-op on node contents", () => {
    useGraphStore.setState({ nodes: [makeVertex("a")] });
    useGraphStore.getState().updateVertexType("missing", "x");
    expect(useGraphStore.getState().nodes[0].data.vertexType).toBe("z");
  });

  it("updateVertexRotation on a missing id is a silent no-op on node contents", () => {
    useGraphStore.setState({ nodes: [makeVertex("a", { rotation: 7 })] });
    useGraphStore.getState().updateVertexRotation("missing", 999);
    expect(useGraphStore.getState().nodes[0].rotation).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// updateVertexLabel / updateVertexType boundary inputs.
// ---------------------------------------------------------------------------

describe("updateVertexLabel / updateVertexType input boundaries", () => {
  it("updateVertexLabel accepts an empty string (means phase 0 for spiders)", () => {
    useGraphStore.setState({
      nodes: [makeVertex("a", { data: { label: "pi", vertexType: "z" } })],
    });
    useGraphStore.getState().updateVertexLabel("a", "");
    expect(useGraphStore.getState().nodes[0].data.label).toBe("");
  });

  it("updateVertexType accepts a boundary type ('input') without validation", () => {
    // The action writes whatever VertexType is passed (no validation).
    useGraphStore.setState({ nodes: [makeVertex("a")] });
    useGraphStore.getState().updateVertexType("a", "input");
    expect(useGraphStore.getState().nodes[0].data.vertexType).toBe("input");
  });

  it("updateVertexType accepts a boundary type ('output') without validation", () => {
    useGraphStore.setState({ nodes: [makeVertex("a")] });
    useGraphStore.getState().updateVertexType("a", "output");
    expect(useGraphStore.getState().nodes[0].data.vertexType).toBe("output");
  });
});

// ---------------------------------------------------------------------------
// addVertexAt: selectedVertexType wiring + undo round-trip.
// ---------------------------------------------------------------------------

describe("addVertexAt / selectedVertexType", () => {
  it("uses the currently selected vertex type for the new node", () => {
    useGraphStore.setState({ selectedVertexType: "x" });
    useGraphStore.getState().addVertexAt({ x: 1, y: 2 });
    const nodes = useGraphStore.getState().nodes;
    expect(nodes).toHaveLength(1);
    expect(nodes[0].data.vertexType).toBe("x");
    // Non-aligned positions snap to the dots on creation ({1,2} → {12,12}).
    expect(nodes[0].position).toEqual({ x: 12, y: 12 });
  });

  it("undo after addVertexAt restores the pre-add state", () => {
    useGraphStore.setState({ nodes: [makeVertex("a")] });
    const before = useGraphStore.getState().nodes.map((n) => n.id);

    useGraphStore.getState().addVertexAt({ x: 5, y: 5 });
    expect(useGraphStore.getState().nodes).toHaveLength(2);

    useGraphStore.temporal.getState().undo();
    expect(useGraphStore.getState().nodes.map((n) => n.id)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// deleteSelected edge cascade (multi-edge case).
// ---------------------------------------------------------------------------

describe("deleteSelected cascades to incident edges", () => {
  it("removes a selected node and every edge touching it (multi-edge)", () => {
    useGraphStore.setState({
      nodes: [
        makeVertex("a", { selected: true }),
        makeVertex("b"),
        makeVertex("c"),
        makeVertex("d"),
      ],
      edges: [
        makeEdge("e1", "a", "b"),
        makeEdge("e2", "c", "a"),
        makeEdge("e3", "b", "c"),
      ],
    });
    useGraphStore.getState().deleteSelected();
    const { nodes, edges } = useGraphStore.getState();
    expect(nodes.map((n) => n.id).sort()).toEqual(["b", "c", "d"]);
    // e1 and e2 touched `a` and are gone; e3 (b<->c) survives.
    expect(edges.map((e) => e.id)).toEqual(["e3"]);
  });
});

// ---------------------------------------------------------------------------
// paste: id minting, empty clipboard, offset increment, double-paste.
// ---------------------------------------------------------------------------

describe("paste id and offset behavior", () => {
  it("double-paste mints distinct ids in each batch (no collision)", () => {
    useGraphStore.setState({
      nodes: [makeVertex("a", { selected: true })],
    });
    useGraphStore.getState().copySelected();

    useGraphStore.getState().paste();
    const firstBatchIds = useGraphStore
      .getState()
      .nodes.filter((n) => n.selected)
      .map((n) => n.id);

    // Clear selection on the first batch so the second paste re-selects
    // only the new batch (paste deselects prior nodes).
    useGraphStore.getState().paste();
    const secondBatchIds = useGraphStore
      .getState()
      .nodes.filter((n) => n.selected)
      .map((n) => n.id);

    expect(firstBatchIds).toHaveLength(1);
    expect(secondBatchIds).toHaveLength(1);
    // No collision between batches, and neither is "a".
    expect(secondBatchIds[0]).not.toBe(firstBatchIds[0]);
    expect(firstBatchIds[0]).not.toBe("a");
    expect(secondBatchIds[0]).not.toBe("a");
  });

  it("paste with a null clipboard is a no-op (no crash)", () => {
    useGraphStore.setState({ nodes: [makeVertex("a")], clipboard: null });
    useGraphStore.getState().paste();
    expect(useGraphStore.getState().nodes).toHaveLength(1);
  });

  it("paste with an empty-cliboard nodes array is a no-op (no crash)", () => {
    useGraphStore.setState({
      nodes: [makeVertex("a")],
      clipboard: { nodes: [], edges: [], pasteCount: 0 },
    });
    useGraphStore.getState().paste();
    expect(useGraphStore.getState().nodes).toHaveLength(1);
  });

  it("second paste offsets further than the first (pasteCount drives offset)", () => {
    useGraphStore.setState({
      nodes: [makeVertex("a", { selected: true, position: { x: 0, y: 0 } })],
    });
    useGraphStore.getState().copySelected();

    useGraphStore.getState().paste();
    const firstPos = useGraphStore
      .getState()
      .nodes.filter((n) => n.selected)[0].position;

    // Deselect the first paste so copySelected doesn't re-copy it.
    useGraphStore.getState().clearSelection();
    useGraphStore.getState().paste();
    const secondPos = useGraphStore
      .getState()
      .nodes.filter((n) => n.selected)[0].position;

    // PASTE_OFFSET_STEP is 24; first paste offsets 24, second 48.
    expect(secondPos.x).toBeGreaterThan(firstPos.x);
    expect(secondPos.y).toBeGreaterThan(firstPos.y);
  });
});

// ---------------------------------------------------------------------------
// cutSelected = copy + delete; undo restores everything.
// ---------------------------------------------------------------------------

describe("cutSelected semantics", () => {
  it("cutSelected populates the clipboard AND removes the source", () => {
    useGraphStore.setState({
      nodes: [
        makeVertex("a", { selected: true }),
        makeVertex("b", { selected: true }),
        makeVertex("c"),
      ],
      edges: [makeEdge("e1", "a", "b")],
    });
    useGraphStore.getState().cutSelected();

    const { nodes, clipboard } = useGraphStore.getState();
    expect(nodes.map((n) => n.id)).toEqual(["c"]);
    expect(clipboard?.nodes.map((n) => n.id).sort()).toEqual(["a", "b"]);
    expect(clipboard?.edges).toHaveLength(1);
    expect(clipboard?.pasteCount).toBe(0);
  });

  it("undo after cutSelected restores the removed nodes and edges", () => {
    useGraphStore.setState({
      nodes: [
        makeVertex("a", { selected: true }),
        makeVertex("b"),
      ],
      edges: [makeEdge("e1", "a", "b")],
    });
    useGraphStore.getState().cutSelected();
    expect(useGraphStore.getState().nodes).toHaveLength(1);

    useGraphStore.temporal.getState().undo();
    // Undo rewinds the delete; nodes/edges come back.
    expect(useGraphStore.getState().nodes.map((n) => n.id).sort()).toEqual([
      "a",
      "b",
    ]);
    expect(useGraphStore.getState().edges).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// setMode: add-edge promotion + pendingEdgeSources clearing.
// ---------------------------------------------------------------------------

describe("setMode pendingEdgeSources behavior", () => {
  it("setMode('add-edge') promotes the current selection into pendingEdgeSources", () => {
    useGraphStore.setState({
      nodes: [
        makeVertex("a", { selected: true }),
        makeVertex("b", { selected: true }),
        makeVertex("c"),
      ],
    });
    useGraphStore.getState().setMode("add-edge");
    expect(useGraphStore.getState().pendingEdgeSources.sort()).toEqual([
      "a",
      "b",
    ]);
  });

  it("setMode clears pendingEdgeSources on every non-add-edge switch", () => {
    useGraphStore.setState({ pendingEdgeSources: ["a", "b"], mode: "add-edge" });
    useGraphStore.getState().setMode("add-vertex");
    expect(useGraphStore.getState().pendingEdgeSources).toEqual([]);
  });

  it("setMode to the SAME non-add-edge mode still clears pendingEdgeSources", () => {
    // The clear is unconditional on every switch away from add-edge.
    useGraphStore.setState({ pendingEdgeSources: ["a"], mode: "select" });
    useGraphStore.getState().setMode("select");
    expect(useGraphStore.getState().pendingEdgeSources).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// clearSelection shape preservation.
// ---------------------------------------------------------------------------

describe("clearSelection", () => {
  it("only flips `selected`, never removes nodes or edges", () => {
    useGraphStore.setState({
      nodes: [
        makeVertex("a", { selected: true }),
        makeVertex("b", { selected: true }),
      ],
      edges: [makeEdge("e1", "a", "b")],
    });
    useGraphStore.getState().clearSelection();
    const { nodes, edges } = useGraphStore.getState();
    expect(nodes.map((n) => n.id).sort()).toEqual(["a", "b"]);
    expect(edges.map((e) => e.id)).toEqual(["e1"]);
    expect(nodes.every((n) => !n.selected)).toBe(true);
  });

  it("selectAll then clearSelection round-trips selection", () => {
    useGraphStore.setState({
      nodes: [makeVertex("a"), makeVertex("b")],
      edges: [makeEdge("e1", "a", "b")],
    });
    useGraphStore.getState().selectAll();
    expect(
      useGraphStore.getState().nodes.every((n) => n.selected),
    ).toBe(true);

    useGraphStore.getState().clearSelection();
    expect(
      useGraphStore.getState().nodes.every((n) => !n.selected),
    ).toBe(true);
    expect(
      useGraphStore.getState().edges.every((e) => !e.selected),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// handleVertexClick in select mode is a no-op.
// ---------------------------------------------------------------------------

describe("handleVertexClick in select mode", () => {
  it("is a no-op in 'select' mode (only dispatches in add-edge)", () => {
    useGraphStore.setState({
      mode: "select",
      nodes: [makeVertex("a"), makeVertex("b")],
    });
    useGraphStore
      .getState()
      .handleVertexClick("a", { modifier: false, shift: false });
    expect(useGraphStore.getState().pendingEdgeSources).toEqual([]);
    expect(useGraphStore.getState().edges).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// isStateEmpty after reset.
// ---------------------------------------------------------------------------

describe("isStateEmpty after reset", () => {
  it("returns true immediately after reset()", () => {
    useGraphStore.setState({ nodes: [makeVertex("a"), makeVertex("b")] });
    expect(useGraphStore.getState().isStateEmpty()).toBe(false);
    useGraphStore.getState().reset();
    expect(useGraphStore.getState().isStateEmpty()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// save → hydrate full round-trip.
// ---------------------------------------------------------------------------

describe("save → hydrate round-trip preserves nodes/edges/title", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("preserves title, nodes, edges, and positions across save+hydrate", () => {
    useGraphStore.setState({
      title: "Round Trip",
      createdAt: "2020-03-03T03:03:03.000Z",
      nodes: [
        // Dot-aligned positions so the round-trip is exact.
        makeVertex("a", { position: { x: 12, y: 36 } }),
        makeVertex("b", { position: { x: 36, y: 60 }, rotation: 45 }),
      ],
      edges: [makeEdge("e1", "a", "b")],
    });

    useGraphStore.getState().save();
    // Wipe runtime state to prove hydrate repopulates from disk.
    useGraphStore.setState({ nodes: [], edges: [], title: "Wiped" });

    useGraphStore.getState().hydrate();

    const state = useGraphStore.getState();
    expect(state.title).toBe("Round Trip");
    expect(state.nodes.map((n) => n.id).sort()).toEqual(["a", "b"]);
    const a = state.nodes.find((n) => n.id === "a")!;
    const b = state.nodes.find((n) => n.id === "b")!;
    expect(a.position).toEqual({ x: 12, y: 36 });
    expect(b.position).toEqual({ x: 36, y: 60 });
    expect(b.rotation).toBe(45);
    expect(state.edges).toHaveLength(1);
    expect(state.hasHydrated).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Confirm + help dialog state.
// ---------------------------------------------------------------------------

describe("confirmDialogue open/close", () => {
  it("openConfirmDialogue then closeConfirmDialogue leaves a null state", () => {
    useGraphStore.getState().openConfirmDialogue({
      title: "X",
      message: "y",
      onConfirm: () => {},
    });
    expect(useGraphStore.getState().confirmDialogue).not.toBeNull();
    useGraphStore.getState().closeConfirmDialogue();
    expect(useGraphStore.getState().confirmDialogue).toBeNull();
  });
});

describe("help dialog open/close/toggle", () => {
  it("openHelp sets isHelpOpen true; closeHelp sets it false", () => {
    useGraphStore.getState().openHelp();
    expect(useGraphStore.getState().isHelpOpen).toBe(true);
    useGraphStore.getState().closeHelp();
    expect(useGraphStore.getState().isHelpOpen).toBe(false);
  });

  it("toggleHelp flips the flag both ways", () => {
    expect(useGraphStore.getState().isHelpOpen).toBe(false);
    useGraphStore.getState().toggleHelp();
    expect(useGraphStore.getState().isHelpOpen).toBe(true);
    useGraphStore.getState().toggleHelp();
    expect(useGraphStore.getState().isHelpOpen).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// fitViewNonce on import.
// ---------------------------------------------------------------------------

describe("fitViewNonce increments on import", () => {
  it("importJson bumps fitViewNonce so the view layer refits", async () => {
    useGraphStore.setState({ fitViewNonce: 7 });
    vi.mocked(openTextFileWithPicker).mockResolvedValue(validDocJson());
    await useGraphStore.getState().importJson();
    expect(useGraphStore.getState().fitViewNonce).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// Undo after reset.
// ---------------------------------------------------------------------------

describe("undo after reset", () => {
  it("reset clears history so a subsequent undo is a no-op", () => {
    useGraphStore.getState().addVertexAt({ x: 0, y: 0 });
    useGraphStore.getState().addVertexAt({ x: 10, y: 10 });
    expect(useGraphStore.temporal.getState().pastStates.length).toBeGreaterThan(0);

    useGraphStore.getState().reset();
    const nodesAfterReset = useGraphStore.getState().nodes.length;

    useGraphStore.temporal.getState().undo();
    // State stays empty — nothing to undo back to.
    expect(useGraphStore.getState().nodes.length).toBe(nodesAfterReset);
    expect(useGraphStore.temporal.getState().pastStates.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// temporal limit (zundo `limit: 50` in the store config).
// ---------------------------------------------------------------------------

describe("temporal history limit", () => {
  it("caps pastStates at the configured limit (50)", () => {
    // Each addVertexAt is a tracked change; push past the limit.
    for (let i = 0; i < 60; i++) {
      useGraphStore.getState().addVertexAt({ x: i, y: i });
    }
    expect(useGraphStore.temporal.getState().pastStates.length).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// exportGraph / export dialog state.
// ---------------------------------------------------------------------------

describe("exportGraph / export dialog state", () => {
  it("openExport / closeExport flip the dialog flag", () => {
    expect(useGraphStore.getState().isExportOpen).toBe(false);
    useGraphStore.getState().openExport();
    expect(useGraphStore.getState().isExportOpen).toBe(true);
    useGraphStore.getState().closeExport();
    expect(useGraphStore.getState().isExportOpen).toBe(false);
  });

  it("exportGraph('json') writes a JSON document with the .json extension", async () => {
    useGraphStore.setState({
      title: "Round Trip",
      createdAt: "2025-01-01T00:00:00.000Z",
      nodes: [makeVertex("a", { position: { x: 12, y: 12 } })],
      edges: [],
    });

    await useGraphStore.getState().exportGraph("json");

    const params = vi.mocked(saveTextFileWithPicker).mock.calls[0]?.[0];
    expect(params?.suggestedName).toBe("Round Trip.json");
    expect(params?.extension).toBe(".json");
    expect(params?.mimeType).toBe("application/json");
    const parsed = JSON.parse(params?.contents ?? "") as {
      title: string;
      schemaVersion: number;
      createdAt: string;
    };
    expect(parsed.title).toBe("Round Trip");
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.createdAt).toBe("2025-01-01T00:00:00.000Z");
  });

  it("exportGraph('tikz') writes a placeholder with the .tikz extension", async () => {
    useGraphStore.setState({ title: "Graph A", nodes: [], edges: [] });

    await useGraphStore.getState().exportGraph("tikz");

    const params = vi.mocked(saveTextFileWithPicker).mock.calls[0]?.[0];
    expect(params?.suggestedName).toBe("Graph A.tikz");
    expect(params?.extension).toBe(".tikz");
    expect(params?.contents).toContain("Graph Board TikZ export (placeholder)");
    expect(params?.contents).toContain("Title: Graph A");
  });

  it("exportGraph('zxlive') writes a placeholder with the .zxlive extension", async () => {
    useGraphStore.setState({ title: "Graph B", nodes: [], edges: [] });

    await useGraphStore.getState().exportGraph("zxlive");

    const params = vi.mocked(saveTextFileWithPicker).mock.calls[0]?.[0];
    expect(params?.suggestedName).toBe("Graph B.zxlive");
    expect(params?.extension).toBe(".zxlive");
    expect(params?.contents).toContain("ZXLive export (placeholder)");
  });
});
