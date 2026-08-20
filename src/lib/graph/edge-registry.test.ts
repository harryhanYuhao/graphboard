// The edge-kind registry must stay in sync with the kind strings: every
// value in EDGE_KINDS has display metadata, the map has no orphans, and
// each kind has a distinct user-facing name (a duplicated label would make
// the swatch menus ambiguous and `getByRole` queries break).

import { describe, expect, it } from "vitest";
import { EDGE_KINDS } from "@/lib/graph/types";
import { EDGE_KIND_MAP } from "./edge-registry";

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

  it("gives each kind a distinct label (no copy-paste collisions)", () => {
    const labels = EDGE_KINDS.map((kind) => EDGE_KIND_MAP[kind].label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("labels the dashed-light kind 'Dashed light'", () => {
    expect(EDGE_KIND_MAP.dashed_light.label).toBe("Dashed light");
  });

  it("labels the dashed-red kind 'Dashed red'", () => {
    expect(EDGE_KIND_MAP.dashed_red.label).toBe("Dashed red");
  });
});
