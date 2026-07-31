// Hook tests for the editor's window-level keyboard handler. `useReactFlow` is
// mocked (the hook would crash without a ReactFlowProvider context); keydown is
// fired on `document.body`. Assertions read the store via `getState()` — the
// observable side effect of every shortcut.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, renderHook } from "@testing-library/react";
import { useGraphStore } from "@/store/graph-store";
import { useKeyboardShortcuts } from "./useKeyboardShortcuts";
import { makeVertex } from "@/test-utils/factories";

// `useReactFlow` needs a ReactFlowProvider we don't mount; mock just that
// export and share the fitView/onCompute spies via `vi.hoisted`.
const { fitViewMock, onComputeMock } = vi.hoisted(() => ({
  fitViewMock: vi.fn(),
  onComputeMock: vi.fn(),
}));

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
  onComputeMock.mockClear();
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

// The hook takes an `onCompute` callback (compute orchestration lives in
// `useCompute`, outside the store). Funnel every mount through one helper.
function renderShortcuts() {
  return renderHook(() =>
    useKeyboardShortcuts({ onCompute: onComputeMock }),
  );
}

function pressKey(target: EventTarget, init: KeyboardEventInit) {
  fireEvent.keyDown(target, init);
}

function pressOnBody(init: KeyboardEventInit) {
  pressKey(document.body, init);
}

describe("mode-switch shortcuts", () => {
  it("s switches to select mode", () => {
    useGraphStore.setState({ mode: "add-vertex" });
    renderShortcuts();
    pressOnBody({ key: "s" });
    expect(useGraphStore.getState().mode).toBe("select");
  });

  it("v switches to add-vertex mode", () => {
    renderShortcuts();
    pressOnBody({ key: "v" });
    expect(useGraphStore.getState().mode).toBe("add-vertex");
  });

  it("e switches to add-edge mode", () => {
    renderShortcuts();
    pressOnBody({ key: "e" });
    expect(useGraphStore.getState().mode).toBe("add-edge");
  });

  it("single-key shortcuts are case-insensitive (Shift+S still switches mode)", () => {
    // Caps-lock users produce capital letters; the switch must treat them
    // like lowercase.
    useGraphStore.setState({ mode: "add-vertex" });
    renderShortcuts();
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
    renderShortcuts();

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
    renderShortcuts();
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
    renderShortcuts();

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
    // Stub `save()` so this asserts the dispatch, not the disk write (the
    // round-trip is covered in serialization/graph-store tests). Without the
    // stub the listener throw is swallowed but surfaces as an unhandled error.
    const saveSpy = vi
      .spyOn(useGraphStore.getState(), "save")
      .mockImplementation(() => {});
    renderShortcuts();

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
    renderShortcuts();

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
    renderShortcuts();

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
    renderShortcuts();
    pressOnBody({ key: "f" });
    expect(fitViewMock).toHaveBeenCalledTimes(1);
    expect(fitViewMock).toHaveBeenCalledWith({
      padding: 0.1,
      duration: 200,
    });
  });

  it("? toggles the help dialog", () => {
    renderShortcuts();
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
    renderShortcuts();

    pressOnBody({ key: "Delete" });
    expect(useGraphStore.getState().nodes.map((n) => n.id)).toEqual(["b"]);
  });

  it("Backspace also deletes the selection", () => {
    useGraphStore.setState({
      nodes: [
        makeVertex("a", { x: 0, y: 0 }, true),
      ],
    });
    renderShortcuts();

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
    renderShortcuts();

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
    renderShortcuts();

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
    renderShortcuts();

    pressOnBody({ key: "Escape" });
    expect(useGraphStore.getState().mode).toBe("select");
  });

  it("Escape in select mode with nothing selected is a no-op", () => {
    renderShortcuts();
    pressOnBody({ key: "Escape" });
    expect(useGraphStore.getState().mode).toBe("select");
  });
});

