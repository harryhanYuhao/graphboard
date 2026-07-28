// src/lib/misc_edge_cases.test.ts
//
// Edge-case coverage for three pure modules whose existing tests cover the
// happy paths but leave the boundaries (invalid input, non-axis-aligned
// rotations, the input/output boundary vertex types, and a couple of
// suspected bugs) un-pinned:
//
//   - vertex-types.ts — `isBoundaryVertex` was UNTESTED and the existing
//     `allTypes` array (vertex-types.test.ts:28-37) omitted `input` /
//     `output`, so the registry metadata for those two boundary markers
//     was never asserted.
//   - edge-geometry.ts — existing tests cover rotation 90/180/270; this
//     file adds 0/45/360/-90 plus the NaN / Infinity degenerate inputs.
//   - download.ts — existing tests cover the native + fallback paths;
//     this file pins the anchor Blob content type / filename, custom MIME
//     propagation, and the suspected bug where the native `open` picker
//     ignores the `accept` parameter (download.ts:81-89 hardcodes JSON).
//
// One behavior per test. Bugs are pinned with `it.skip` + a pointer to the
// offending file:line — NOT fixed here (parent agent keeps diff control).

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getEdgeEndpoint,
  type EndpointInput,
} from "./graph/edge-geometry";
import {
  DEFAULT_VERTEX_TYPE,
  isBoundaryVertex,
  isDirectionalVertex,
  isSpiderType,
  VERTEX_TYPES,
  VERTEX_TYPE_MAP,
} from "./graph/vertex-types";
import type { VertexType } from "./graph/types";
import {
  openTextFileWithPicker,
  saveTextFileWithPicker,
} from "./download";

// ──────────────────────────────────────────────────────────────────────────
// vertex-types
// ──────────────────────────────────────────────────────────────────────────

describe("isBoundaryVertex", () => {
  it("is true for the 'input' boundary marker", () => {
    expect(isBoundaryVertex("input")).toBe(true);
  });

  it("is true for the 'output' boundary marker", () => {
    expect(isBoundaryVertex("output")).toBe(true);
  });

  it.each<VertexType>([
    "z",
    "empty",
    "x",
    "w",
    "h",
    "zbox",
    "xbox",
    "and",
  ])("is false for non-boundary vertex type '%s'", (t) => {
    expect(isBoundaryVertex(t)).toBe(false);
  });

  it("returns false (not throw) for an invalid vertex type string", () => {
    // The predicate is a strict equality check against 'input' / 'output'
    // (vertex-types.ts:48-50), so an unknown string just misses both
    // branches. Pin that contract: no throw, returns false.
    expect(isBoundaryVertex("nonsense" as VertexType)).toBe(false);
  });
});

describe("VERTEX_TYPES registry — boundary entries", () => {
  // The existing `allTypes` array in vertex-types.test.ts:28-37 OMITS
  // `input` / `output`, so the registry's metadata for those two boundary
  // types is never asserted. Fill the gap.

  it("includes an 'input' entry with sensible shape / color / size", () => {
    const meta = VERTEX_TYPE_MAP.input;
    expect(meta).toBeDefined();
    expect(meta.type).toBe("input");
    expect(meta.shape).toBe("circle");
    expect(meta.size).toBeGreaterThan(0);
    // Boundary markers render as blue-dotted circles — the className is
    // the single source of truth for that styling.
    expect(meta.className).toMatch(/blue/);
    expect(meta.label.length).toBeGreaterThan(0);
  });

  it("includes an 'output' entry with sensible shape / color / size", () => {
    const meta = VERTEX_TYPE_MAP.output;
    expect(meta).toBeDefined();
    expect(meta.type).toBe("output");
    expect(meta.shape).toBe("circle");
    expect(meta.size).toBeGreaterThan(0);
    // Output is distinguished by a green border.
    expect(meta.className).toMatch(/green/);
    expect(meta.label.length).toBeGreaterThan(0);
  });
});

