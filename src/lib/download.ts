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
    let fileHandle;
    try {
      fileHandle = await saveFilePicker.call(window, {
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
    } catch (err) {
      // FSA rejects with AbortError when the user cancels the save dialog —
      // treat it as a no-op (mirrors the open path's cancel contract).
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }
      throw err;
    }

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

// Open a text file via a native picker and return its contents, or
// `null` if the user cancels. Prefers the File System Access API
// (`showOpenFilePicker`); falls back to a hidden `<input type="file">`
// whose cancel is detected via a window-focus listener (focus returns
// without a `change` event). Both paths share the string-or-null contract.
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
            // Parse the freeform `accept` for the FSA shape so a
            // non-default caller isn't forced onto a hardcoded JSON
            // picker on the native path.
            accept: parseAcceptForFsa(accept),
          },
        ],
      });
    } catch (err) {
      // FSA rejects with AbortError on cancel — match the fallback's
      // null contract.
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

    // Cancel detection: dismissal returns focus without a `change`; give
    // it a beat, then settle on cancel.
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
 * Parse the freeform `accept` string (comma-separated MIME types and/or
 * extensions, e.g. `"application/json,.json"`, `".png,.jpg"`) into the
 * `Record<MIME, extension[]>` shape the File System Access API wants.
 *
 * Tokens starting with `.` are extensions, others are MIMEs. Extensions
 * are associated with every declared MIME; extension-only input lands
 * under the catch-all `application/octet-stream`; MIMEs with no extension
 * get `[".*"]`. Used only by the native path; the `<input>` fallback
 * consumes the raw `accept` string. Not a perfect translation (FSA is
 * MIME->extensions, `<input>` is an OR-list) but preserves caller intent
 * for the common cases.
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

  // Associate every extension with every declared MIME.
  const result: Record<string, string[]> = {};
  for (const mime of mimes) {
    result[mime] = extensions.length > 0 ? [...extensions] : [".*"];
  }
  return result;
}