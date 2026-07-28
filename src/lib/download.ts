// src/lib/download.ts

export async function saveTextFileWithPicker(params: {
  suggestedName: string;
  contents: string;
  mimeType?: string;
  extension?: string;
}) {
  const mimeType = params.mimeType ?? "application/json";
  const extension = params.extension ?? ".json";

  if (typeof window === "undefined") {
    return;
  }

  const saveFilePicker = window.showSaveFilePicker;

  if (typeof saveFilePicker === "function") {
    const fileHandle = await saveFilePicker.call(window, {
      suggestedName: params.suggestedName,
      types: [
        {
          description: "JSON file",
          accept: {
            [mimeType]: [extension],
          },
        },
      ],
    });

    const writable = await fileHandle.createWritable();
    await writable.write(params.contents);
    await writable.close();

    return;
  }

  const blob = new Blob([params.contents], {
    type: mimeType,
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = params.suggestedName;
  anchor.click();

  URL.revokeObjectURL(url);
}

// Open a text file via a native picker and read its contents. Returns the
// file contents as a string, or `null` if the user cancels.
//
// Strategy:
//   1. Prefer the File System Access API (`showOpenFilePicker`) when
//      available — gives a real OS file dialog without a transient DOM
//      element.
//   2. Fall back to a hidden `<input type="file">` driven by an in-memory
//      click. Cancel detection on the fallback path is via a short
//      window-focus listener — when the user dismisses the picker without
//      selecting, focus returns to the window without a `change` event.
//
// Both paths yield the same string-or-null contract; callers don't have
// to care which API fired.
export async function openTextFileWithPicker(params: {
  accept?: string;
  description?: string;
}): Promise<string | null> {
  if (typeof window === "undefined") {
    return null;
  }

  const accept = params.accept ?? "application/json,.json";
  const description = params.description ?? "JSON file";

  const openFilePicker = window.showOpenFilePicker;

  if (typeof openFilePicker === "function") {
    let handle;
    try {
      [handle] = await openFilePicker.call(window, {
        multiple: false,
        types: [
          {
            description,
            // The FSA API wants `Record<MIME, extension[]>`, but our
            // `accept` param is the freeform comma-separated string the
            // `<input accept>` fallback consumes (e.g.
            // `"application/json,.json"` or `"text/csv"`). Parse it the
            // same way for both paths so a caller passing a non-default
            // accept doesn't get a hardcoded JSON picker on the native
            // path and the right one on the fallback.
            accept: parseAcceptForFsa(accept),
          },
        ],
      });
    } catch (err) {
      // The File System Access API rejects with AbortError when the user
      // cancels the picker. The fallback path resolves to null in that
      // case — match it here so callers see a uniform string-or-null
      // contract regardless of which API fired.
      if (err instanceof DOMException && err.name === "AbortError") {
        return null;
      }
      throw err;
    }
    const file = await handle.getFile();
    return file.text();
  }

  return new Promise<string | null>((resolve) => {
    let settled = false;
    const settle = (value: string | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.style.display = "none";

    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) {
        settle(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        settle(typeof reader.result === "string" ? reader.result : null);
      };
      reader.onerror = () => settle(null);
      reader.readAsText(file);
    });

    // Cancel detection: when the user dismisses the picker without
    // selecting, focus returns to the window but no `change` fires.
    // We give the picker a beat to either fire change or settle on cancel.
    const onFocus = () => {
      window.removeEventListener("focus", onFocus);
      window.setTimeout(() => settle(null), 300);
    };
    window.addEventListener("focus", onFocus);

    document.body.appendChild(input);
    input.click();
    document.body.removeChild(input);
  });
}

/**
 * Parse the freeform `accept` string (the same format `<input accept>`
 * takes — comma-separated MIME types and/or extensions, e.g.
 * `"application/json,.json"` or `"text/csv"` or `".png,.jpg"`) into the
 * `Record<MIME, extension[]>` shape the File System Access API wants.
 *
 * Heuristic: tokens starting with `.` are extensions; others are MIME
 * types. Every extension is associated with every MIME present (so
 * `"application/json,.json"` → `{ "application/json": [".json"] }` and
 * `"text/csv,.json"` → `{ "text/csv": [".json"] }`). When no MIME is
 * present (extension-only input like `".png,.jpg"`), extensions land
 * under the catch-all `application/octet-stream` so the picker still
 * filters on them — matching the permissive behavior of the `<input>`
 * fallback, which treats extensions alone as valid. MIME types with no
 * extension get a `[".*"]` wildcard so the picker accepts the type
 * broadly.
 *
 * Used only by the native `showOpenFilePicker` path; the `<input>` fallback
 * consumes the raw `accept` string directly. This isn't a perfect
 * translation (the FSA API's model is MIME→extensions, the `<input>`
 * model is an OR-list), but it preserves caller intent for the common
 * cases and keeps the two paths from diverging on a hardcoded JSON.
 */
function parseAcceptForFsa(accept: string): Record<string, string[]> {
  const tokens = accept
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  const mimes: string[] = [];
  const extensions: string[] = [];
  for (const token of tokens) {
    if (token.startsWith(".")) extensions.push(token);
    else mimes.push(token);
  }

  // No MIME declared — group bare extensions under the catch-all.
  if (mimes.length === 0) {
    return extensions.length > 0
      ? { "application/octet-stream": extensions }
      : { "application/octet-stream": [".*"] };
  }

  // Associate every extension with every declared MIME (an over-approx,
  // but the OR semantics of `<input accept>` don't map cleanly to FSA's
  // MIME→extension model, and this keeps the common single-MIME case
  // correct).
  const result: Record<string, string[]> = {};
  for (const mime of mimes) {
    result[mime] = extensions.length > 0 ? [...extensions] : [".*"];
  }
  return result;
}