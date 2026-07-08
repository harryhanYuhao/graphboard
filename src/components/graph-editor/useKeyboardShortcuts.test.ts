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
});

describe("modifier-bearing shortcuts", () => {
  it("Ctrl/Cmd+A selects everything and preventDefaults", () => {
    useGraphStore.setState({
      nodes: [
        { id: "a", type: "vertex", position: { x: 0, y: 0 }, origin: [0.5, 0.5], selected: false, data: { label: "", vertexType: "z" } },
        { id: "b", type: "vertex", position: { x: 0, y: 0 }, origin: [0.5, 0.5], selected: false, data: { label: "", vertexType: "z" } },
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
        { id: "a", type: "vertex", position: { x: 0, y: 0 }, origin: [0.5, 0.5], selected: true, data: { label: "", vertexType: "z" } },
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
    const saveSpy = vi.spyOn(useGraphStore.getState(), "save");
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
        { id: "a", type: "vertex", position: { x: 0, y: 0 }, origin: [0.5, 0.5], selected: true, data: { label: "", vertexType: "z" } },
        { id: "b", type: "vertex", position: { x: 0, y: 0 }, origin: [0.5, 0.5], selected: false, data: { label: "", vertexType: "z" } },
      ],
    });
    renderHook(() => useKeyboardShortcuts());

    pressOnBody({ key: "Delete" });
    expect(useGraphStore.getState().nodes.map((n) => n.id)).toEqual(["b"]);
  });

  it("Backspace also deletes the selection", () => {
    useGraphStore.setState({
      nodes: [
        { id: "a", type: "vertex", position: { x: 0, y: 0 }, origin: [0.5, 0.5], selected: true, data: { label: "", vertexType: "z" } },
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
        { id: "a", type: "vertex", position: { x: 0, y: 0 }, origin: [0.5, 0.5], selected: true, data: { label: "", vertexType: "z" } },
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
    // VERTEX_TYPES[3] is "x".
    expect(useGraphStore.getState().selectedVertexType).toBe("x");
  });

  it("press 0 is a no-op (index 0 not accepted)", () => {
    useGraphStore.setState({ mode: "add-vertex", selectedVertexType: "z" });
    renderHook(() => useKeyboardShortcuts());

    pressOnBody({ key: "0" });
    expect(useGraphStore.getState().selectedVertexType).toBe("z");
  });

  it("press 9 is a no-op (out of range)", () => {
    useGraphStore.setState({ mode: "add-vertex", selectedVertexType: "z" });
    renderHook(() => useKeyboardShortcuts());

    pressOnBody({ key: "9" });
    expect(useGraphStore.getState().selectedVertexType).toBe("z");
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