describe("VERTEX_TYPE_MAP — exhaustive coverage", () => {
  it("contains every VertexType union member as a key", () => {
    // Pin the full 10-type union exhaustively. If a new type is added to
    // the union in types.ts but forgotten in the registry, the lookup
    // would be undefined and the renderer would draw a missing-glyph box.
    const allTypes: VertexType[] = [
      "z",
      "empty",
      "x",
      "w",
      "h",
      "zbox",
      "xbox",
      "and",
      "input",
      "output",
    ];
    for (const t of allTypes) {
      expect(VERTEX_TYPE_MAP[t]).toBeDefined();
      expect(VERTEX_TYPE_MAP[t].type).toBe(t);
    }
    expect(Object.keys(VERTEX_TYPE_MAP)).toHaveLength(allTypes.length);
  });
});

describe("VERTEX_TYPES registry — structural invariants", () => {
  it("contains no duplicate type keys", () => {
    // A duplicate `type` field would silently overwrite one entry in the
    // VERTEX_TYPE_MAP, dropping its metadata from the registry.
    const seen = new Set<VertexType>();
    for (const meta of VERTEX_TYPES) {
      expect(seen.has(meta.type)).toBe(false);
      seen.add(meta.type);
    }
  });

  it("every entry has the required base fields", () => {
    // Structural pin: each entry must declare the four base fields the
    // renderer reads directly. Derived fields (radiusClass / isTriangle)
    // are checked separately below.
    for (const meta of VERTEX_TYPES) {
      expect(typeof meta.shape).toBe("string");
      expect(typeof meta.className).toBe("string");
      expect(meta.className.length).toBeGreaterThan(0);
      expect(typeof meta.size).toBe("number");
      expect(meta.size).toBeGreaterThan(0);
      expect(typeof meta.label).toBe("string");
      expect(meta.label.length).toBeGreaterThan(0);
    }
  });
});

describe("enrich() derived fields", () => {
  it("derives radiusClass and isTriangle consistently for the W node (triangle)", () => {
    // The W node is the only triangle in the registry — a good single
    // sample to pin that `enrich()` derived both fields from `shape`.
    const w = VERTEX_TYPE_MAP.w;
    expect(w.shape).toBe("triangle");
    expect(w.isTriangle).toBe(true);
    // Triangles are clipped to their silhouette, so radiusClass is the
    // empty string (a CSS radius would be a no-op).
    expect(w.radiusClass).toBe("");
  });

  it("derives radiusClass='rounded-full' and isTriangle=false for the Z spider (circle)", () => {
    const z = VERTEX_TYPE_MAP.z;
    expect(z.shape).toBe("circle");
    expect(z.isTriangle).toBe(false);
    expect(z.radiusClass).toBe("rounded-full");
  });
});

describe("DEFAULT_VERTEX_TYPE", () => {
  it("is the Z spider", () => {
    // Pinned literal — `z` is the default the side menu and the empty-
    // graph factory both assume. A silent change here would shift every
    // new vertex's type.
    expect(DEFAULT_VERTEX_TYPE).toBe("z");
  });
});

