// src/store/graph-store_edge_cases.test.ts
//
// Edge-case probing for the Zustand graph store. Each test pins ONE
// behavior of an action or the undo/redo (zundo temporal) machinery.
// Suspected-bug tests are written asserting the CORRECT contract and
// then `it.skip(...)` with a comment citing the violated contract —
// they are NOT fixed here (parent agent owns the diff).
//
// Conventions mirror `graph-store.test.ts` exactly: hit the store
// directly via `useGraphStore.setState` / `getState`, reset to a known
// baseline in `beforeEach`, and clear the temporal stack so undo
// snapshots from a prior test can't leak in.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { useGraphStore } from "./graph-store";
import { makeVertexWith as makeVertex, makeEdge } from "@/test-utils/factories";

// `importJson` reaches into `@/lib/download`'s `openTextFileWithPicker`.
// We mock the whole module so the test can hand it a canned JSON string
// without touching the real File System Access API (jsdom doesn't
// implement it anyway). The mock is hoisted by vitest; `vi.mocked`
// lets each test program the return value.
vi.mock("@/lib/download", () => ({
  openTextFileWithPicker: vi.fn(),
  saveTextFileWithPicker: vi.fn(),
}));

import { openTextFileWithPicker } from "@/lib/download";

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
    clipboard: null,
    fitViewNonce: 0,
  });
  // Clear the temporal (undo/redo) stack so prior tests don't pollute
  // future ones via undo snapshots.
  useGraphStore.temporal.getState().clear();
  // Reset the picker mock's call history between tests.
  vi.mocked(openTextFileWithPicker).mockReset();
}

beforeEach(resetStore);

// Helper: a minimal valid v1 document JSON string the import path will
// accept (passes `parseDocument` in serialization.ts).
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
// BUG #1 (CONFIRMED): importJson does not clear the undo stack.
// AGENTS.md §"Architecture rules" (lines 84-86) says: "`hydrate`,
// `importGraphJson`, and `clear` call temporal.getState().clear() so a
// new document doesn't carry the old undo history." `hydrate` and
// `reset` honor this; `importJson`'s `applyImport` (graph-store.ts
// :532-549) does NOT.
// ---------------------------------------------------------------------------

