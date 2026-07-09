// src/components/graph-editor/VertexLabelEditor.test.tsx
//
// The label-editor owns the in-place edit interaction for a vertex
// label. The contract is small (start / commit / cancel / canStartEditing)
// but every edge case matters: the user types a label, hits Enter, blurs,
// presses Escape. Each of those needs to behave correctly without
// rounding the corners the parent component relies on (trim, commit
// on blur, commit on Enter, cancel-on-Escape).

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { VertexLabelEditor, type VertexLabelEditorHandle } from "./VertexLabelEditor";

// Controlled wrapper — the editor calls `onCommit(label)` and the
// parent updates its `value` so the editor re-renders into the
// committed label. Mirrors how `VertexNode` uses it.
function Harness({
  initial = "",
  canStartEditing = true,
  onCommit = vi.fn(),
}: {
  initial?: string;
  canStartEditing?: boolean;
  onCommit?: (label: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <VertexLabelEditor
      value={value}
      glyph={<span data-testid="glyph">Λ</span>}
      canStartEditing={canStartEditing}
      onCommit={(label) => {
        onCommit(label);
        setValue(label);
      }}
    />
  );
}

// Wrapper that exposes the imperative ref the way VertexNode does:
// a parent-owned ref that can call `startEditing()` from a
// double-click anywhere inside its own DOM subtree, not just on the
// editor's inner span. This is the trigger path that catches clicks
// on the body background — the regression we're guarding against.
function HarnessWithOuterRef({
  initial = "",
  canStartEditing = true,
}: {
  initial?: string;
  canStartEditing?: boolean;
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<VertexLabelEditorHandle>(null);
  return (
    <div
      data-testid="outer"
      onDoubleClick={() => ref.current?.startEditing()}
    >
      <VertexLabelEditor
        ref={ref}
        value={value}
        glyph={<span data-testid="glyph">Λ</span>}
        canStartEditing={canStartEditing}
        onCommit={setValue}
      />
    </div>
  );
}

describe("VertexLabelEditor — display states", () => {
  it("shows the glyph when the label is empty", () => {
    render(<Harness initial="" />);
    expect(screen.getByTestId("glyph")).toBeInTheDocument();
  });

  it("shows the label text when present", () => {
    render(<Harness initial="hello" />);
    expect(screen.getByText("hello")).toBeInTheDocument();
    expect(screen.queryByTestId("glyph")).not.toBeInTheDocument();
  });

  it("renders a span around both display states so the double-click target is uniform", () => {
    // Initial render with empty value: glyph path.
    const { unmount } = render(<Harness initial="" />);
    expect(screen.getByTestId("glyph").parentElement?.tagName).toBe("SPAN");
    unmount();

    // Fresh mount with a label: span-with-text path. We unmount +
    // remount (rather than rerender) because rerender preserves the
    // Harness's internal state and we'd still be showing the glyph.
    render(<Harness initial="x" />);
    expect(screen.getByText("x").tagName).toBe("SPAN");
  });
});

describe("VertexLabelEditor — start editing", () => {
  it("double-click switches into the input when canStartEditing is true", () => {
    render(<Harness initial="hello" />);
    fireEvent.doubleClick(screen.getByText("hello"));
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe(
      "hello",
    );
  });

  it("double-click is a no-op when canStartEditing is false", () => {
    render(<Harness initial="hello" canStartEditing={false} />);
    fireEvent.doubleClick(screen.getByText("hello"));
    // The text remains; no input appears.
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("double-click on the empty/glyph state also opens the editor when allowed", () => {
    render(<Harness initial="" />);
    fireEvent.doubleClick(screen.getByTestId("glyph"));
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("double-click on the empty state is gated by canStartEditing", () => {
    render(<Harness initial="" canStartEditing={false} />);
    fireEvent.doubleClick(screen.getByTestId("glyph"));
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});

describe("VertexLabelEditor — commit", () => {
  it("Enter commits via blur and the trimmed value is forwarded", () => {
    const onCommit = vi.fn();
    render(<Harness initial="hi" onCommit={onCommit} />);
    fireEvent.doubleClick(screen.getByText("hi"));

    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "  new label  " } });
    fireEvent.keyDown(input, { key: "Enter" });

    // Enter calls `inputRef.current?.blur()`, which triggers onBlur
    // → commit with the trimmed value.
    expect(onCommit).toHaveBeenCalledWith("new label");
    // Editing state clears after commit.
    expect(screen.queryByRole("textbox")).toBeNull();
    // The harness updates its `value`, so the new label renders.
    expect(screen.getByText("new label")).toBeInTheDocument();
  });

  it("blur commits the trimmed value", () => {
    const onCommit = vi.fn();
    render(<Harness initial="" onCommit={onCommit} />);
    fireEvent.doubleClick(screen.getByTestId("glyph"));

    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "  alpha  " } });
    fireEvent.blur(input);

    expect(onCommit).toHaveBeenCalledWith("alpha");
  });

  it("committing an empty string clears the label and reveals the glyph again", () => {
    const onCommit = vi.fn();
    render(<Harness initial="hello" onCommit={onCommit} />);
    fireEvent.doubleClick(screen.getByText("hello"));

    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);

    expect(onCommit).toHaveBeenCalledWith("");
    // After commit, the harness sets value to "" → glyph path renders.
    expect(screen.getByTestId("glyph")).toBeInTheDocument();
  });
});

describe("VertexLabelEditor — cancel via Escape", () => {
  it("Escape discards the draft and reverts to the original label", () => {
    const onCommit = vi.fn();
    render(<Harness initial="original" onCommit={onCommit} />);
    fireEvent.doubleClick(screen.getByText("original"));

    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "garbage" } });
    fireEvent.keyDown(input, { key: "Escape" });

    // No commit fires on cancel.
    expect(onCommit).not.toHaveBeenCalled();
    // Editor exits edit mode and renders the original label.
    expect(screen.getByText("original")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("Escape reverts to the original even if the original is empty (glyph reappears)", () => {
    render(<Harness initial="" />);
    fireEvent.doubleClick(screen.getByTestId("glyph"));

    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "typed but cancelled" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(screen.getByTestId("glyph")).toBeInTheDocument();
    expect(screen.queryByText("typed but cancelled")).toBeNull();
  });
});

describe("VertexLabelEditor — input element properties", () => {
  it("the input is the actual DOM input the user types into", () => {
    // `autoFocus` is verified by React itself in production; jsdom
    // doesn't implement focus() reliably. We instead check that the
    // editor renders exactly one input element when editing — the
    // contract the user cares about.
    render(<Harness initial="hi" />);
    fireEvent.doubleClick(screen.getByText("hi"));
    const inputs = screen.getAllByRole("textbox");
    expect(inputs).toHaveLength(1);
    expect((inputs[0] as HTMLInputElement).tagName).toBe("INPUT");
  });

  it("input value mirrors the draft as the user types", () => {
    render(<Harness initial="hello" />);
    fireEvent.doubleClick(screen.getByText("hello"));
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.value).toBe("hello");
    fireEvent.change(input, { target: { value: "hello world" } });
    expect(input.value).toBe("hello world");
  });
});

