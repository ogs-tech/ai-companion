import type { FileBrowserEntry, FilePreview } from '../../../shared/file-browser.js';

export type { FileBrowserEntry, FilePreview };

export interface FileBrowserPort {
  /** `showHidden` reveals dot-entries, except `.git` and `.DS_Store`, which are never listed. */
  listDir(absPath: string, options?: { showHidden?: boolean }): Promise<FileBrowserEntry[]>;
  readFile(absPath: string): Promise<FilePreview>;
  writeFile(absPath: string, content: string): Promise<void>;
  realpath(absPath: string): Promise<string>;
}
