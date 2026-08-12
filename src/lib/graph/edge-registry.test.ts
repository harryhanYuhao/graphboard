// The edge-kind registry must stay in sync with the kind strings: every
// value in EDGE_KINDS has display metadata, the map has no orphans, and
// each kind has a distinct user-facing name (a duplicated label would make
// the swatch menus ambiguous and `getByRole` queries break).

import { describe, expect, it } from "vitest";
import { EDGE_KINDS } from "@/lib/graph/types";
import { EDGE_KIND_MAP, coerceEdgeKind } from "./edge-registry";

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
});

describe("coerceEdgeKind", () => {
  it("passes valid members through unchanged", () => {
    for (const kind of EDGE_KINDS) {
      expect(coerceEdgeKind(kind)).toBe(kind);
    }
  });

  it("degrades undefined and missing data to the default kind", () => {
    expect(coerceEdgeKind(undefined)).toBe("default");
  });

  it("degrades unknown strings to the default kind", () => {
    expect(coerceEdgeKind("dashed")).toBe("default");
    expect(coerceEdgeKind("invisible")).toBe("default");
  });

  it("degrades non-strings to the default kind", () => {
    expect(coerceEdgeKind(42)).toBe("default");
    expect(coerceEdgeKind(null)).toBe("default");
    expect(coerceEdgeKind({})).toBe("default");
  });
});
