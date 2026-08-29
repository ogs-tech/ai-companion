import type { FileBrowserEntry, FilePreview } from '../../../shared/file-browser.js';

export type { FileBrowserEntry, FilePreview };

export interface FileBrowserPort {
  listDir(absPath: string): Promise<FileBrowserEntry[]>;
  readFile(absPath: string): Promise<FilePreview>;
  writeFile(absPath: string, content: string): Promise<void>;
  realpath(absPath: string): Promise<string>;
}
