// The vertex-registry is read by both the renderer and the side
// menu, so bugs surface in two places. Properties (not snapshots) are
// asserted so adding a type doesn't require touching this file.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_VERTEX_TYPE,
  isDirectionalVertex,
  isSpiderType,
  VERTEX_TYPES,
  VERTEX_TYPE_MAP,
} from "./vertex-registry";
import type { VertexType } from "./types";

describe("VERTEX_TYPES registry", () => {
  it("covers every VertexType at least once", () => {
    // A union member missing from the registry would render a missing-glyph box.
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
    // Derived in `enrich()`; a missing shape case would silently render a
    // non-rounded body.
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
        // The body is clipped to a polygon, so a CSS radius is a no-op.
        expect(meta.radiusClass).toBe("");
      }
    }
  });

  it("only the W node and And gate are directional", () => {
    // `directional` drives whether the renderer places a top handle.
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
  // The label-as-phase convention applies only to spider/box types; a
  // mis-classification would show or hide the phase hint wrongly.

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
describe("VERTEX_TYPE_MAP — prototype-key safety", () => {
  it("looks up prototype-chain keys as undefined", () => {
    // Imported files can carry arbitrary vertexType strings; a null-prototype
    // map must not leak Object.prototype members through `??` fallbacks.
    expect(VERTEX_TYPE_MAP["__proto__" as never]).toBeUndefined();
    expect(VERTEX_TYPE_MAP["constructor" as never]).toBeUndefined();
    expect(VERTEX_TYPE_MAP["toString" as never]).toBeUndefined();
  });
});
