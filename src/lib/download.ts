// src/lib/download.ts

// export function downloadTextFile(params: {
//   filename: string;
//   contents: string;
//   mimeType?: string;
// }) {
//   const blob = new Blob([params.contents], {
//     type: params.mimeType ?? "application/json",
//   });
//
//   const url = URL.createObjectURL(blob);
//   const anchor = document.createElement("a");
//
//   anchor.href = url;
//   anchor.download = params.filename;
//   anchor.click();
//
//   URL.revokeObjectURL(url);
// }

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
