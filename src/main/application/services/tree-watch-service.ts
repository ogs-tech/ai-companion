import { dirname, relative } from 'node:path';
import type { FileWatcherHandle } from '../ports/file-watcher-port.js';
import type { TreeWatcherPort } from '../ports/tree-watcher-port.js';
import type { FileBrowserService } from './file-browser-service.js';
import { DEFAULT_IGNORED_DIRS, type WorkspaceTreeChangedEvent } from '../../../shared/file-ops.js';

const DEBOUNCE_MS = 300;

/** Reports which workspace directories changed their listing, debounced and mapped to workspace-relative paths. */
export class TreeWatchService {
  private handle: FileWatcherHandle | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly pending = new Set<string>();
  private readonly listeners = new Set<(event: WorkspaceTreeChangedEvent) => void>();

  constructor(
    private readonly watcher: TreeWatcherPort,
    private readonly browser: FileBrowserService,
    private readonly debounceMs: number = DEBOUNCE_MS,
  ) {}

  onTreeChanged(listener: (event: WorkspaceTreeChangedEvent) => void): void {
    this.listeners.add(listener);
  }

  start(): void {
    if (this.handle !== null) return;
    const roots = this.browser.roots();
    this.handle = this.watcher.watch(
      roots.map((r) => r.root),
      DEFAULT_IGNORED_DIRS,
      (absPath) => this.record(absPath, roots),
    );
  }

  async stop(): Promise<void> {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.pending.clear();
    const handle = this.handle;
    this.handle = null;
    await handle?.close();
  }

  private record(absPath: string, roots: { prefix: string; root: string }[]): void {
    const dir = dirname(absPath);
    for (const { prefix, root } of roots) {
      const rel = relative(root, dir);
      if (rel.startsWith('..')) continue;
      const inside = rel.split(/[/\\]/).filter((seg) => seg !== '').join('/');
      this.pending.add([prefix, inside].filter((part) => part !== '').join('/'));
      break;
    }
    if (this.timer === null) this.timer = setTimeout(() => this.flush(), this.debounceMs);
  }

  private flush(): void {
    this.timer = null;
    if (this.pending.size === 0) return;
    const event: WorkspaceTreeChangedEvent = { dirs: [...this.pending] };
    this.pending.clear();
    for (const listener of this.listeners) listener(event);
  }
}
