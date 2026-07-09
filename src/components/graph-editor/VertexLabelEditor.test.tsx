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
import { useState } from "react";
import { VertexLabelEditor } from "./VertexLabelEditor";

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