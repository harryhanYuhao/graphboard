// JSON export/import pipeline. Two strategies per direction:
//   save: native showSaveFilePicker  |  <a download> blob fallback
//   open: native showOpenFilePicker  |  <input type=file> fallback
//
// jsdom lacks the File System Access API, so native paths install the picker
// on `window` via Object.defineProperty (vi.spyOn refuses on a missing
// property) and drive it with vi.fn(). Fallback paths exercise real DOM
// (Blob, URL.createObjectURL, a patched <input>) against jsdom.
//
// Contract: saveTextFileWithPicker writes contents and returns void;
// openTextFileWithPicker returns the file text, or null on cancel.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  openTextFileWithPicker,
  saveTextFileWithPicker,
} from "./download";

// Install (or replace) an FSA picker on `window` with a vi.fn(); returns the
// mock so a test can program its return value.
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

// Fake FileSystemFileHandle: records write() calls and tracks close().
function makeFakeFileHandle() {
  const writes: string[] = [];
  let closed = false;
  return {
    writes,
    isClosed: () => closed,
    handle: {
      async createWritable() {
        return {
          async write(chunk: string) {
            writes.push(chunk);
          },
          async close() {
            closed = true;
          },
        };
      },
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  // Remove any picker mocks so fallback-path tests see an absent API.
  delete (window as unknown as Record<string, unknown>).showSaveFilePicker;
  delete (window as unknown as Record<string, unknown>).showOpenFilePicker;
  document.body.innerHTML = "";
});

// ── saveTextFileWithPicker ─────────────────────────────────────────

describe("saveTextFileWithPicker", () => {
  it("is a no-op on the server (typeof window === 'undefined' guard)", async () => {
    const original = globalThis.window;
    // @ts-expect-error — intentionally undefined for the SSR guard test
    delete globalThis.window;
    try {
      // No assertion needed; must not throw and must not touch the DOM.
      await saveTextFileWithPicker({
        suggestedName: "x.json",
        contents: "{}",
      });
    } finally {
      globalThis.window = original;
    }
  });

  describe("native File System Access API path", () => {
    it("writes the contents to the picked file and closes the stream", async () => {
      const fake = makeFakeFileHandle();
      const picker = mockPicker("showSaveFilePicker");
      picker.mockResolvedValue(fake.handle);

      await saveTextFileWithPicker({
        suggestedName: "graph.json",
        contents: '{"a":1}',
      });

      expect(picker).toHaveBeenCalledOnce();
      expect(picker).toHaveBeenCalledWith(
        expect.objectContaining({ suggestedName: "graph.json" }),
      );
      expect(fake.writes).toEqual(['{"a":1}']);
      expect(fake.isClosed()).toBe(true);
    });

    it("defaults mimeType to application/json and extension to .json", async () => {
      const fake = makeFakeFileHandle();
      const picker = mockPicker("showSaveFilePicker");
      picker.mockResolvedValue(fake.handle);

      await saveTextFileWithPicker({
        suggestedName: "x.json",
        contents: "{}",
      });

      const typesArg = picker.mock.calls[0][0].types[0];
      expect(typesArg.accept).toHaveProperty("application/json");
      expect(typesArg.accept["application/json"]).toEqual([".json"]);
    });

    it("honors a custom mimeType and extension", async () => {
      const fake = makeFakeFileHandle();
      const picker = mockPicker("showSaveFilePicker");
      picker.mockResolvedValue(fake.handle);

      await saveTextFileWithPicker({
        suggestedName: "graph.csv",
        contents: "a,b",
        mimeType: "text/csv",
        extension: ".csv",
      });

      const typesArg = picker.mock.calls[0][0].types[0];
      expect(typesArg.accept["text/csv"]).toEqual([".csv"]);
    });
  });

  describe("anchor-download fallback (no native picker)", () => {
    it("creates a Blob and triggers an anchor download", async () => {
      // No native picker is present (fallback path).
      expect(
        typeof (window as unknown as Record<string, unknown>)
          .showSaveFilePicker,
      ).toBe("undefined");

      const createObjectURL = vi
        .spyOn(URL, "createObjectURL")
        .mockReturnValue("blob:fake-url");
      const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL");
      const clickSpy = vi.fn();

      // Capture the <a> and stub click (jsdom doesn't navigate on click);
      // return a real anchor so property assignments work normally.
      const realCreate = document.createElement.bind(document);
      vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
        const el = realCreate(tag);
        if (tag === "a") (el as HTMLAnchorElement).click = clickSpy;
        return el;
      });

      await saveTextFileWithPicker({
        suggestedName: "fallback.json",
        contents: "hello",
      });

      expect(createObjectURL).toHaveBeenCalledOnce();
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:fake-url");
      expect(clickSpy).toHaveBeenCalledOnce();
    });
  });
});

// ── openTextFileWithPicker ─────────────────────────────────────────

describe("openTextFileWithPicker", () => {
  it("returns null on the server (typeof window === 'undefined' guard)", async () => {
    const original = globalThis.window;
    // @ts-expect-error — intentionally undefined for the SSR guard test
    delete globalThis.window;
    try {
      expect(await openTextFileWithPicker({})).toBeNull();
    } finally {
      globalThis.window = original;
    }
  });

  describe("native File System Access API path", () => {
    it("reads and returns the file text via handle.getFile().text()", async () => {
      const fakeHandle = {
        async getFile() {
          return { async text() { return '{"imported":true}'; } };
        },
      };
      const picker = mockPicker("showOpenFilePicker");
      picker.mockResolvedValue([fakeHandle]);

      const result = await openTextFileWithPicker({});
      expect(result).toBe('{"imported":true}');
    });

    // Native picker rejects with AbortError on cancel; the wrapper catches it
    // and resolves to null per the `string | null` contract.
    it("returns null when the user cancels the native picker (per contract)", async () => {
      const picker = mockPicker("showOpenFilePicker");
      picker.mockRejectedValue(
        new DOMException("The user aborted a request.", "AbortError"),
      );

      await expect(openTextFileWithPicker({})).resolves.toBeNull();
    });
  });

  describe("<input type=file> fallback (no native picker)", () => {
    // Real jsdom <input> with `files` and a stubbed change listener. jsdom's
    // `files` is read-only, and `change` must fire on the next microtask (after
    // the caller attaches its listener). Takes the real (un-spied) createElement
    // so it doesn't recurse into the spy.
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
      })) as unknown as HTMLInputElement["addEventListener"];
      input.click = vi.fn();
      return input;
    }

    it("resolves with file text on a change event", async () => {
      expect(
        typeof (window as unknown as Record<string, unknown>)
          .showOpenFilePicker,
      ).toBe("undefined");

      const fileText = "fallback-contents";
      const realCreate = document.createElement.bind(document);
      vi.spyOn(document, "createElement").mockImplementation((tag: string) =>
        tag === "input"
          ? makePatchedInput(
              realCreate,
              [new File([fileText], "g.json", { type: "application/json" })],
            )
          : realCreate(tag),
      );

      const result = await openTextFileWithPicker({});
      expect(result).toBe(fileText);
    });

    it("resolves with null when no file is selected", async () => {
      const realCreate = document.createElement.bind(document);
      vi.spyOn(document, "createElement").mockImplementation((tag: string) =>
        tag === "input" ? makePatchedInput(realCreate, []) : realCreate(tag),
      );

      expect(await openTextFileWithPicker({})).toBeNull();
    });
  });
});
