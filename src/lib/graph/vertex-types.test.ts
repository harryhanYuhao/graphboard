// src/lib/graph/vertex-types.test.ts
//
// Vertex-types is the registry that both the renderer (`VertexNode`)
// and the side menu (`VertexTypeMenu`) read from. Bugs here surface
// in two places at once, so the invariants below guard the shape
// the rest of the app relies on.
//
// The test asserts properties rather than literal snapshots so adding
// a new vertex type doesn't require touching this file — only the
// invariants need to keep holding.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_VERTEX_TYPE,
  isDirectionalVertex,
  isSpiderType,
  VERTEX_TYPES,
  VERTEX_TYPE_MAP,
} from "./vertex-types";
import type { VertexType } from "./types";

describe("VERTEX_TYPES registry", () => {
  it("covers every VertexType at least once", () => {
    // If a new vertex type is added to the union in `types.ts` but
    // forgotten in `VERTEX_TYPES`, the lookup map below will silently
    // fall through to `undefined` and the renderer will draw a
    // missing-glyph box. Fail loud instead.
    const allTypes: VertexType[] = [
      "z",
      "empty",
      "x",
      "w",
      "h",
      "zbox",
      "xbox",
      "and",
    ];
    for (const t of allTypes) {
      expect(VERTEX_TYPE_MAP[t]).toBeDefined();
      expect(VERTEX_TYPE_MAP[t].type).toBe(t);
    }
  });

  it("contains no duplicate entries", () => {
    const seen = new Set<VertexType>();
    for (const meta of VERTEX_TYPES) {
      expect(seen.has(meta.type)).toBe(false);
      seen.add(meta.type);
    }
  });

  it("every entry has a positive size and non-empty className", () => {
    for (const meta of VERTEX_TYPES) {
      expect(meta.size).toBeGreaterThan(0);
      expect(meta.className.length).toBeGreaterThan(0);
      expect(meta.label.length).toBeGreaterThan(0);
    }
  });

  it("every entry has a derived radiusClass and isTriangle matching its shape", () => {
    // These are derived in `enrich()` — if a shape is added without
    // a corresponding case in `shapeRadiusClass`, the runtime will
    // silently fall through and render a non-rounded vertex body.
    for (const meta of VERTEX_TYPES) {
      expect(typeof meta.radiusClass).toBe("string");
      expect(meta.isTriangle).toBe(meta.shape === "triangle");
      if (meta.shape === "circle") {
        expect(meta.radiusClass).toBe("rounded-full");
      }
      if (meta.shape === "square") {
        expect(meta.radiusClass).toBe("rounded-sm");
      }
      if (meta.shape === "triangle") {
        // The body is clipped to a polygon, so a CSS radius would be
        // a no-op; the contract is the empty string.
        expect(meta.radiusClass).toBe("");
      }
    }
  });

  it("only the W node and And gate are directional", () => {
    // `directional` drives whether the renderer places a top handle.
    // If a new symmetric type accidentally flips this flag, edges
    // would route to a dot that doesn't exist on that vertex.
    const directionalTypes = VERTEX_TYPES.filter((m) => m.directional).map(
      (m) => m.type,
    );
    expect(directionalTypes.sort()).toEqual(["and", "w"]);
  });
});

describe("isDirectionalVertex", () => {
  it("is true for W and And gate", () => {
    expect(isDirectionalVertex("w")).toBe(true);
    expect(isDirectionalVertex("and")).toBe(true);
  });

  it.each<VertexType>(["z", "x", "h", "zbox", "xbox", "empty"])(
    "is false for symmetric vertex type '%s'",
    (t) => {
      expect(isDirectionalVertex(t)).toBe(false);
    },
  );
});

describe("DEFAULT_VERTEX_TYPE", () => {
  it("resolves to a registered type", () => {
    expect(VERTEX_TYPE_MAP[DEFAULT_VERTEX_TYPE]).toBeDefined();
  });
});

describe("isSpiderType", () => {
  // The label-as-phase convention (see AGENTS.md) applies only to
  // the four spider / box types. Adding a new vertex type without
  // updating this predicate would silently mis-classify its label
  // — the property panel would either show a phase hint where
  // none makes sense, or hide it where it should appear.

  it.each<VertexType>(["z", "x", "zbox", "xbox"])(
    "is true for spider / box type '%s'",
    (t) => {
      expect(isSpiderType(t)).toBe(true);
    },
  );

  it.each<VertexType>(["empty", "w", "h", "and"])(
    "is false for non-spider type '%s'",
    (t) => {
      expect(isSpiderType(t)).toBe(false);
    },
  );
});