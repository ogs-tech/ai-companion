import { InMemoryEntityRepository } from '../../../src/main/infrastructure/entity/in-memory-entity-repository.js';
import { ScopedEntityRepository } from '../../../src/main/application/entity/scoped-entity-repository.js';
import type { EntityRepository } from '../../../src/main/application/ports/entity-repository.js';

export interface ScopedRepositoryFixture {
  scoped: ScopedEntityRepository;
  global: EntityRepository;
  workspace: EntityRepository | null;
}

/**
 * A `ScopedEntityRepository` over in-memory stores: Global always, plus a
 * workspace store when `workspaceId` is given (otherwise the fixture is at
 * Início, where saving a `workspace` entity fails `validation`).
 */
export function scopedRepository(options: {
  global?: EntityRepository;
  globalDataDir?: string;
  workspaceId?: string;
  workspace?: EntityRepository;
  workspaceDataDir?: string;
} = {}): ScopedRepositoryFixture {
  const global = options.global ?? new InMemoryEntityRepository();
  const workspace =
    options.workspaceId === undefined ? null : (options.workspace ?? new InMemoryEntityRepository());
  const scoped = new ScopedEntityRepository(
    { repository: global, dataDir: options.globalDataDir ?? '/home/u/.ai-companion' },
    workspace === null || options.workspaceId === undefined
      ? null
      : {
          repository: workspace,
          dataDir: options.workspaceDataDir ?? '/repos/ws/.ai-companion',
          workspaceId: options.workspaceId,
        },
  );
  return { scoped, global, workspace };
}
