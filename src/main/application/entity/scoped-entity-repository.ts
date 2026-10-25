import type { Entity, Scope } from '../../../shared/entity.js';
import type { EntityListQuery, EntityRepository } from '../ports/entity-repository.js';
import { DomainError } from '../../domain/errors.js';

/** One data dir's repository plus the dir itself — adapters link into it. */
export interface DataDirRepository {
  repository: EntityRepository;
  dataDir: string;
}

export interface ActiveWorkspaceRepository extends DataDirRepository {
  workspaceId: string;
}

/**
 * The two entity stores the app sees at once: Global (`~/.ai-companion`,
 * `personal` entities, always present) and the active workspace's own
 * `<root>/.ai-companion` (`workspace` entities, absent at Início).
 *
 * Writes route by `scopes[0]`; reads see the union. A urn present in both
 * resolves to the workspace copy — the closer scope — though `EntityService`
 * keeps new names unique across the two so that only pre-existing data can
 * collide.
 */
export class ScopedEntityRepository implements EntityRepository {
  constructor(
    private readonly global: DataDirRepository,
    private readonly workspace: ActiveWorkspaceRepository | null,
  ) {}

  get activeWorkspaceId(): string | null {
    return this.workspace?.workspaceId ?? null;
  }

  /** The store a given scope writes to — `validation` for `workspace` at Início. */
  storeFor(scope: Scope | undefined): DataDirRepository {
    if (scope === 'personal') return this.global;
    if (scope === 'workspace') {
      if (this.workspace === null) {
        throw new DomainError('validation', 'No workspace is open — open a folder before saving a workspace entity');
      }
      return this.workspace;
    }
    throw new DomainError('validation', `Unsupported scope: ${String(scope)}`);
  }

  /** The data dir an entity's canonical files live in — what adapter symlinks point at. */
  dataDirFor(entity: Pick<Entity, 'scopes'>): string {
    return this.storeFor(entity.scopes[0]).dataDir;
  }

  async list(query?: EntityListQuery): Promise<Entity[]> {
    const global = await this.global.repository.list(query);
    if (this.workspace === null) return global;
    return [...global, ...(await this.workspace.repository.list(query))];
  }

  async get(urn: string): Promise<Entity> {
    return (await this.holder(urn)).get(urn);
  }

  save(entity: Entity): Promise<Entity> {
    return this.storeFor(entity.scopes[0]).repository.save(entity);
  }

  async delete(urn: string): Promise<void> {
    await (await this.holder(urn)).delete(urn);
  }

  async exists(urn: string): Promise<boolean> {
    if (this.workspace !== null && (await this.workspace.repository.exists(urn))) return true;
    return this.global.repository.exists(urn);
  }

  async filePath(urn: string): Promise<string> {
    return (await this.holder(urn)).filePath(urn);
  }

  /** Workspace first, then Global; a urn in neither falls through to Global's own `not_found`. */
  private async holder(urn: string): Promise<EntityRepository> {
    if (this.workspace !== null && (await this.workspace.repository.exists(urn))) {
      return this.workspace.repository;
    }
    return this.global.repository;
  }
}
