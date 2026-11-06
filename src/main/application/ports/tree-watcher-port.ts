import type { FileWatcherHandle } from './file-watcher-port.js';

/**
 * Watches folders for entries appearing or disappearing (not content edits),
 * ignoring the given directory names. `onEntryChange` receives the changed
 * entry's absolute path.
 */
export interface TreeWatcherPort {
  watch(roots: string[], ignoredDirNames: readonly string[], onEntryChange: (absPath: string) => void): FileWatcherHandle;
}
