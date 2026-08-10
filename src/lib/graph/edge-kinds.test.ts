// The edge-kind registry must stay in sync with the kind strings: every
// value in EDGE_KINDS has display metadata, and the map has no orphans.

import { describe, expect, it } from "vitest";
import { EDGE_KINDS } from "@/lib/graph/types";
import { EDGE_KIND_MAP } from "./edge-kinds";

describe("EDGE_KIND_MAP", () => {
  it("covers every edge kind exactly once (no drift from EDGE_KINDS)", () => {
    expect(Object.keys(EDGE_KIND_MAP).sort()).toEqual([...EDGE_KINDS].sort());
  });

  it("gives every kind a user-facing label and swatch stroke", () => {
    for (const kind of EDGE_KINDS) {
      const meta = EDGE_KIND_MAP[kind];
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.stroke).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });
});
