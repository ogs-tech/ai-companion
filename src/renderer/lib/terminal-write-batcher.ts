/**
 * Coalesces PTY output chunks into one `write` per animation frame.
 *
 * A noisy process (dev server, build, watcher) emits many small chunks; writing
 * each one straight to xterm repaints and scrolls once per chunk, which shows up
 * as flicker. Chunks are concatenated in order, so no output is lost or reordered.
 */
export interface TerminalWriteBatcher {
  push(chunk: string): void;
  /** Writes whatever is pending right now. */
  flush(): void;
  /** Drops the pending frame without writing — for teardown. */
  cancel(): void;
}

export function createTerminalWriteBatcher(
  write: (data: string) => void,
  schedule: (cb: () => void) => number = (cb) => requestAnimationFrame(cb),
  unschedule: (handle: number) => void = (handle) => cancelAnimationFrame(handle),
): TerminalWriteBatcher {
  let pending = '';
  let handle: number | null = null;

  const flush = (): void => {
    if (handle !== null) {
      unschedule(handle);
      handle = null;
    }
    if (pending === '') return;
    const data = pending;
    pending = '';
    write(data);
  };

  return {
    push(chunk) {
      pending += chunk;
      if (handle === null) handle = schedule(flush);
    },
    flush,
    cancel() {
      if (handle !== null) unschedule(handle);
      handle = null;
      pending = '';
    },
  };
}
