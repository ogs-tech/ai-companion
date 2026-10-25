// Module-scoped, same shape as `workspace-shell-store.ts`: the Explorer toolbar
// (WorkspaceScreen) flips the flag while every `useDirListing` deep inside
// FolderTree reads it through `useSyncExternalStore`, with no prop path between.
// Persisted per viewer so the choice survives a restart.

const STORAGE_KEY = 'ai-companion.explorer.showHidden';
const listeners = new Set<() => void>();

function readStored(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

let showHidden = readStored();

export function getShowHiddenFiles(): boolean {
  return showHidden;
}

export function setShowHiddenFiles(next: boolean): void {
  if (next === showHidden) return;
  showHidden = next;
  try {
    localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
  } catch {
    // Storage unavailable: the flag still works for this session.
  }
  for (const listener of listeners) listener();
}

export function subscribeShowHiddenFiles(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