describe("isSpiderType / isDirectionalVertex — parametric re-pin", () => {
  // Existing tests cover these, but here they are parametric over the
  // full 10-type union (including input/output) for completeness.

  it.each<VertexType>(["z", "x", "zbox", "xbox"])(
    "isSpiderType('%s') is true",
    (t) => {
      expect(isSpiderType(t)).toBe(true);
    },
  );

  it.each<VertexType>(["empty", "w", "h", "and", "input", "output"])(
    "isSpiderType('%s') is false",
    (t) => {
      expect(isSpiderType(t)).toBe(false);
    },
  );

  it.each<VertexType>(["w", "and"])(
    "isDirectionalVertex('%s') is true",
    (t) => {
      expect(isDirectionalVertex(t)).toBe(true);
    },
  );

  it.each<VertexType>([
    "z",
    "empty",
    "x",
    "h",
    "zbox",
    "xbox",
    "input",
    "output",
  ])("isDirectionalVertex('%s') is false", (t) => {
    expect(isDirectionalVertex(t)).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// edge-geometry
//
// Build inputs from a small inline factory so the rotation cases below
// stay readable. Existing edge-geometry.test.ts uses the same shape but
// hides it behind a `node()` helper local to that file.
// ──────────────────────────────────────────────────────────────────────────

function endpoint(
  overrides: Partial<EndpointInput> = {},
): EndpointInput {
  return {
    positionAbsolute: { x: 0, y: 0 },
    width: 40,
    height: 40,
    vertexType: "z",
    rotation: 0,
    ...overrides,
  };
}

function expectPoint(
  actual: { x: number; y: number },
  expected: { x: number; y: number },
) {
  expect(actual.x).toBeCloseTo(expected.x, 10);
  expect(actual.y).toBeCloseTo(expected.y, 10);
}

describe("getEdgeEndpoint — rotation 0 (the no-rotation fast path)", () => {
  it("anchors a symmetric target at the node center", () => {
    // 40x40 at (0,0) → center (20,20). Symmetric = no local offset.
    expectPoint(getEdgeEndpoint(endpoint(), "target"), { x: 20, y: 20 });
  });

  it("anchors a directional target on the top edge (W / And)", () => {
    // Top edge dot: offset (0, -height/2) = (0, -20) → y=0.
    expectPoint(
      getEdgeEndpoint(endpoint({ vertexType: "w" }), "target"),
      { x: 20, y: 0 },
    );
  });
});

describe("getEdgeEndpoint — non-axis-aligned rotation", () => {
  it("rotates the directional top dot 45° clockwise around the center", () => {
    // Top dot local offset (0, -20), rotated 45° CW (y-down):
    //   rx = 0*cos45 - (-20)*sin45 = 20*sin45 ≈ 14.142
    //   ry = 0*sin45 + (-20)*cos45 = -20*cos45 ≈ -14.142
    // → endpoint (20 + 14.142, 20 - 14.142) ≈ (34.142, 5.858).
    expectPoint(
      getEdgeEndpoint(endpoint({ vertexType: "w", rotation: 45 }), "target"),
      { x: 20 + 20 * Math.SQRT1_2, y: 20 - 20 * Math.SQRT1_2 },
    );
  });
});

describe("getEdgeEndpoint — full-circle and negative rotations", () => {
  it("treats 360° as equivalent to 0° (top dot stays on the top edge)", () => {
    // 360° rotates the offset back onto itself modulo float noise:
    // rx ≈ 0, ry ≈ -20. Source: the rotation formula at
    // edge-geometry.ts:60-64. Pinned with toBeCloseTo to absorb the
    // ~1e-15 round-trip error.
    expectPoint(
      getEdgeEndpoint(
        endpoint({ vertexType: "w", rotation: 360 }),
        "target",
      ),
      { x: 20, y: 0 },
    );
  });

  it("treats -90° as equivalent to 270° (top dot moves to the left edge)", () => {
    // (0, -20) rotated -90° CW:
    //   rx = 0*cos(-90) - (-20)*sin(-90) = -20
    //   ry = 0*sin(-90) + (-20)*cos(-90) ≈ 0
    // → (0, 20), i.e. left edge center — matches the existing 270° pin.
    expectPoint(
      getEdgeEndpoint(
        endpoint({ vertexType: "w", rotation: -90 }),
        "target",
      ),
      { x: 0, y: 20 },
    );
  });
});

describe("getEdgeEndpoint — node position offset", () => {
  it("adds the absolute position to a rotated directional endpoint", () => {
    // Node translated to (100, 50): center (120, 70). Top dot local
    // offset (0, -20) rotated 90° CW → (20, 0). Endpoint = center +
    // rotated offset = (140, 70) — the right edge center of a node
    // spanning (100,50)-(140,90).
    expectPoint(
      getEdgeEndpoint(
        endpoint({
          positionAbsolute: { x: 100, y: 50 },
          vertexType: "w",
          rotation: 90,
        }),
        "target",
      ),
      { x: 140, y: 70 },
    );
  });
});

describe("getEdgeEndpoint — source vs target role", () => {
  it("places the directional source one-third down the body (rotation 0)", () => {
    // localY = +height/3 for the source role (edge-geometry.ts:51).
    expectPoint(
      getEdgeEndpoint(endpoint({ vertexType: "w" }), "source"),
      { x: 20, y: 20 + 40 / 3 },
    );
  });

  it("places the directional target on the top edge (rotation 0)", () => {
    expectPoint(
      getEdgeEndpoint(endpoint({ vertexType: "w" }), "target"),
      { x: 20, y: 0 },
    );
  });
});

describe("getEdgeEndpoint — vertex-type classification", () => {
  it.each<VertexType>(["w", "and"])(
    "uses the top-edge dot for the target role on directional '%s'",
    (t) => {
      expectPoint(
        getEdgeEndpoint(endpoint({ vertexType: t }), "target"),
        { x: 20, y: 0 },
      );
    },
  );

  it.each<VertexType>(["z", "x", "h"])(
    "uses the node center for both roles on symmetric '%s'",
    (t) => {
      expectPoint(
        getEdgeEndpoint(endpoint({ vertexType: t }), "source"),
        { x: 20, y: 20 },
      );
      expectPoint(
        getEdgeEndpoint(endpoint({ vertexType: t }), "target"),
        { x: 20, y: 20 },
      );
    },
  );
});

describe("getEdgeEndpoint — degenerate rotation inputs", () => {
  // FIXED: edge-geometry now normalizes the rotation at the boundary via
  // `normalizeRotation`, which maps NaN/±Infinity to 0 (and wraps any real
  // value to [0, 360)). The `=== 0` fast path is therefore also the
  // recovery path for degenerate input — a stray NaN from an unhydrated
  // view field no longer sends the edge to (NaN, NaN).

  it("returns a finite point for a NaN rotation (falls back to 0)", () => {
    const result = getEdgeEndpoint(
      endpoint({ vertexType: "w", rotation: NaN }),
      "target",
    );
    expect(Number.isFinite(result.x)).toBe(true);
    expect(Number.isFinite(result.y)).toBe(true);
    // NaN → 0 → directional target sits on the top edge: center x (20),
    // top edge y (0) for the 40×40 fixture at position (0,0).
    expect(result.x).toBeCloseTo(20, 6);
    expect(result.y).toBeCloseTo(0, 6);
  });

  it("returns a finite point for an Infinity rotation (falls back to 0)", () => {
    const result = getEdgeEndpoint(
      endpoint({ vertexType: "w", rotation: Infinity }),
      "target",
    );
    expect(Number.isFinite(result.x)).toBe(true);
    expect(Number.isFinite(result.y)).toBe(true);
  });

  it("returns a finite point for a -Infinity rotation (falls back to 0)", () => {
    const result = getEdgeEndpoint(
      endpoint({ vertexType: "w", rotation: -Infinity }),
      "target",
    );
    expect(Number.isFinite(result.x)).toBe(true);
    expect(Number.isFinite(result.y)).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// download
//
// Mocking pattern mirrors download.test.ts: install the FSA pickers on
// `window` via Object.defineProperty (vi.spyOn refuses on a missing
// property), drive with vi.fn(), and tear down in afterEach.
// ──────────────────────────────────────────────────────────────────────────

function mockPicker(
  name: "showSaveFilePicker" | "showOpenFilePicker",
): ReturnType<typeof vi.fn> {
  const fn = vi.fn();
  Object.defineProperty(window, name, {
    value: fn,
    configurable: true,
    writable: true,
  });
  return fn;
}

afterEach(() => {
  vi.restoreAllMocks();
  delete (
    window as unknown as Record<string, unknown>
  ).showSaveFilePicker;
  delete (
    window as unknown as Record<string, unknown>
  ).showOpenFilePicker;
  document.body.innerHTML = "";
});

describe("saveTextFileWithPicker — anchor fallback", () => {
  it("creates a Blob with the application/json content type and the given filename", async () => {
    expect(
      typeof (window as unknown as Record<string, unknown>)
        .showSaveFilePicker,
    ).toBe("undefined");

    // Spy on the Blob constructor to capture the options the code passes.
    // jsdom's Blob is real, but we replace it so we can assert on `type`.
    const blobCtor = vi.spyOn(globalThis, "Blob");
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fake-url");
    vi.spyOn(URL, "revokeObjectURL");
    const clickSpy = vi.fn();
    let capturedAnchor: HTMLAnchorElement | null = null;
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = realCreate(tag);
      if (tag === "a") {
        capturedAnchor = el as HTMLAnchorElement;
        (el as HTMLAnchorElement).click = clickSpy;
      }
      return el;
    });

    await saveTextFileWithPicker({
      suggestedName: "fallback.json",
      contents: "hello",
    });

    // Default MIME type is application/json (download.ts:9).
    expect(blobCtor).toHaveBeenCalledOnce();
    expect(blobCtor).toHaveBeenCalledWith(["hello"], {
      type: "application/json",
    });
    // The filename flows through to the anchor's `download` attribute.
    expect((capturedAnchor as HTMLAnchorElement | null)?.download).toBe(
      "fallback.json",
    );
    expect(clickSpy).toHaveBeenCalledOnce();
  });

  it("propagates a custom MIME type to the Blob", async () => {
    expect(
      typeof (window as unknown as Record<string, unknown>)
        .showSaveFilePicker,
    ).toBe("undefined");

    const blobCtor = vi.spyOn(globalThis, "Blob");
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fake-url");
    vi.spyOn(URL, "revokeObjectURL");
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = realCreate(tag);
      if (tag === "a") (el as HTMLAnchorElement).click = vi.fn();
      return el;
    });

    await saveTextFileWithPicker({
      suggestedName: "data.csv",
      contents: "a,b",
      mimeType: "text/csv",
      extension: ".csv",
    });

    expect(blobCtor).toHaveBeenCalledWith(["a,b"], { type: "text/csv" });
  });

  it("does not throw with an empty filename (anchor.download = '')", async () => {
    expect(
      typeof (window as unknown as Record<string, unknown>)
        .showSaveFilePicker,
    ).toBe("undefined");

    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fake-url");
    vi.spyOn(URL, "revokeObjectURL");
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = realCreate(tag);
      if (tag === "a") (el as HTMLAnchorElement).click = vi.fn();
      return el;
    });

    // Pin: an empty suggestedName flows straight into anchor.download
    // (download.ts:45) without any validation. Browsers treat an empty
    // download attribute as "use the blob's default name", so this is
    // a degenerate-but-non-throwing path.
    await expect(
      saveTextFileWithPicker({
        suggestedName: "",
        contents: "{}",
      }),
    ).resolves.toBeUndefined();
  });

  it("passes special characters in the filename through unchanged", async () => {
    expect(
      typeof (window as unknown as Record<string, unknown>)
        .showSaveFilePicker,
    ).toBe("undefined");

    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fake-url");
    vi.spyOn(URL, "revokeObjectURL");
    let capturedAnchor: HTMLAnchorElement | null = null;
    const clickSpy = vi.fn();
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = realCreate(tag);
      if (tag === "a") {
        capturedAnchor = el as HTMLAnchorElement;
        (el as HTMLAnchorElement).click = clickSpy;
      }
      return el;
    });

    const weirdName = "graph (1) — copy & paste.json";
    await saveTextFileWithPicker({
      suggestedName: weirdName,
      contents: "{}",
    });

    // No sanitization happens on the fallback path (download.ts:42-46).
    expect((capturedAnchor as HTMLAnchorElement | null)?.download).toBe(
      weirdName,
    );
    expect(clickSpy).toHaveBeenCalledOnce();
  });
});

