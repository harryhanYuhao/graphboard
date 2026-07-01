// src/types/file-system-access.d.ts

export {};

declare global {
  interface Window {
    showSaveFilePicker?: (options?: {
      suggestedName?: string;
      types?: Array<{
        description: string;
        accept: Record<string, string[]>;
      }>;
    }) => Promise<FileSystemFileHandle>;
  }

  interface FileSystemFileHandle {
    createWritable: () => Promise<FileSystemWritableFileStream>;
  }

  interface FileSystemWritableFileStream {
    write: (data: string | Blob | BufferSource) => Promise<void>;
    close: () => Promise<void>;
  }
}