// Regression: the inner <span>'s onDoubleClick only fires when the
// click lands *directly* on the span / glyph. For empty-label
// vertices the body has no glyph/text to catch the click, so a
// double-click on the body background would otherwise open nothing.
// VertexNode wires an outer-div onDoubleClick that calls the
// imperative `startEditing()` handle — that's the trigger path this
// block exercises.
describe("VertexLabelEditor — imperative handle for parent-triggered editing", () => {
  it("a double-click on a parent wrapper opens the editor via the ref", () => {
    render(<HarnessWithOuterRef initial="" />);
    // Simulate the parent catching a double-click on its outer div
    // (which, in VertexNode, wraps both the handles and the body).
    // Firing it on the outer div tests that the ref reaches the
    // editor without depending on where inside the subtree the click
    // landed.
    fireEvent.doubleClick(screen.getByTestId("outer"));
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("a parent-triggered startEditing is gated by canStartEditing", () => {
    render(<HarnessWithOuterRef initial="" canStartEditing={false} />);
    fireEvent.doubleClick(screen.getByTestId("outer"));
    // canStartEditing=false → the editor must not flip into input mode.
    expect(screen.queryByRole("textbox")).toBeNull();
    // The glyph is still there as the empty-state content.
    expect(screen.getByTestId("glyph")).toBeInTheDocument();
  });

  it("a stray double-click while already editing does not clobber the draft", () => {
    // Mirror VertexNode's outer-div handler: a double-click
    // bubbling up from the input itself while the user is typing
    // should be a no-op, not reset the draft to the original value.
    render(<HarnessWithOuterRef initial="alpha" />);
    fireEvent.doubleClick(screen.getByText("alpha"));

    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "alpha-2" } });

    // Now a second double-click bubbles up to the outer div — must
    // NOT reset the in-progress draft back to "alpha".
    fireEvent.doubleClick(input);
    expect(input.value).toBe("alpha-2");
  });
});