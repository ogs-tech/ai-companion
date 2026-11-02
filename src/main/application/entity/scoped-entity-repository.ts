import type { Entity, Scope } from '../../../shared/entity.js';
import type { EntityListQuery, EntityRepository } from '../ports/entity-repository.js';
import { DomainError } from '../../domain/errors.js';

/** One data dir's repository plus the dir itself — adapters link into it. */
export interface DataDirRepository {
  repository: EntityRepository;
  dataDir: string;
}

/** One folder's own `<folder>/.ai-companion` store, in a multi-folder workspace. */
export interface FolderRepository extends DataDirRepository {
  folder: string;
}

/**
 * The open workspace's store. A single-folder workspace is just
 * `{ repository, dataDir }`. A multi-folder one adds `folders` (one store per
 * folder, the primary's being `repository` itself) and `shared` (the
 * workspace's own set, kept outside every folder): entities then carry the
 * `folder` they live in, and an entity with none belongs to the shared set.
 */
export interface ActiveWorkspaceRepository extends DataDirRepository {
  workspaceId: string;
  folders?: FolderRepository[];
  shared?: DataDirRepository;
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
  storeFor(scope: Scope | undefined, folder?: string): DataDirRepository {
    if (scope === 'personal') return this.global;
    if (scope === 'workspace') {
      if (this.workspace === null) {
        throw new DomainError('validation', 'No workspace is open — open a folder before saving a workspace entity');
      }
      const { folders, shared } = this.workspace;
      if (folders === undefined || shared === undefined) return this.workspace;
      if (folder === undefined) return shared;
      const found = folders.find((f) => f.folder === folder);
      if (found === undefined) {
        throw new DomainError('validation', `${folder} is not a folder of the open workspace`, { reason: 'unknown-folder' });
      }
      return found;
    }
    throw new DomainError('validation', `Unsupported scope: ${String(scope)}`);
  }

  /** The data dir an entity's canonical files live in — what adapter symlinks point at. */
  dataDirFor(entity: Pick<Entity, 'scopes' | 'folder'>): string {
    return this.storeFor(entity.scopes[0], entity.folder).dataDir;
  }

  /** Every workspace-side store with the folder it tags its entities with (`undefined` = untagged). */
  private workspaceStores(): Array<{ store: DataDirRepository; folder: string | undefined }> {
    if (this.workspace === null) return [];
    const { folders, shared } = this.workspace;
    if (folders === undefined || shared === undefined) return [{ store: this.workspace, folder: undefined }];
    return [...folders.map((f) => ({ store: f, folder: f.folder as string | undefined })), { store: shared, folder: undefined }];
  }

  private tagged(entity: Entity, folder: string | undefined): Entity {
    return folder === undefined ? entity : { ...entity, folder };
  }

  async list(query?: EntityListQuery): Promise<Entity[]> {
    const out = await this.global.repository.list(query);
    for (const { store, folder } of this.workspaceStores()) {
      out.push(...(await store.repository.list(query)).map((e) => this.tagged(e, folder)));
    }
    return out;
  }

  async get(urn: string): Promise<Entity> {
    const { repository, folder } = await this.holder(urn);
    return this.tagged(await repository.get(urn), folder);
  }

  async save(entity: Entity): Promise<Entity> {
    let folder = entity.folder;
    // An edit that lost its `folder` must land back where the entity already lives, not in the shared set.
    if (folder === undefined && entity.scopes[0] === 'workspace' && this.workspace?.folders !== undefined) {
      folder = (await this.holder(entity.urn)).folder;
    }
    const saved = await this.storeFor(entity.scopes[0], folder).repository.save(entity);
    return folder === undefined ? saved : { ...saved, folder };
  }

  async delete(urn: string): Promise<void> {
    await (await this.holder(urn)).repository.delete(urn);
  }

  async exists(urn: string): Promise<boolean> {
    for (const { store } of this.workspaceStores()) {
      if (await store.repository.exists(urn)) return true;
    }
    return this.global.repository.exists(urn);
  }

  async filePath(urn: string): Promise<string> {
    return (await this.holder(urn)).repository.filePath(urn);
  }

  /** Workspace stores first (folders in order, then the shared set), then Global; a urn in none falls through to Global's own `not_found`. */
  private async holder(urn: string): Promise<{ repository: EntityRepository; folder: string | undefined }> {
    for (const { store, folder } of this.workspaceStores()) {
      if (await store.repository.exists(urn)) return { repository: store.repository, folder };
    }
    return { repository: this.global.repository, folder: undefined };
  }
}
