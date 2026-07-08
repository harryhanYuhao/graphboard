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
    const [handle] = await openFilePicker.call(window, {
      multiple: false,
      types: [
        {
          description,
          accept: { "application/json": [".json"] },
        },
      ],
    });
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