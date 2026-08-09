// Pins the compute-result dialog status machine: loading while the promise
// is pending, the value table on resolve (scalar shape → single entry), and
// the error view on rejection (AbortError vs ComputeError branches).

import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ComputeResultDialog } from "./ComputeResultDialog";
import { ComputeError } from "@/lib/compute/errors";
import type { TensorResult } from "@/lib/compute/result-types";

function renderDialog(computePromise: Promise<TensorResult> | null) {
  render(
    <ComputeResultDialog
      isOpen
      onClose={vi.fn()}
      computePromise={computePromise}
      progress={null}
    />,
  );
}

const SCALAR: TensorResult = {
  shape: [],
  data: [[1, 0]],
  warnings: [],
  inputCount: 0,
  outputCount: 0,
};

const MATRIX: TensorResult = {
  shape: [2, 2],
  data: [
    [1, 0],
    [0, 0],
    [0, 0],
    [1, 0],
  ],
  warnings: [],
  inputCount: 1,
  outputCount: 1,
};

describe("ComputeResultDialog — status machine", () => {
  it("shows a loading state while the promise is pending", () => {
    renderDialog(new Promise(() => {}));
    expect(screen.getByText(/contracting/i)).toBeInTheDocument();
  });

  it("renders a scalar result on resolve", async () => {
    renderDialog(Promise.resolve(SCALAR));
    // Scalar path renders the constant with 4 decimals: value 1.0000.
    await waitFor(() =>
      expect(screen.getByText("1.0000")).toBeInTheDocument(),
    );
  });

  it("renders the value table for a matrix result", async () => {
    renderDialog(Promise.resolve(MATRIX));
    // The identity matrix has exactly two 1.000 cells (diagonal) and two
    // "0" cells, formatted via formatComplex.
    await waitFor(() => {
      expect(screen.getAllByText("1.000")).toHaveLength(2);
      expect(screen.getAllByText("0")).toHaveLength(2);
    });
  });

  it("shows 'Computation cancelled' for an AbortError rejection", async () => {
    renderDialog(Promise.reject(new DOMException("cancelled", "AbortError")));
    await waitFor(() =>
      expect(screen.getByText("Computation cancelled.")).toBeInTheDocument(),
    );
  });

  it("shows the ComputeError message on rejection", async () => {
    renderDialog(Promise.reject(new ComputeError("w-input-count", "bad W")));
    await waitFor(() =>
      expect(screen.getByText("bad W")).toBeInTheDocument(),
    );
  });
});
