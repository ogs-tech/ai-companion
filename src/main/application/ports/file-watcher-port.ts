export interface FileWatcherHandle {
  close(): Promise<void>;
}

/**
 * Watches a fixed set of paths (files or directories, recursively) for
 * add/change events, debounced by the implementation until each file's write
 * has settled (so a multi-chunk write isn't reported mid-flight). Reports
 * every change under the given paths — filtering to the ones a caller
 * actually cares about is the caller's job, not this port's. One handle per
 * `watch()` call; `close()` stops it for good — there's no re-arming.
 */
export interface FileWatcherPort {
  watch(paths: string[], onChange: (absolutePath: string) => void): FileWatcherHandle;
}
