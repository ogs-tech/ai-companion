export interface FileBrowserEntry {
  name: string;
  kind: 'file' | 'dir';
  size?: number;
}

export type FilePreview =
  | { previewable: true; content: string; truncated: boolean }
  | { previewable: false; reason: string };

export interface FileBrowserPort {
  listDir(absPath: string): Promise<FileBrowserEntry[]>;
  readFile(absPath: string): Promise<FilePreview>;
  realpath(absPath: string): Promise<string>;
}
