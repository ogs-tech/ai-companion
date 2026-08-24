import type { FileBrowserEntry, FilePreview } from '../../../shared/file-browser.js';

export type { FileBrowserEntry, FilePreview };

export interface FileBrowserPort {
  listDir(absPath: string): Promise<FileBrowserEntry[]>;
  readFile(absPath: string): Promise<FilePreview>;
  realpath(absPath: string): Promise<string>;
}
