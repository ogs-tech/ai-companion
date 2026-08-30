import type { Entity, EntityKind } from '../../../shared/entity.js';
import { entityUrn } from '../../../shared/entity.js';
import type { EntityRepository } from '../ports/entity-repository.js';
import type { FileWatcherHandle, FileWatcherPort } from '../ports/file-watcher-port.js';
import type { AdapterManager } from './adapter-manager.js';
import { mapFilePathToEntity } from '../entity/entity-watch-path.js';

export interface EntityChangedEvent {
  kind: EntityKind;
  urn: string;
}

/**
 * Keeps adapter destinations (Claude symlinks, Cursor's materialized copies)
 * in sync with a workspace's canonical entity files even when they're edited
 * outside the app's own save() flow — e.g. a `claude` session (opened via a
 * tree row's "New Action") writing to a Skill/Agent/Instruction's source file
 * directly. Re-syncing (rather than the app's own `EntityService.save()`)
 * deliberately skips rename-detection and `updatedAt` stamping — those only
 * make sense for an app-driven save, not "the file on disk just changed."
 */
export class EntityWatchService {
  private handle: FileWatcherHandle | null = null;
  private readonly listeners = new Set<(event: EntityChangedEvent) => void>();

  constructor(
    private readonly dataDir: string,
    private readonly repository: Pick<EntityRepository, 'get'>,
    private readonly adapterManager: Pick<AdapterManager, 'syncEntity'>,
    private readonly watcher: FileWatcherPort,
  ) {}

  start(): void {
    if (this.handle) return;
    // Watches dataDir as a whole (recursively) — the watcher port has no
    // glob support (chokidar v4 dropped it), so filtering down to the four
    // canonical entity source files happens in handleChange below, reusing
    // the same mapFilePathToEntity every other change is checked against.
    this.handle = this.watcher.watch([this.dataDir], (path) => {
      void this.handleChange(path);
    });
  }

  async stop(): Promise<void> {
    await this.handle?.close();
    this.handle = null;
  }

  onEntityChanged(listener: (event: EntityChangedEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async handleChange(absolutePath: string): Promise<void> {
    const target = mapFilePathToEntity(this.dataDir, absolutePath);
    if (!target) return;
    const urn = entityUrn(target.kind, target.name);
    let entity: Entity;
    try {
      entity = await this.repository.get(urn);
    } catch {
      // Malformed frontmatter or a file still mid-write — same tolerance
      // FsEntityRepository.list already gives a single broken entity.
      return;
    }
    await this.adapterManager.syncEntity({ entity });
    for (const listener of this.listeners) listener({ kind: entity.kind, urn: entity.urn });
  }
}