describe("vertex-type number shortcuts (add-vertex mode only)", () => {
  it("press 1 selects the first vertex type in add-vertex mode", () => {
    useGraphStore.setState({ mode: "add-vertex", selectedVertexType: "z" });
    renderShortcuts();

    pressOnBody({ key: "1" });
    // VERTEX_TYPES[0] is "zbox" — routed through the registry.
    expect(useGraphStore.getState().selectedVertexType).toBe("zbox");
  });

  it("press 4 selects the 4th vertex type", () => {
    useGraphStore.setState({ mode: "add-vertex", selectedVertexType: "z" });
    renderShortcuts();

    pressOnBody({ key: "4" });
    // VERTEX_TYPES[3] is "input" (order: zbox, z, empty, input, output, x, …).
    expect(useGraphStore.getState().selectedVertexType).toBe("input");
  });

  it("press 0 is a no-op (index 0 not accepted)", () => {
    useGraphStore.setState({ mode: "add-vertex", selectedVertexType: "z" });
    renderShortcuts();

    pressOnBody({ key: "0" });
    expect(useGraphStore.getState().selectedVertexType).toBe("z");
  });

  it("press 9 selects the 9th vertex type (h)", () => {
    // 10 types today → digits 1–9 are valid; 9 maps to index 8 = "h".
    useGraphStore.setState({ mode: "add-vertex", selectedVertexType: "z" });
    renderShortcuts();

    pressOnBody({ key: "9" });
    expect(useGraphStore.getState().selectedVertexType).toBe("h");
  });

  it("number keys are ignored outside add-vertex mode", () => {
    useGraphStore.setState({ mode: "select", selectedVertexType: "z" });
    renderShortcuts();

    pressOnBody({ key: "1" });
    expect(useGraphStore.getState().selectedVertexType).toBe("z");
  });
});

describe("input target guard", () => {
  it("does not switch modes when typing in an input", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);

    renderShortcuts();

    fireEvent.keyDown(input, { key: "v" });
    expect(useGraphStore.getState().mode).toBe("select");

    fireEvent.keyDown(input, { key: "s" });
    expect(useGraphStore.getState().mode).toBe("select");

    document.body.removeChild(input);
  });

  it("does not toggle help when typing in a textarea", () => {
    const ta = document.createElement("textarea");
    document.body.appendChild(ta);

    renderShortcuts();

    fireEvent.keyDown(ta, { key: "?" });
    expect(useGraphStore.getState().isHelpOpen).toBe(false);

    document.body.removeChild(ta);
  });
});