describe("openTextFileWithPicker — native cancel contract", () => {
  it("resolves to null when the user aborts the native picker", async () => {
    // Documented contract (download.ts:51-52, 91-99): cancel → null,
    // regardless of which API fired. The native path catches
    // AbortError and returns null.
    const picker = mockPicker("showOpenFilePicker");
    picker.mockRejectedValue(
      new DOMException("The user aborted a request.", "AbortError"),
    );

    await expect(openTextFileWithPicker({})).resolves.toBeNull();
  });
});

describe("openTextFileWithPicker — <input> fallback", () => {
  // Mirrors the makePatchedInput helper in download.test.ts: a real
  // jsdom <input> whose `files` and `change` listener we control.
  function makePatchedInput(
    realCreate: (tag: string) => HTMLElement,
    files: File[],
  ): HTMLElement {
    const input = realCreate("input");
    Object.defineProperty(input, "files", {
      value: files,
      configurable: true,
    });
    input.addEventListener = vi.fn(((
      event: string,
      cb: () => void,
    ) => {
      if (event === "change") queueMicrotask(cb);
    }) as unknown as HTMLInputElement["addEventListener"]);
    input.click = vi.fn();
    return input;
  }

  it("resolves to null when no file is selected (empty file list)", async () => {
    expect(
      typeof (window as unknown as Record<string, unknown>)
        .showOpenFilePicker,
    ).toBe("undefined");

    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) =>
      tag === "input" ? makePatchedInput(realCreate, []) : realCreate(tag),
    );

    await expect(openTextFileWithPicker({})).resolves.toBeNull();
  });

  it("propagates the `accept` param to the input element", async () => {
    expect(
      typeof (window as unknown as Record<string, unknown>)
        .showOpenFilePicker,
    ).toBe("undefined");

    let capturedInput: HTMLInputElement | null = null;
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = makePatchedInput(realCreate, []) as HTMLInputElement;
      if (tag === "input") capturedInput = el;
      return el;
    });

    // Drive the change event so the promise settles instead of hanging
    // on the focus-cancel timer.
    await openTextFileWithPicker({ accept: ".csv,text/csv" });

    // download.ts:114 — the input fallback uses params.accept.
    expect((capturedInput as HTMLInputElement | null)?.accept).toBe(
      ".csv,text/csv",
    );
  });
});

