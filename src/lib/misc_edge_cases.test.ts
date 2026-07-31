// Edge-case coverage for three pure modules whose main suites cover only the
// happy paths:
//   - vertex-types.ts — `isBoundaryVertex` plus `input`/`output` registry metadata.
//   - edge-geometry.ts — rotations 0/45/360/-90 and NaN/Infinity degenerate input.
//   - download.ts — anchor Blob content type/filename, custom MIME propagation,
//     and the `accept` param on both native and fallback paths.
// One behavior per test.

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
    // Strict equality against 'input'/'output'; an unknown string misses both.
    expect(isBoundaryVertex("nonsense" as VertexType)).toBe(false);
  });
});

describe("VERTEX_TYPES registry — boundary entries", () => {
  // The main suite's `allTypes` array omits input/output; fill that gap.

  it("includes an 'input' entry with sensible shape / color / size", () => {
    const meta = VERTEX_TYPE_MAP.input;
    expect(meta).toBeDefined();
    expect(meta.type).toBe("input");
    expect(meta.shape).toBe("circle");
    expect(meta.size).toBeGreaterThan(0);
    // Boundary markers render as blue-dotted circles.
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
    // A duplicate would silently overwrite one entry's metadata in the map.
    const seen = new Set<VertexType>();
    for (const meta of VERTEX_TYPES) {
      expect(seen.has(meta.type)).toBe(false);
      seen.add(meta.type);
    }
  });

  it("every entry has the required base fields", () => {
    // Derived fields (radiusClass / isTriangle) are checked separately below.
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
    // W is the only triangle; a sample that enrich() derived both from shape.
    const w = VERTEX_TYPE_MAP.w;
    expect(w.shape).toBe("triangle");
    expect(w.isTriangle).toBe(true);
    // Triangles are clipped to their silhouette, so radiusClass is empty.
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
    // `z` is the default the side menu and empty-graph factory assume.
    expect(DEFAULT_VERTEX_TYPE).toBe("z");
  });
});

describe("isSpiderType / isDirectionalVertex — parametric re-pin", () => {
  // Parametric over the full 10-type union (including input/output).

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
// Inline factory so the rotation cases stay readable (the main suite hides
// the same shape behind a local `node()` helper).
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
    // 40x40 at (0,0) → center (20,20); symmetric = no local offset.
    expectPoint(getEdgeEndpoint(endpoint(), "target"), { x: 20, y: 20 });
  });

  it("anchors a directional target on the top edge (W / And)", () => {
    // Top dot: offset (0, -height/2) = (0, -20) → y=0.
    expectPoint(
      getEdgeEndpoint(endpoint({ vertexType: "w" }), "target"),
      { x: 20, y: 0 },
    );
  });
});

describe("getEdgeEndpoint — non-axis-aligned rotation", () => {
  it("rotates the directional top dot 45° clockwise around the center", () => {
    // Top dot local offset (0, -20) rotated 45° CW (y-down) ≈ (34.142, 5.858).
    expectPoint(
      getEdgeEndpoint(endpoint({ vertexType: "w", rotation: 45 }), "target"),
      { x: 20 + 20 * Math.SQRT1_2, y: 20 - 20 * Math.SQRT1_2 },
    );
  });
});

describe("getEdgeEndpoint — full-circle and negative rotations", () => {
  it("treats 360° as equivalent to 0° (top dot stays on the top edge)", () => {
    // 360° rotates the offset back onto itself modulo ~1e-15 float noise.
    expectPoint(
      getEdgeEndpoint(
        endpoint({ vertexType: "w", rotation: 360 }),
        "target",
      ),
      { x: 20, y: 0 },
    );
  });

  it("treats -90° as equivalent to 270° (top dot moves to the left edge)", () => {
    // (0, -20) rotated -90° CW → (0, 20), the left edge center.
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
    // Node at (100, 50): center (120, 70); top dot rotated 90° CW → (140, 70).
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
    // localY = +height/3 for the source role.
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
  // edge-geometry normalizes rotation at the boundary: NaN/±Infinity → 0,
  // reals wrapped to [0, 360). The 0° fast path is also the recovery path,
  // so a stray NaN from an unhydrated view field can't send the edge to (NaN, NaN).

  it("returns a finite point for a NaN rotation (falls back to 0)", () => {
    const result = getEdgeEndpoint(
      endpoint({ vertexType: "w", rotation: NaN }),
      "target",
    );
    expect(Number.isFinite(result.x)).toBe(true);
    expect(Number.isFinite(result.y)).toBe(true);
    // NaN → 0 → top edge for the 40×40 fixture at (0,0): (20, 0).
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
// Mocking mirrors download.test.ts: install the FSA pickers on `window` via
// Object.defineProperty (vi.spyOn refuses on a missing property), drive with
// vi.fn(), tear down in afterEach.
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

    // Spy on the Blob constructor to capture the options (jsdom's Blob is real,
    // but we replace it to assert on `type`).
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

    // Default MIME is application/json.
    expect(blobCtor).toHaveBeenCalledOnce();
    expect(blobCtor).toHaveBeenCalledWith(["hello"], {
      type: "application/json",
    });
    // The filename flows to the anchor's `download` attribute.
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

    // An empty suggestedName flows straight into anchor.download with no
    // validation; browsers treat that as "use the blob's default name".
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

    // No sanitization on the fallback path.
    expect((capturedAnchor as HTMLAnchorElement | null)?.download).toBe(
      weirdName,
    );
    expect(clickSpy).toHaveBeenCalledOnce();
  });
});

describe("openTextFileWithPicker — native cancel contract", () => {
  it("resolves to null when the user aborts the native picker", async () => {
    // Contract: cancel → null regardless of which API fired; the native path
    // catches AbortError.
    const picker = mockPicker("showOpenFilePicker");
    picker.mockRejectedValue(
      new DOMException("The user aborted a request.", "AbortError"),
    );

    await expect(openTextFileWithPicker({})).resolves.toBeNull();
  });
});

describe("openTextFileWithPicker — <input> fallback", () => {
  // Mirrors the makePatchedInput helper in download.test.ts.
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

    // Drive the change event so the promise settles instead of hanging.
    await openTextFileWithPicker({ accept: ".csv,text/csv" });

    // The input fallback uses params.accept.
    expect((capturedInput as HTMLInputElement | null)?.accept).toBe(
      ".csv,text/csv",
    );
  });
});

describe("openTextFileWithPicker — accept param on the native path", () => {
  // The native picker forwards `params.accept` (parsed from the freeform comma
  // string into the FSA `Record<MIME, extension[]>` shape); the input fallback
  // already honored it, so the two paths agree.

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
    // The MIME type is the key; the extension pairs with it.
    expect(arg.types[0].accept).toEqual({ "text/csv": [".csv"] });
  });

  // With no `accept`, the native path falls back to the JSON default.
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
  // In jsdom `typeof window` is always defined, so the SSR early-return can't
  // be hit directly. Pin the weaker contract: both entry points dispatch
  // normally rather than throwing from the SSR guard.

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

    // Don't await the promise (it hangs on the focus-cancel timer); just pin
    // that calling it doesn't throw synchronously.
    expect(() => openTextFileWithPicker({})).not.toThrow();
  });
});