describe("modifier-bearing keys outside the known set", () => {
  it("does not preventDefault on Ctrl+F (leave the browser alone)", () => {
    renderShortcuts();

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
    renderShortcuts();

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
    renderShortcuts();

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
    renderShortcuts();

    const event = fireMod("x");

    expect(event.defaultPrevented).toBe(true);
    expect(useGraphStore.getState().nodes.map((n) => n.id)).toEqual(["b"]);
    expect(useGraphStore.getState().clipboard?.nodes.map((n) => n.id)).toEqual([
      "a",
    ]);
  });

  it("does not handle Ctrl+Shift+C / V / X (those are not bound)", () => {
    // Shift is meaningful for z/y but not the clipboard shortcuts.
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
    renderShortcuts();

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
    renderShortcuts();

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

  it("Ctrl+Enter calls onCompute and preventDefaults", () => {
    // Compute orchestration lives in `useCompute`; the hook reaches it via
    // `onCompute`. Assert the spy fired and default was suppressed.
    renderShortcuts();

    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(onComputeMock).toHaveBeenCalledTimes(1);
  });

  it("Cmd+Enter also calls onCompute on macOS-style modifier", () => {
    renderShortcuts();

    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(onComputeMock).toHaveBeenCalledTimes(1);
  });
});

describe("Ctrl+Z without shift does not trigger redo", () => {
  it("plain Ctrl+Z calls undo, not redo", () => {
    const undoSpy = vi.spyOn(useGraphStore.temporal.getState(), "undo");
    const redoSpy = vi.spyOn(useGraphStore.temporal.getState(), "redo");
    renderShortcuts();

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
    // The number-key branch is gated on mode === "add-vertex".
    useGraphStore.setState({ mode: "select", selectedVertexType: "z" });
    renderShortcuts();

    fireEvent.keyDown(document.body, { key: "5" });
    expect(useGraphStore.getState().selectedVertexType).toBe("z");
  });
});

describe("? key with the help dialog already open", () => {
  // `?` is toggleHelp(); pressing it again closes the dialog. The dialog
  // auto-focuses its close button, but the keydown bubbles to the window
  // handler.
  it("pressing ? while the help dialog is open closes it", () => {
    useGraphStore.setState({ isHelpOpen: true });
    renderShortcuts();

    pressOnBody({ key: "?" });
    expect(useGraphStore.getState().isHelpOpen).toBe(false);
  });

  it("pressing ? repeatedly toggles the help dialog open/closed", () => {
    useGraphStore.setState({ isHelpOpen: false });
    renderShortcuts();

    pressOnBody({ key: "?" });
    expect(useGraphStore.getState().isHelpOpen).toBe(true);

    pressOnBody({ key: "?" });
    expect(useGraphStore.getState().isHelpOpen).toBe(false);

    pressOnBody({ key: "?" });
    expect(useGraphStore.getState().isHelpOpen).toBe(true);
  });
});

describe("shift + letter keys", () => {
  // Extends the case-insensitivity pin to shift combinations.
  it("Shift+S also switches to select mode (uppercase S)", () => {
    useGraphStore.setState({ mode: "add-vertex" });
    renderShortcuts();
    pressOnBody({ key: "S", shiftKey: true });
    expect(useGraphStore.getState().mode).toBe("select");
  });

  it("Shift+V also switches to add-vertex mode (uppercase V)", () => {
    useGraphStore.setState({ mode: "select" });
    renderShortcuts();
    pressOnBody({ key: "V", shiftKey: true });
    expect(useGraphStore.getState().mode).toBe("add-vertex");
  });

  it("Shift+E also switches to add-edge mode (uppercase E)", () => {
    renderShortcuts();
    pressOnBody({ key: "E", shiftKey: true });
    expect(useGraphStore.getState().mode).toBe("add-edge");
  });

  it("Shift+? (uppercase) also toggles the help dialog", () => {
    renderShortcuts();
    expect(useGraphStore.getState().isHelpOpen).toBe(false);

    pressOnBody({ key: "?", shiftKey: true });
    expect(useGraphStore.getState().isHelpOpen).toBe(true);
  });
});

describe("event.preventDefault behavior", () => {
  it("does not preventDefault on a non-handled key (letter 'a' without modifier)", () => {
    renderShortcuts();

    const event = new KeyboardEvent("keydown", {
      key: "a",
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    // 'a' without modifier isn't bound — no preventDefault.
    expect(event.defaultPrevented).toBe(false);
  });

  it("prevents default on Delete (so the browser's back-nav on some platforms doesn't fire)", () => {
    useGraphStore.setState({
      nodes: [makeVertex("a", { x: 0, y: 0 }, true)],
    });
    renderShortcuts();

    const event = new KeyboardEvent("keydown", {
      key: "Delete",
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    // Delete deletes but does NOT preventDefault (no browser default in a
    // page). Pinned so adding preventDefault is a deliberate change.
    expect(event.defaultPrevented).toBe(false);
  });

  it("prevents default on 'f' (fit-view) so the browser's find-in-page isn't triggered", () => {
    // 'f' (fit view) is handled but does NOT preventDefault — without Ctrl,
    // 'f' has no browser default in a page. Pinned.
    renderShortcuts();

    const event = new KeyboardEvent("keydown", {
      key: "f",
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});