describe("openTextFileWithPicker — accept param on the native path", () => {
  // FIXED: the native picker now forwards `params.accept` (parsed from the
  // freeform comma string into the FSA `Record<MIME, extension[]>` shape)
  // instead of hardcoding JSON. The `<input>` fallback already honored
  // `accept`, so the two paths now agree for any caller.

  it("forwards the `accept` param to the native picker types array", async () => {
    const picker = mockPicker("showOpenFilePicker");
    const fakeHandle = {
      async getFile() {
        return { async text() { return "x"; } };
      },
    };
    picker.mockResolvedValue([fakeHandle]);

    await openTextFileWithPicker({ accept: "text/csv,.csv" });

    expect(picker).toHaveBeenCalledOnce();
    const arg = picker.mock.calls[0][0];
    // The MIME type lands as a key; the extension associates with it
    // (the parser pairs every extension with every declared MIME).
    expect(arg.types[0].accept).toEqual({ "text/csv": [".csv"] });
  });

  // Pin the default: when no `accept` is supplied, the native path falls
  // back to the JSON default (matches the `<input>` fallback's default).
  it("defaults to application/json on the native path when accept is absent", async () => {
    const picker = mockPicker("showOpenFilePicker");
    const fakeHandle = {
      async getFile() {
        return { async text() { return "x"; } };
      },
    };
    picker.mockResolvedValue([fakeHandle]);

    await openTextFileWithPicker({});

    const arg = picker.mock.calls[0][0];
    expect(arg.types[0].accept).toEqual({
      "application/json": [".json"],
    });
  });
});

