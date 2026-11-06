import type { RevealTarget } from './editor-navigation.js';

// Module-scoped, same shape as `workspace-area-store.ts`: the command palette
// sits above WorkspaceScreen and has no prop path to its tab state. The screen
// registers how to open a file (optionally revealing a line) while mounted.

type FileOpener = (relPath: string, reveal?: RevealTarget) => void;

let opener: FileOpener | null = null;
let externalOpener: ((absPaths: string[]) => void) | null = null;

export function registerFileOpener(next: FileOpener | null): void {
  opener = next;
}

/** A no-op if WorkspaceScreen isn't mounted. */
export function openFile(relPath: string, reveal?: RevealTarget): void {
  opener?.(relPath, reveal);
}

/** Opens files already granted by main (the native picker) as editable external tabs. */
export function registerExternalFileOpener(next: ((absPaths: string[]) => void) | null): void {
  externalOpener = next;
}

export function openExternalFile(absPaths: string[]): void {
  externalOpener?.(absPaths);
}
