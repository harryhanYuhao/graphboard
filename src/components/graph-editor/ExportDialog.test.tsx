// Pins the ExportDialog's documentation links: one per registered format,
// pointing at the format's `doc_url`, opening in a new tab. Thin surface —
// the dialog's radio/export behavior is store-tested; this only guards the
// doc-link UI the format registry feeds.

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { EXPORT_FORMATS } from "@/lib/serialisation";
import { ExportDialog } from "./ExportDialog";

describe("ExportDialog — documentation links", () => {
  it("renders one new-tab documentation link per format", () => {
    render(<ExportDialog isOpen onClose={vi.fn()} />);

    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(EXPORT_FORMATS.length);
    for (const link of links) {
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
      expect(link.getAttribute("href")).toMatch(
        /^https:\/\/zxwgraphboard-doc\.netlify\.app\//,
      );
    }
  });

  it("deep-links the TikZ format to the TikZ documentation section", () => {
    render(<ExportDialog isOpen onClose={vi.fn()} />);

    const tikz = screen.getByRole("link", { name: /TikZ/ });
    expect(tikz).toHaveAttribute(
      "href",
      expect.stringContaining("#using-a-tikz-export-in-latex"),
    );
  });

  it("clicking the documentation link does not change the selected format", () => {
    render(<ExportDialog isOpen onClose={vi.fn()} />);

    const jsonRadio = screen.getByRole("radio", {
      name: /JSON/,
    }) as HTMLInputElement;
    const tikzRadio = screen.getByRole("radio", {
      name: /TikZ/,
    }) as HTMLInputElement;

    fireEvent.click(tikzRadio);
    expect(tikzRadio).toBeChecked();

    // The link is a sibling of the label, so activating it must not toggle
    // the radio it sits next to.
    fireEvent.click(screen.getByRole("link", { name: /TikZ/ }));
    expect(tikzRadio).toBeChecked();
    expect(jsonRadio).not.toBeChecked();
  });
});
