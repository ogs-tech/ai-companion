export interface FileBrowserEntry {
  name: string;
  kind: 'file' | 'dir';
  size?: number;
}

export type FilePreview =
  | { previewable: true; content: string; truncated: boolean }
  | { previewable: false; reason: string };