describe("undo history lifecycle on document replacement", () => {
  it("reset() clears the undo stack (positive control)", () => {
    // Build up some undo history.
    useGraphStore.getState().addVertexAt({ x: 0, y: 0 });
    useGraphStore.getState().addVertexAt({ x: 10, y: 10 });
    expect(useGraphStore.temporal.getState().pastStates.length).toBeGreaterThan(0);

    useGraphStore.getState().reset();
    expect(useGraphStore.temporal.getState().pastStates.length).toBe(0);
  });

  it("hydrate() clears the undo stack (positive control)", () => {
    localStorage.clear();
    // Seed some undo history first.
    useGraphStore.getState().addVertexAt({ x: 0, y: 0 });
    expect(useGraphStore.temporal.getState().pastStates.length).toBeGreaterThan(0);

    // Seed localStorage with a doc hydrate will load.
    localStorage.setItem("graph-board-document", validDocJson());
    useGraphStore.getState().hydrate();
    expect(useGraphStore.temporal.getState().pastStates.length).toBe(0);
  });

  // BUG: importJson doesn't clear temporal — AGENTS.md contract violation.
  // AGENTS.md §"Architecture rules" promises that importGraphJson (alongside
  // hydrate and clear) calls temporal.getState().clear() so a new document
  // doesn't carry the old undo history. `applyImport` now does this
  // (graph-store.ts), matching hydrate/reset. Pin the contract.
  it("importJson clears the undo stack after a successful import", async () => {
    // Seed some undo history on the current doc so there's something
    // that should be cleared.
    useGraphStore.getState().addVertexAt({ x: 0, y: 0 });
    useGraphStore.getState().addVertexAt({ x: 10, y: 10 });
    expect(useGraphStore.temporal.getState().pastStates.length).toBeGreaterThan(0);

    vi.mocked(openTextFileWithPicker).mockResolvedValue(validDocJson());
    await useGraphStore.getState().importJson();

    // The canvas was non-empty, so importJson opened the confirm dialog
    // rather than applying directly. Simulate the user clicking "Import"
    // — that's the production path that actually runs applyImport.
    const dialogue = useGraphStore.getState().confirmDialogue;
    expect(dialogue).not.toBeNull();
    dialogue!.onConfirm();

    expect(useGraphStore.temporal.getState().pastStates.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// updateVertexRotation normalization.
// `normalizeRotation` (serialization.ts:44-50) wraps to [0,360) and rounds
// float drift. The store action now applies it at the boundary so every
// caller gets the canonical value — previously only VertexPropertyPanel
// normalized, leaving direct store callers writing un-normalized values.
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
    useGraphStore.getState().onNodesChange([
      { id: "a", type: "position", position: { x: 5, y: 5 } },
    ]);
    useGraphStore.getState().onNodesChange([
      { id: "a", type: "position", position: { x: 50, y: 50 } },
    ]);
    useGraphStore.getState().onNodesChange([
      { id: "a", type: "position", position: { x: 100, y: 100 } },
    ]);
    // While the drag is active, nothing should have landed on the stack.
    expect(useGraphStore.temporal.getState().pastStates.length).toBe(baseline);

    useGraphStore.getState().onNodeDragStop();
    // Exactly ONE snapshot — the pre-drag state — regardless of tick count.
    expect(useGraphStore.temporal.getState().pastStates.length).toBe(
      baseline + 1,
    );
    // The snapshot should reflect the PRE-drag positions.
    const last =
      useGraphStore.temporal.getState().pastStates[
        useGraphStore.temporal.getState().pastStates.length - 1
      ]!;
    expect(last.nodes![0].position).toEqual({ x: 0, y: 0 });
    // And the live node reflects the final drag position.
    expect(useGraphStore.getState().nodes[0].position).toEqual({
      x: 100,
      y: 100,
    });
  });

  it("nested onNodeDragStart without an intervening onNodeDragStop does not double-push", () => {
    // The module-level `dragGesture` only stashes one snapshot; calling
    // begin twice overwrites the snapshot but does not resume+re-pause
    // (begin is idempotent on the paused flag). Pin the current
    // invariant: two begins + one stop = exactly one pastState delta.
    useGraphStore.setState({
      nodes: [makeVertex("a", { position: { x: 0, y: 0 } })],
    });
    const baseline = useGraphStore.temporal.getState().pastStates.length;

    useGraphStore.getState().onNodeDragStart();
    useGraphStore.getState().onNodesChange([
      { id: "a", type: "position", position: { x: 10, y: 10 } },
    ]);
    // Second begin WITHOUT a stop — the snapshot captured here is the
    // state AFTER the first begin's paused change (position 10,10).
    useGraphStore.getState().onNodeDragStart();
    useGraphStore.getState().onNodesChange([
      { id: "a", type: "position", position: { x: 20, y: 20 } },
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
    // The captured snapshot is the second begin's pre-state (10,10),
    // NOT the original (0,0) — this pins the "second begin wins" behavior.
    expect(last.nodes![0].position).toEqual({ x: 10, y: 10 });
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
    // Snapshot reflects the PRE-edit rotation.
    expect(last.nodes![0].rotation).toBe(0);
    // Live node has the final edit value.
    expect(useGraphStore.getState().nodes[0].rotation).toBe(90);
  });
});

describe("overlapping drag + property-edit gestures", () => {
  it("each gesture pushes its own snapshot even when overlapping (no pause refcount)", () => {
    // `dragGesture` and `vertexPropertyEditGesture` are SEPARATE
    // module-level controllers — each owns its own `snapshot` closure.
    // They share the SAME underlying temporal store, but pause/resume is
    // a single boolean on that store, NOT a refcount. So:
    //   - drag begin pauses + captures snapshot A (pre-drag nodes)
    //   - property-edit begin (idempotent pause) captures snapshot B
    //     (current live nodes, post-drag-tick)
    //   - property-edit end RESUMES the store and pushes snapshot B
    //   - drag end resumes again (already resumed, no-op) and pushes
    //     snapshot A
    // Net result: BOTH snapshots land on pastStates. Pin this so a
    // future refactor that ref-counts pauses (and would drop one) is
    // caught. It also surfaces a subtle issue: between the property-edit
    // end and the drag end, the store is UN-paused, so any visual
    // change in that window WOULD be tracked — there's no test for that
    // window here, but the double-push is the observable symptom.
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

    // End the property edit first — this RESUMES the (shared) temporal
    // store and pushes the property-edit snapshot.
    useGraphStore.getState().onVertexPropertyEditEnd();
    expect(useGraphStore.temporal.getState().pastStates.length).toBe(
      baseline + 1,
    );

    // Now end the drag — the drag's snapshot is INDEPENDENT of the
    // property-edit's, so it ALSO pushes.
    useGraphStore.getState().onNodeDragStop();
    expect(useGraphStore.temporal.getState().pastStates.length).toBe(
      baseline + 2,
    );
  });
});

// ---------------------------------------------------------------------------
// selectAll / clearSelection: no-op calls should NOT push a pastState
// (fixed via helper optimization + zundo `equality` function).
// ---------------------------------------------------------------------------

describe("selectAll / clearSelection undo-stack side effects", () => {
  // The helpers (`selectAllElements` / `clearAllSelections`) detect the
  // "nothing changed" case and return the original array references
  // unchanged. Combined with the zundo `equality` function (which
  // compares the partialized slices by reference), no pastState is
  // pushed when the call is a no-op. The undo stack stays reserved
  // for real graph-structure changes.

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
    // No-op call — the helper returns the same array references, the
    // zundo equality short-circuits the pastState push.
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
    // b changed from selected:false → selected:true, so a pastState
    // is pushed (the call was a real change).
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
    // b changed from selected:true → selected:false, so a pastState
    // is pushed.
    expect(useGraphStore.temporal.getState().pastStates.length).toBe(1);
    expect(useGraphStore.getState().nodes.every((n) => !n.selected)).toBe(true);
  });
});

describe("UI-only actions do not push a pastState (nodes/edges unchanged)", () => {
  // The zundo `equality` function short-circuits the pastState push
  // when the partialized slices (nodes / edges) are reference-equal.
  // UI-only actions (mode, help dialog, confirm dialog) only touch
  // non-partialized fields, so they should not pollute the undo stack.

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
    // Even when already in add-edge, setMode("add-edge") re-merges the
    // current selection. This means a newly-selected node immediately
    // joins the pending list (no need to call addSelectedToPendingSources
    // explicitly).
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
    // The selection is a subset of pending — re-merging is a no-op.
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
  // The drag pauses the temporal store so intermediate position ticks
  // don't land on the undo stack. The structural-apply path in
  // `applyReactiveFlowChanges` does NOT resume for its own set(), so
  // a remove during a drag is applied but NOT recorded — it cannot be
  // undone. This is a known limitation; pin the current behavior so a
  // future refactor that ref-counts pauses (and would change the
  // recording semantics) is a deliberate change.
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

    // The remove IS applied (the store reflects it).
    expect(useGraphStore.getState().nodes.map((n) => n.id)).toEqual(["b"]);
    // ...but it is NOT recorded (temporal store is paused).
    expect(useGraphStore.temporal.getState().pastStates.length).toBe(baseline);

    // After the drag ends, only the drag's own snapshot lands on the
    // stack — the remove is gone for good from the user's perspective.
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
  // The .map-based actions always return a new array reference, even
  // when no node matches. The zundo `equality` function compares
  // references, so the partialized slice IS different and a pastState
  // IS pushed. This is a no-op the user can "undo" to a visually-
  // identical state. Pinned as current behavior — fixing it would
  // require every action to short-circuit on no-change, which is more
  // invasive than the value.

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
    // The action does not validate — it writes whatever VertexType is
    // passed. Pin current behavior: 'input' lands in state untouched.
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
    expect(nodes[0].position).toEqual({ x: 1, y: 2 });
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

    // Clear selection on the first paste batch so the second paste
    // re-selects only the new batch (paste deselects prior nodes).
    useGraphStore.getState().paste();
    const secondBatchIds = useGraphStore
      .getState()
      .nodes.filter((n) => n.selected)
      .map((n) => n.id);

    expect(firstBatchIds).toHaveLength(1);
    expect(secondBatchIds).toHaveLength(1);
    // No id collision between the two batches, and neither is "a".
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

    // PASTE_OFFSET_STEP is 24; first paste offsets by 24, second by 48.
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
    // Undo rewinds the structural delete; nodes/edges come back.
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
    // Pin: the clear is unconditional on every switch away from add-edge,
    // even if `mode` is already the target.
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
        makeVertex("a", { position: { x: 10, y: 20 } }),
        makeVertex("b", { position: { x: 30, y: 40 }, rotation: 45 }),
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
    expect(a.position).toEqual({ x: 10, y: 20 });
    expect(b.position).toEqual({ x: 30, y: 40 });
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
    // State stays empty — there's nothing to undo back to.
    expect(useGraphStore.getState().nodes.length).toBe(nodesAfterReset);
    expect(useGraphStore.temporal.getState().pastStates.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// temporal limit (zundo `limit: 50` in the store config).
// ---------------------------------------------------------------------------

describe("temporal history limit", () => {
  it("caps pastStates at the configured limit (50)", () => {
    // Push well past the limit. Each addVertexAt is a tracked
    // structural change, so it lands one entry on pastStates.
    for (let i = 0; i < 60; i++) {
      useGraphStore.getState().addVertexAt({ x: i, y: i });
    }
    expect(useGraphStore.temporal.getState().pastStates.length).toBe(50);
  });
});
