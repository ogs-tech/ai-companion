import type { Entity, EntityKind } from '../../../shared/entity.js';
import { entityUrn } from '../../../shared/entity.js';
import type { SyncResult } from '../../../shared/sync-result.js';
import type { EntityRepository } from '../ports/entity-repository.js';
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

export class EntityService {
  constructor(
    private readonly repository: EntityRepository,
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

    const urn = entityUrn(entity.kind, entity.name);
    const previousUrn = entity.urn;
    const isRename = !isCreate && previousUrn !== '' && previousUrn !== urn;
    const exists = await this.repository.exists(urn);

    if ((isCreate || isRename) && exists) {
      throw validationError({ message: `Entity already exists: ${urn}`, details: { conflict: urn } });
    }

    const nowIso = this.clock.now().toISOString();
    let createdAt = nowIso;
    let previous: Entity | undefined;
    if (isRename) {
      previous = await this.repository.get(previousUrn);
      createdAt = previous.metadata.createdAt || nowIso;
    } else if (exists) {
      const current = await this.repository.get(urn);
      createdAt = current.metadata.createdAt || nowIso;
    }

    const persisted: Entity = {
      ...entity,
      urn,
      metadata: { ...entity.metadata, createdAt, updatedAt: nowIso },
    };
    const saved = await this.repository.save(persisted);

    const removeReport: SyncResult[] = [];
    if (isRename && previous) {
      removeReport.push(...(await this.adapterManager.removeEntity({ entity: previous })));
      await this.repository.delete(previousUrn);
    }

    const syncReport = await this.adapterManager.syncEntity({ entity: saved });
    return { entity: saved, syncReport: [...removeReport, ...syncReport] };
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
