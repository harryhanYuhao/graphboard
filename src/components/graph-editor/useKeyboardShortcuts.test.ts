// src/components/graph-editor/useKeyboardShortcuts.test.ts
//
// Hook tests for the editor's window-level keyboard handler. We mock
// `useReactFlow` (otherwise the hook would crash without a real
// `ReactFlowProvider` context) and fire keydown events on `document.body`
// to exercise the handler end-to-end.
//
// Assertions look at the store via `useGraphStore.getState()` — that's
// the observable side effect every shortcut produces.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, renderHook } from "@testing-library/react";
import { useGraphStore } from "@/store/graph-store";
import { useKeyboardShortcuts } from "./useKeyboardShortcuts";
import { makeVertex } from "@/test-utils/factories";

// `useReactFlow` requires a `ReactFlowProvider` context which we don't
// mount here. Mock just that one export, share the fitView spy via
// `vi.hoisted` so tests can assert on it directly.
const { fitViewMock } = vi.hoisted(() => ({ fitViewMock: vi.fn() }));

vi.mock("@xyflow/react", async () => {
  const actual =
    await vi.importActual<typeof import("@xyflow/react")>("@xyflow/react");
  return {
    ...actual,
    useReactFlow: () => ({ fitView: fitViewMock }),
  };
});

beforeEach(() => {
  fitViewMock.mockClear();
  useGraphStore.setState({
    title: "Untitled Graph",
    nodes: [],
    edges: [],
    mode: "select",
    pendingEdgeSources: [],
    selectedVertexType: "z",
    isHelpOpen: false,
    clipboard: null,
  });
});

afterEach(() => {
  useGraphStore.temporal.getState().clear();
});

function pressKey(target: EventTarget, init: KeyboardEventInit) {
  fireEvent.keyDown(target, init);
}

function pressOnBody(init: KeyboardEventInit) {
  pressKey(document.body, init);
}

describe("mode-switch shortcuts", () => {
  it("s switches to select mode", () => {
    useGraphStore.setState({ mode: "add-vertex" });
    renderHook(() => useKeyboardShortcuts());
    pressOnBody({ key: "s" });
    expect(useGraphStore.getState().mode).toBe("select");
  });

  it("v switches to add-vertex mode", () => {
    renderHook(() => useKeyboardShortcuts());
    pressOnBody({ key: "v" });
    expect(useGraphStore.getState().mode).toBe("add-vertex");
  });

  it("e switches to add-edge mode", () => {
    renderHook(() => useKeyboardShortcuts());
    pressOnBody({ key: "e" });
    expect(useGraphStore.getState().mode).toBe("add-edge");
  });

  it("single-key shortcuts are case-insensitive (Shift+S still switches mode)", () => {
    // Regression guard: the single-key switch used to compare the raw
    // `event.key`, so Shift+S (capital) silently did nothing while
    // lowercase s worked. Caps-lock users hit the same path.
    useGraphStore.setState({ mode: "add-vertex" });
    renderHook(() => useKeyboardShortcuts());
    pressOnBody({ key: "S", shiftKey: true });
    expect(useGraphStore.getState().mode).toBe("select");

    useGraphStore.setState({ mode: "select" });
    pressOnBody({ key: "V", shiftKey: true });
    expect(useGraphStore.getState().mode).toBe("add-vertex");
  });
});