describe("download — SSR guard in jsdom", () => {
  // In jsdom `typeof window === "undefined"` is always false, so the SSR
  // early-return can't be exercised directly without deleting
  // globalThis.window (the existing download.test.ts does that for the
  // SSR path). Here we just pin the weaker contract: in a jsdom
  // environment both entry points dispatch normally rather than throwing
  // from the SSR guard.

  it("saveTextFileWithPicker does not throw in jsdom (no SSR short-circuit)", async () => {
    expect(
      typeof (window as unknown as Record<string, unknown>)
        .showSaveFilePicker,
    ).toBe("undefined");

    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fake-url");
    vi.spyOn(URL, "revokeObjectURL");
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = realCreate(tag);
      if (tag === "a") (el as HTMLAnchorElement).click = vi.fn();
      return el;
    });

    await expect(
      saveTextFileWithPicker({ suggestedName: "x.json", contents: "{}" }),
    ).resolves.toBeUndefined();
  });

  it("openTextFileWithPicker does not throw in jsdom (no SSR short-circuit)", async () => {
    expect(
      typeof (window as unknown as Record<string, unknown>)
        .showOpenFilePicker,
    ).toBe("undefined");

    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) =>
      tag === "input"
        ? (() => {
            const input = realCreate("input");
            Object.defineProperty(input, "files", {
              value: [],
              configurable: true,
            });
            input.addEventListener = vi.fn();
            input.click = vi.fn();
            return input;
          })()
        : realCreate(tag),
    );

    // We don't await the full promise (it hangs on the focus-cancel
    // timer). Just pin that calling it doesn't throw synchronously —
    // the SSR guard at download.ts:69 didn't short-circuit.
    expect(() => openTextFileWithPicker({})).not.toThrow();
  });
});
