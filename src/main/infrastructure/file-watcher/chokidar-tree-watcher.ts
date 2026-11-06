import { watch as chokidarWatch } from 'chokidar';
import type { FileWatcherHandle } from '../../application/ports/file-watcher-port.js';
import type { TreeWatcherPort } from '../../application/ports/tree-watcher-port.js';

const MAX_DEPTH = 8;

export class ChokidarTreeWatcher implements TreeWatcherPort {
  watch(roots: string[], ignoredDirNames: readonly string[], onEntryChange: (absPath: string) => void): FileWatcherHandle {
    const ignored = new Set(ignoredDirNames);
    const watcher = chokidarWatch(roots, {
      ignoreInitial: true,
      followSymlinks: false,
      depth: MAX_DEPTH,
      ignored: (path, stats) => stats?.isSocket() === true || path.split(/[/\\]/).some((seg) => ignored.has(seg)),
    });
    for (const event of ['add', 'unlink', 'addDir', 'unlinkDir'] as const) {
      watcher.on(event, (path) => onEntryChange(path));
    }
    watcher.on('error', (error) => console.error('[tree-watcher]', error));
    return { close: () => watcher.close() };
  }
}