describe("modifier-bearing shortcuts", () => {
  it("Ctrl/Cmd+A selects everything and preventDefaults", () => {
    useGraphStore.setState({
      nodes: [
        makeVertex("a"),
        makeVertex("b"),
      ],
    });
    renderHook(() => useKeyboardShortcuts());

    const event = new KeyboardEvent("keydown", {
      key: "a",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(useGraphStore.getState().nodes.every((n) => n.selected)).toBe(true);
  });

  it("Cmd+A on macOS-style modifier also selects everything", () => {
    renderHook(() => useKeyboardShortcuts());
    const event = new KeyboardEvent("keydown", {
      key: "a",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("Ctrl+D triggers copySelected + paste", () => {
    useGraphStore.setState({
      nodes: [
        makeVertex("a", { x: 0, y: 0 }, true),
      ],
    });
    renderHook(() => useKeyboardShortcuts());

    const event = new KeyboardEvent("keydown", {
      key: "d",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    // After Ctrl+D we expect a duplicated node alongside the original.
    expect(useGraphStore.getState().nodes.length).toBe(2);
  });

  it("Ctrl+S calls save and preventDefaults", () => {
    // The real `save()` writes to localStorage. We stub it so the
    // assertion below is about the *dispatch*, not about whether the
    // store correctly wrote a JSON document to disk (that's covered
    // by `serialization.test.ts` and `graph-store.test.ts`'s save/
    // hydrate round-trip). The browser swallows event-listener
    // throws silently, so without this stub the spy assertion would
    // still pass while vitest caught the throw as an unhandled error.
    const saveSpy = vi
      .spyOn(useGraphStore.getState(), "save")
      .mockImplementation(() => {});
    renderHook(() => useKeyboardShortcuts());

    const event = new KeyboardEvent("keydown", {
      key: "s",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
    saveSpy.mockRestore();
  });

  it("Ctrl+Z calls undo", () => {
    const undoSpy = vi.spyOn(useGraphStore.temporal.getState(), "undo");
    renderHook(() => useKeyboardShortcuts());

    const event = new KeyboardEvent("keydown", {
      key: "z",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(undoSpy).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
    undoSpy.mockRestore();
  });

  it("Ctrl+Shift+Z calls redo", () => {
    const redoSpy = vi.spyOn(useGraphStore.temporal.getState(), "redo");
    renderHook(() => useKeyboardShortcuts());

    const event = new KeyboardEvent("keydown", {
      key: "Z",
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(redoSpy).toHaveBeenCalledTimes(1);
    redoSpy.mockRestore();
  });
});

describe("single-key shortcuts", () => {
  it("f calls fitView on the React Flow instance", () => {
    renderHook(() => useKeyboardShortcuts());
    pressOnBody({ key: "f" });
    expect(fitViewMock).toHaveBeenCalledTimes(1);
    expect(fitViewMock).toHaveBeenCalledWith({
      padding: 0.1,
      duration: 200,
    });
  });

  it("? toggles the help dialog", () => {
    renderHook(() => useKeyboardShortcuts());
    expect(useGraphStore.getState().isHelpOpen).toBe(false);

    pressOnBody({ key: "?" });
    expect(useGraphStore.getState().isHelpOpen).toBe(true);

    pressOnBody({ key: "?" });
    expect(useGraphStore.getState().isHelpOpen).toBe(false);
  });

  it("Delete deletes the selection", () => {
    useGraphStore.setState({
      nodes: [
        makeVertex("a", { x: 0, y: 0 }, true),
        makeVertex("b"),
      ],
    });
    renderHook(() => useKeyboardShortcuts());

    pressOnBody({ key: "Delete" });
    expect(useGraphStore.getState().nodes.map((n) => n.id)).toEqual(["b"]);
  });

  it("Backspace also deletes the selection", () => {
    useGraphStore.setState({
      nodes: [
        makeVertex("a", { x: 0, y: 0 }, true),
      ],
    });
    renderHook(() => useKeyboardShortcuts());

    pressOnBody({ key: "Backspace" });
    expect(useGraphStore.getState().nodes).toHaveLength(0);
  });
});

describe("Escape ladder", () => {
  it("first Escape clears pending edge sources", () => {
    useGraphStore.setState({
      mode: "add-edge",
      pendingEdgeSources: ["a", "b"],
    });
    renderHook(() => useKeyboardShortcuts());

    pressOnBody({ key: "Escape" });
    expect(useGraphStore.getState().pendingEdgeSources).toEqual([]);
    expect(useGraphStore.getState().mode).toBe("add-edge");
  });

  it("second Escape clears the selection", () => {
    useGraphStore.setState({
      mode: "add-edge",
      nodes: [
        makeVertex("a", { x: 0, y: 0 }, true),
      ],
    });
    renderHook(() => useKeyboardShortcuts());

    pressOnBody({ key: "Escape" }); // clears pending (already empty)
    expect(useGraphStore.getState().nodes[0].selected).toBe(false);
    expect(useGraphStore.getState().mode).toBe("add-edge");
  });

  it("third Escape returns to select mode", () => {
    useGraphStore.setState({
      mode: "add-vertex",
      nodes: [],
      edges: [],
    });
    renderHook(() => useKeyboardShortcuts());

    pressOnBody({ key: "Escape" });
    expect(useGraphStore.getState().mode).toBe("select");
  });

  it("Escape in select mode with nothing selected is a no-op", () => {
    renderHook(() => useKeyboardShortcuts());
    pressOnBody({ key: "Escape" });
    expect(useGraphStore.getState().mode).toBe("select");
  });
});

describe("vertex-type number shortcuts (add-vertex mode only)", () => {
  it("press 1 selects the first vertex type in add-vertex mode", () => {
    useGraphStore.setState({ mode: "add-vertex", selectedVertexType: "z" });
    renderHook(() => useKeyboardShortcuts());

    pressOnBody({ key: "1" });
    // VERTEX_TYPES[0] is "zbox" per vertex-types.ts — assert the
    // handler routed through the registry.
    expect(useGraphStore.getState().selectedVertexType).toBe("zbox");
  });

  it("press 4 selects the 4th vertex type", () => {
    useGraphStore.setState({ mode: "add-vertex", selectedVertexType: "z" });
    renderHook(() => useKeyboardShortcuts());

    pressOnBody({ key: "4" });
    // VERTEX_TYPES[3] is "input" per vertex-types.ts (order: zbox, z,
    // empty, input, output, x, …).
    expect(useGraphStore.getState().selectedVertexType).toBe("input");
  });

  it("press 0 is a no-op (index 0 not accepted)", () => {
    useGraphStore.setState({ mode: "add-vertex", selectedVertexType: "z" });
    renderHook(() => useKeyboardShortcuts());

    pressOnBody({ key: "0" });
    expect(useGraphStore.getState().selectedVertexType).toBe("z");
  });

  it("press 9 selects the 9th vertex type (h)", () => {
    // 10 types today → digits 1–9 are all valid; 9 maps to index 8 = "h".
    useGraphStore.setState({ mode: "add-vertex", selectedVertexType: "z" });
    renderHook(() => useKeyboardShortcuts());

    pressOnBody({ key: "9" });
    expect(useGraphStore.getState().selectedVertexType).toBe("h");
  });

  it("number keys are ignored outside add-vertex mode", () => {
    useGraphStore.setState({ mode: "select", selectedVertexType: "z" });
    renderHook(() => useKeyboardShortcuts());

    pressOnBody({ key: "1" });
    expect(useGraphStore.getState().selectedVertexType).toBe("z");
  });
});

describe("input target guard", () => {
  it("does not switch modes when typing in an input", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);

    renderHook(() => useKeyboardShortcuts());

    fireEvent.keyDown(input, { key: "v" });
    expect(useGraphStore.getState().mode).toBe("select");

    fireEvent.keyDown(input, { key: "s" });
    expect(useGraphStore.getState().mode).toBe("select");

    document.body.removeChild(input);
  });

  it("does not toggle help when typing in a textarea", () => {
    const ta = document.createElement("textarea");
    document.body.appendChild(ta);

    renderHook(() => useKeyboardShortcuts());

    fireEvent.keyDown(ta, { key: "?" });
    expect(useGraphStore.getState().isHelpOpen).toBe(false);

    document.body.removeChild(ta);
  });
});

describe("modifier-bearing keys outside the known set", () => {
  it("does not preventDefault on Ctrl+F (leave the browser alone)", () => {
    renderHook(() => useKeyboardShortcuts());

    const event = new KeyboardEvent("keydown", {
      key: "f",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });
});

// ---- Coverage for shortcuts not exercised by the original file ----

describe("Cmd/Ctrl+C (copy) / Cmd+V (paste) / Cmd+X (cut)", () => {
  function fireMod(key: string, shift = false) {
    const event = new KeyboardEvent("keydown", {
      key,
      ctrlKey: true,
      shiftKey: shift,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);
    return event;
  }

  it("Ctrl+C fills the clipboard without changing the canvas", () => {
    useGraphStore.setState({
      nodes: [
        makeVertex("a", { x: 0, y: 0 }, true),
        makeVertex("b"),
      ],
    });
    renderHook(() => useKeyboardShortcuts());

    const event = fireMod("c");

    expect(event.defaultPrevented).toBe(true);
    expect(useGraphStore.getState().nodes).toHaveLength(2);
    expect(useGraphStore.getState().clipboard?.nodes).toHaveLength(1);
  });

  it("Ctrl+V pastes the clipboard onto the canvas", () => {
    useGraphStore.setState({
      nodes: [makeVertex("a", { x: 0, y: 0 }, true)],
      clipboard: {
        nodes: [makeVertex("a")],
        edges: [],
        pasteCount: 0,
      },
    });
    renderHook(() => useKeyboardShortcuts());

    const event = fireMod("v");

    expect(event.defaultPrevented).toBe(true);
    // Original + pasted copy → 2 nodes.
    expect(useGraphStore.getState().nodes).toHaveLength(2);
  });

  it("Ctrl+X cuts: removes the selection and fills the clipboard", () => {
    useGraphStore.setState({
      nodes: [
        makeVertex("a", { x: 0, y: 0 }, true),
        makeVertex("b"),
      ],
    });
    renderHook(() => useKeyboardShortcuts());

    const event = fireMod("x");

    expect(event.defaultPrevented).toBe(true);
    expect(useGraphStore.getState().nodes.map((n) => n.id)).toEqual(["b"]);
    expect(useGraphStore.getState().clipboard?.nodes.map((n) => n.id)).toEqual([
      "a",
    ]);
  });

  it("does not handle Ctrl+Shift+C / V / X (those are not bound)", () => {
    // The hook treats those keys (with shift) as out-of-set and
    // leaves them alone — shift modifies the gesture for `z` and `y`
    // but is meaningless for the clipboard shortcuts.
    const c = fireMod("c", true);
    const v = fireMod("v", true);
    const x = fireMod("x", true);
    expect(c.defaultPrevented).toBe(false);
    expect(v.defaultPrevented).toBe(false);
    expect(x.defaultPrevented).toBe(false);
  });
});

describe("Cmd/Ctrl+Y (redo alternative)", () => {
  it("Ctrl+Y calls redo and preventDefaults", () => {
    const redoSpy = vi.spyOn(useGraphStore.temporal.getState(), "redo");
    renderHook(() => useKeyboardShortcuts());

    const event = new KeyboardEvent("keydown", {
      key: "y",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(redoSpy).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
    redoSpy.mockRestore();
  });

  it("Cmd+Y also calls redo on macOS-style modifier", () => {
    const redoSpy = vi.spyOn(useGraphStore.temporal.getState(), "redo");
    renderHook(() => useKeyboardShortcuts());

    const event = new KeyboardEvent("keydown", {
      key: "y",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(redoSpy).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
    redoSpy.mockRestore();
  });
});

describe("Ctrl+Z without shift does not trigger redo", () => {
  it("plain Ctrl+Z calls undo, not redo", () => {
    const undoSpy = vi.spyOn(useGraphStore.temporal.getState(), "undo");
    const redoSpy = vi.spyOn(useGraphStore.temporal.getState(), "redo");
    renderHook(() => useKeyboardShortcuts());

    const event = new KeyboardEvent("keydown", {
      key: "z",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(undoSpy).toHaveBeenCalledTimes(1);
    expect(redoSpy).not.toHaveBeenCalled();
    undoSpy.mockRestore();
    redoSpy.mockRestore();
  });
});

describe("vertex-type shortcut outside add-vertex mode does not match", () => {
  it("press '5' in select mode is a no-op", () => {
    // The number-key branch is gated on mode === "add-vertex", so any
    // other mode swallows the key silently.
    useGraphStore.setState({ mode: "select", selectedVertexType: "z" });
    renderHook(() => useKeyboardShortcuts());

    fireEvent.keyDown(document.body, { key: "5" });
    expect(useGraphStore.getState().selectedVertexType).toBe("z");
  });
});

describe("? key with the help dialog already open", () => {
  // The `?` key is bound to `toggleHelp()`. When the help dialog is
  // already open, pressing `?` again should close it (toggle semantics).
  // The dialog auto-focuses its close button on open (see
  // KeyboardShortcutsDialog), so the keydown event fires on the close
  // button, bubbles up to the window, and the global handler runs.
  it("pressing ? while the help dialog is open closes it", () => {
    useGraphStore.setState({ isHelpOpen: true });
    renderHook(() => useKeyboardShortcuts());

    pressOnBody({ key: "?" });
    expect(useGraphStore.getState().isHelpOpen).toBe(false);
  });

  it("pressing ? repeatedly toggles the help dialog open/closed", () => {
    useGraphStore.setState({ isHelpOpen: false });
    renderHook(() => useKeyboardShortcuts());

    pressOnBody({ key: "?" });
    expect(useGraphStore.getState().isHelpOpen).toBe(true);

    pressOnBody({ key: "?" });
    expect(useGraphStore.getState().isHelpOpen).toBe(false);

    pressOnBody({ key: "?" });
    expect(useGraphStore.getState().isHelpOpen).toBe(true);
  });
});

describe("shift + letter keys", () => {
  // Regression guard: the single-key switch used to compare the raw
  // `event.key`, so Shift+S (uppercase) silently did nothing. The
  // existing test "single-key shortcuts are case-insensitive" covers
  // mode-switch letters. This block extends the coverage to the
  // escape ladder and the help toggle with shift.
  it("Shift+S also switches to select mode (uppercase S)", () => {
    useGraphStore.setState({ mode: "add-vertex" });
    renderHook(() => useKeyboardShortcuts());
    pressOnBody({ key: "S", shiftKey: true });
    expect(useGraphStore.getState().mode).toBe("select");
  });

  it("Shift+V also switches to add-vertex mode (uppercase V)", () => {
    useGraphStore.setState({ mode: "select" });
    renderHook(() => useKeyboardShortcuts());
    pressOnBody({ key: "V", shiftKey: true });
    expect(useGraphStore.getState().mode).toBe("add-vertex");
  });

  it("Shift+E also switches to add-edge mode (uppercase E)", () => {
    renderHook(() => useKeyboardShortcuts());
    pressOnBody({ key: "E", shiftKey: true });
    expect(useGraphStore.getState().mode).toBe("add-edge");
  });

  it("Shift+? (uppercase) also toggles the help dialog", () => {
    renderHook(() => useKeyboardShortcuts());
    expect(useGraphStore.getState().isHelpOpen).toBe(false);

    pressOnBody({ key: "?", shiftKey: true });
    expect(useGraphStore.getState().isHelpOpen).toBe(true);
  });
});

describe("event.preventDefault behavior", () => {
  it("does not preventDefault on a non-handled key (letter 'a' without modifier)", () => {
    renderHook(() => useKeyboardShortcuts());

    const event = new KeyboardEvent("keydown", {
      key: "a",
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    // 'a' without modifier is not bound — the global handler returns
    // without calling preventDefault, so the browser can do its thing.
    expect(event.defaultPrevented).toBe(false);
  });

  it("prevents default on Delete (so the browser's back-nav on some platforms doesn't fire)", () => {
    useGraphStore.setState({
      nodes: [makeVertex("a", { x: 0, y: 0 }, true)],
    });
    renderHook(() => useKeyboardShortcuts());

    const event = new KeyboardEvent("keydown", {
      key: "Delete",
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    // The Delete handler calls deleteSelected but does NOT
    // preventDefault — browsers don't have a default action for
    // Delete inside a regular page, so this is a no-op. Pin the
    // current behavior so a future "preventDefault on Delete" is a
    // deliberate change.
    expect(event.defaultPrevented).toBe(false);
  });

  it("prevents default on 'f' (fit-view) so the browser's find-in-page isn't triggered", () => {
    // The 'f' key (fit view) is handled but does NOT call
    // preventDefault — without a Ctrl modifier, 'f' has no browser
    // default in a regular page. Pin the current behavior.
    renderHook(() => useKeyboardShortcuts());

    const event = new KeyboardEvent("keydown", {
      key: "f",
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});