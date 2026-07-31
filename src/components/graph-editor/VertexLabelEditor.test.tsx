// The label-editor owns in-place label editing. The contract (start / commit
// on Enter or blur / cancel on Escape / canStartEditing gate) has many edges
// the parent component relies on, so each is pinned.

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { VertexLabelEditor, type VertexLabelEditorHandle } from "./VertexLabelEditor";

// Controlled wrapper — the editor calls `onCommit(label)` and the parent
// updates its `value`, mirroring how `VertexNode` uses it.
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

// Wrapper exposing the imperative ref the way VertexNode does: a parent-owned
// ref that calls `startEditing()` from a double-click anywhere in its subtree,
// not just on the inner span (catches body-background clicks).
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
    // Empty value: glyph path.
    const { unmount } = render(<Harness initial="" />);
    expect(screen.getByTestId("glyph").parentElement?.tagName).toBe("SPAN");
    unmount();

    // Fresh mount with a label: span-with-text path. Unmount + remount
    // (rerender would keep Harness state and still show the glyph).
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

    // Enter triggers blur → commit with the trimmed value.
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
    // jsdom doesn't implement focus() reliably; check for exactly one
    // input element when editing instead.
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

// The inner <span>'s onDoubleClick only fires on a direct span/glyph click.
// For empty-label vertices the body has no glyph to catch the click, so
// VertexNode wires an outer-div onDoubleClick calling the imperative
// `startEditing()` handle — the trigger path this block exercises.
describe("VertexLabelEditor — imperative handle for parent-triggered editing", () => {
  it("a double-click on a parent wrapper opens the editor via the ref", () => {
    render(<HarnessWithOuterRef initial="" />);
    // A double-click on the outer div must reach the editor regardless of
    // where in the subtree it landed.
    fireEvent.doubleClick(screen.getByTestId("outer"));
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("a parent-triggered startEditing is gated by canStartEditing", () => {
    render(<HarnessWithOuterRef initial="" canStartEditing={false} />);
    fireEvent.doubleClick(screen.getByTestId("outer"));
    // canStartEditing=false must not flip into input mode.
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByTestId("glyph")).toBeInTheDocument();
  });

  it("a stray double-click while already editing does not clobber the draft", () => {
    // A double-click bubbling up from the input while typing must be a
    // no-op, not a reset to the original value.
    render(<HarnessWithOuterRef initial="alpha" />);
    fireEvent.doubleClick(screen.getByText("alpha"));

    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "alpha-2" } });

    // A second double-click must NOT reset the draft back to "alpha".
    fireEvent.doubleClick(input);
    expect(input.value).toBe("alpha-2");
  });
});