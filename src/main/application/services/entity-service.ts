import type { Entity, EntityKind } from '../../../shared/entity.js';
import { entityUrn } from '../../../shared/entity.js';
import type { SyncResult } from '../../../shared/sync-result.js';
import type { ScopedEntityRepository } from '../entity/scoped-entity-repository.js';
import type { ClockPort } from '../ports/clock-port.js';
import type { AdapterManager } from './adapter-manager.js';
import type { EntityValidator } from './entity-validator.js';
import { validationError } from '../../domain/errors.js';

export interface SaveEntityCommand {
  entity: Entity;
  isCreate?: boolean;
}
export interface SaveEntityResult {
  entity: Entity;
  syncReport: SyncResult[];
}
export interface DeleteEntityCommand {
  urn: string;
  removeSymlinks: boolean;
}
export interface DeleteEntityResult {
  ok: true;
  syncReport?: SyncResult[];
}

/**
 * Save/delete/list over Global ∪ the active workspace. Writes route by
 * `scopes[0]` (see `ScopedEntityRepository`); a `workspace` entity may only
 * target the workspace that is open right now.
 */
export class EntityService {
  constructor(
    private readonly repository: ScopedEntityRepository,
    private readonly clock: ClockPort,
    private readonly adapterManager: AdapterManager,
    private readonly validator?: EntityValidator,
  ) {}

  list(kind: EntityKind): Promise<Entity[]> {
    return this.repository.list({ kind });
  }

  get(urn: string): Promise<Entity> {
    return this.repository.get(urn);
  }

  filePath(urn: string): Promise<string> {
    return this.repository.filePath(urn);
  }

  async save(command: SaveEntityCommand): Promise<SaveEntityResult> {
    const { entity, isCreate = false } = command;
    this.validator?.validate(entity);
    this.assertWritableScope(entity);

    const urn = entityUrn(entity.kind, entity.name);
    const previousUrn = entity.urn;
    const isRename = !isCreate && previousUrn !== '' && previousUrn !== urn;
    const exists = await this.repository.exists(urn);

    if ((isCreate || isRename) && exists) {
      throw validationError({ message: `Entity already exists: ${urn}`, details: { conflict: urn } });
    }

    const nowIso = this.clock.now().toISOString();
    let previous: Entity | undefined;
    if (isRename) {
      previous = await this.repository.get(previousUrn);
    } else if (exists) {
      previous = await this.repository.get(urn);
    }
    const createdAt = previous?.metadata.createdAt || nowIso;

    const persisted: Entity = {
      ...entity,
      urn,
      metadata: { ...entity.metadata, createdAt, updatedAt: nowIso },
    };
    const saved = await this.repository.save(persisted);

    // A rename, or a scope change (which moves the canonical file between the
    // Global and workspace stores), leaves the old copy and its destinations
    // behind — remove both.
    const removeReport: SyncResult[] = [];
    if (previous !== undefined && (isRename || previous.scopes[0] !== saved.scopes[0])) {
      removeReport.push(...(await this.adapterManager.removeEntity({ entity: previous })));
      await this.repository.storeFor(previous.scopes[0]).repository.delete(previous.urn);
    }

    const syncReport = await this.adapterManager.syncEntity({ entity: saved });
    return { entity: saved, syncReport: [...removeReport, ...syncReport] };
  }

  private assertWritableScope(entity: Entity): void {
    if (entity.scopes[0] !== 'workspace') return;
    const activeId = this.repository.activeWorkspaceId;
    if (activeId === null) {
      throw validationError({
        message: 'No workspace is open — a workspace entity needs one',
        details: { reason: 'no-active-workspace' },
      });
    }
    if (entity.scopeId !== activeId) {
      throw validationError({
        message: `Entity scopeId '${String(entity.scopeId)}' is not the open workspace '${activeId}'`,
        details: { reason: 'scope-id-mismatch', invalid: ['scopeId'] },
      });
    }
  }

  async delete(command: DeleteEntityCommand): Promise<DeleteEntityResult> {
    let syncReport: SyncResult[] | undefined;
    if (command.removeSymlinks) {
      const entity = await this.repository.get(command.urn);
      syncReport = await this.adapterManager.removeEntity({ entity });
    }
    await this.repository.delete(command.urn);
    return syncReport === undefined ? { ok: true } : { ok: true, syncReport };
  }
}
