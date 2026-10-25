import { watch as chokidarWatch } from 'chokidar';
import type { FileWatcherHandle, FileWatcherPort } from '../../application/ports/file-watcher-port.js';

export interface ChokidarFileWatcherOptions {
  /** How long (ms) a file must sit unchanged before its write is considered settled — keeps a multi-chunk write from being reported mid-flight. Defaults to 300ms; tests pass a much shorter value to stay fast. */
  stabilityThresholdMs?: number;
}

export class ChokidarFileWatcher implements FileWatcherPort {
  constructor(private readonly options: ChokidarFileWatcherOptions = {}) {}

  watch(patterns: string[], onChange: (absolutePath: string) => void): FileWatcherHandle {
    const watcher = chokidarWatch(patterns, {
      // Only care about changes made while the watcher is running — an
      // `ignoreInitial: false` scan would fire "add" for every entity file
      // already on disk at startup, causing a needless full-workspace re-sync.
      ignoreInitial: true,
      // `fs.watch` on a unix socket (the link-routing socket under `~/.ai-companion/run/`) fails with UNKNOWN.
      ignored: (_path, stats) => stats?.isSocket() === true,
      awaitWriteFinish: {
        stabilityThreshold: this.options.stabilityThresholdMs ?? 300,
        pollInterval: 100,
      },
    });
    // chokidar's 'add'/'change' listeners receive (path, stats) — narrow to
    // the single-arg shape the port promises, rather than leaking stats through.
    watcher.on('add', (path) => onChange(path));
    watcher.on('change', (path) => onChange(path));
    // Without a listener an unwatchable path surfaces as an unhandled rejection that takes the main process down.
    watcher.on('error', (error) => console.error('[file-watcher]', error));
    return { close: () => watcher.close() };
  }
}
