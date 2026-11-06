export type FsEntryKind = 'file' | 'dir' | 'other';

export interface FsDirEntry {
  name: string;
  /** `other` covers symlinks and special files — never followed. */
  kind: FsEntryKind;
}

/**
 * Raw mutating filesystem operations behind the Explorer's file operations and
 * project search. Every path is absolute and already validated by the caller
 * (`FileBrowserService.locate`); nothing here knows about workspaces.
 */
export interface FileOperationsPort {
  /** `lstat`-based: a symlink is `other`. `null` when nothing exists there. */
  stat(absPath: string): Promise<{ kind: FsEntryKind } | null>;
  /** Non-recursive unless asked; fails with EEXIST when the folder exists and `recursive` is false. */
  mkdir(absPath: string, options?: { recursive?: boolean }): Promise<void>;
  /** Fails with EEXIST rather than truncating an existing file. */
  createFile(absPath: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  /** Recursive copy that never overwrites (EEXIST). */
  copy(from: string, to: string): Promise<void>;
  /** Includes dot-entries. */
  readDir(absPath: string): Promise<FsDirEntry[]>;
  /** Removes a directory only if it is empty; rejects otherwise. */
  removeEmptyDir(absPath: string): Promise<void>;
  /** The file's text, or `null` when it is binary (NUL sniff) or larger than `maxBytes`. */
  readText(absPath: string, maxBytes: number): Promise<string | null>;
}
