// Pins the confirmation-dialog interaction contract: escape and backdrop
// clicks cancel, clicking the inner panel does not, focus lands on the
// cancel button by default, and the confirm class override applies.

import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ConfirmationDialog } from "./ConfirmationDialog";

const BASE = {
  isOpen: true,
  title: "Reset graph?",
  message: "This clears the canvas.",
  confirmText: "Reset",
  cancelText: "Cancel",
  onConfirm: () => {},
  onCancel: () => {},
  confirmButtonClassName: "bg-red-600 hover:bg-red-700",
};

function renderDialog(overrides: Partial<typeof BASE> = {}) {
  const props = { ...BASE, ...overrides };
  render(<ConfirmationDialog {...props} />);
  return props;
}

describe("ConfirmationDialog", () => {
  it("renders nothing when closed", () => {
    renderDialog({ isOpen: false });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("focuses the cancel button on open (Enter fires cancel natively)", () => {
    renderDialog();
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
  });

  it("Escape calls onCancel", () => {
    const onCancel = vi.fn();
    renderDialog({ onCancel });
    // Escape is handled on the inner panel; fire on the auto-focused cancel
    // button (the realistic focus target) and let it bubble.
    fireEvent.keyDown(screen.getByRole("button", { name: "Cancel" }), {
      key: "Escape",
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("clicking the backdrop calls onCancel", () => {
    const onCancel = vi.fn();
    renderDialog({ onCancel });
    fireEvent.click(screen.getByRole("dialog"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("clicking the inner panel does NOT call onCancel", () => {
    const onCancel = vi.fn();
    renderDialog({ onCancel });
    const title = screen.getByText("Reset graph?");
    fireEvent.click(title);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("confirm button calls onConfirm with the class override", () => {
    const onConfirm = vi.fn();
    renderDialog({ onConfirm, confirmButtonClassName: "bg-blue-600" });
    const confirm = screen.getByRole("button", { name: "Reset" });
    expect(confirm.className).toContain("bg-blue-600");
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
