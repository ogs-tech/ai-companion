import { join } from 'node:path';
import type { SyncResult, SyncResultDetails } from '../../../shared/sync-result.js';
import type { Entity } from '../../../shared/entity.js';
import type { SettingsService } from './settings-service.js';
import type { EntityRepository } from '../ports/entity-repository.js';
import type { Adapter, AdapterDestination } from '../ports/adapter.js';
import type { SymlinkManager } from './symlink-manager.js';
import type { FileMaterializer } from './file-materializer.js';
import { DomainError } from '../../domain/errors.js';

export interface SymlinkError {
  destination: string;
  kind: string;
  message: string;
}

export interface RemoveAdapterResult {
  removed: number;
  skipped: number;
  errors: SymlinkError[];
}

export interface AdapterManagerDeps {
  settingsService: SettingsService;
  entityRepository: EntityRepository;
  symlinkManager: SymlinkManager;
  fileMaterializer: FileMaterializer;
  adapters: Map<string, Adapter>;
  workspacePath: string;
}

export interface SymlinkPlanEntry {
  adapterId: string;
  source: string;
  destination: string;
  scope: 'personal' | 'project' | 'workspace';
}

export interface GeneratedFilePlanEntry {
  adapterId: string;
  destination: string;
  content: string;
}

export interface SyncAllCommand {
  adapterId?: string;
}

export interface RemoveAllCommand {
  adapterId: string;
}

export interface SyncEntityCommand {
  entity: Entity;
}

export interface RemoveEntityCommand {
  entity: Entity;
}

export class AdapterManager {
  constructor(private readonly deps: AdapterManagerDeps) {}

  async syncAll(command: SyncAllCommand): Promise<SyncResult[]> {
    const settings = (await this.deps.settingsService.load()) ?? this.deps.settingsService.getDefaults();
    const enabledAdapters = this.enabledAdapters(settings).filter((adapter) =>
      command.adapterId ? adapter.adapterId === command.adapterId : true,
    );

    const entities = await this.deps.entityRepository.list();
    const results: SyncResult[] = [];
    for (const entity of entities) {
      for (const adapter of enabledAdapters) {
        let destinations: AdapterDestination[];
        try {
          destinations = await adapter.resolveEntityDestinations({ entity });
        } catch (err) {
          // One entity's resolution failure (e.g. a dangling scopeId) must not
          // abort sync for every other entity — degrade to a per-entity error.
          results.push(this.symlinkError(adapter.adapterId, entity.urn, err));
          continue;
        }
        for (const destination of destinations) {
          results.push(
            await this.syncDestination(
              adapter.adapterId,
              this.entitySourcePath(entity, this.deps.workspacePath),
              destination,
            ),
          );
        }
      }
    }
    return results;
  }

  async syncEntity(command: SyncEntityCommand): Promise<SyncResult[]> {
    const settings = (await this.deps.settingsService.load()) ?? this.deps.settingsService.getDefaults();
    const enabledAdapters = this.enabledAdapters(settings);
    const results: SyncResult[] = [];

    const source = this.entitySourcePath(command.entity, this.deps.workspacePath);
    for (const adapter of enabledAdapters) {
      const destinations = await adapter.resolveEntityDestinations({ entity: command.entity });
      for (const destination of destinations) {
        results.push(await this.syncDestination(adapter.adapterId, source, destination));
      }
    }
    return results;
  }

  async removeEntity(command: RemoveEntityCommand): Promise<SyncResult[]> {
    const results: SyncResult[] = [];
    for (const adapter of this.deps.adapters.values()) {
      const destinations = await adapter.resolveEntityDestinations({ entity: command.entity });
      for (const destination of destinations) {
        results.push(await this.removeDestination(adapter.adapterId, destination));
      }
    }
    return results;
  }

  async removeAll(command: RemoveAllCommand): Promise<SyncResult[]> {
    const adapter = this.deps.adapters.get(command.adapterId);
    if (!adapter) return [];

    const entities = await this.deps.entityRepository.list();
    const results: SyncResult[] = [];

    for (const entity of entities) {
      const destinations = await adapter.resolveEntityDestinations({ entity });
      for (const destination of destinations) {
        results.push(await this.removeDestination(adapter.adapterId, destination));
      }
    }
    return results;
  }

  async removeAdapterSymlinks(adapterId: string): Promise<RemoveAdapterResult> {
    const adapter = this.deps.adapters.get(adapterId);
    if (!adapter) return { removed: 0, skipped: 0, errors: [] };

    const workspacePath = this.deps.workspacePath;
    const entities = await this.deps.entityRepository.list();
    let removed = 0;
    let skipped = 0;
    const errors: SymlinkError[] = [];

    for (const entity of entities) {
      let destinations: AdapterDestination[];
      try {
        destinations = await adapter.resolveEntityDestinations({ entity });
      } catch (err) {
        // One entity's resolution failure must not abort removal for every
        // other entity — degrade to a per-entity error, same shape as the
        // per-destination catch below.
        errors.push({
          destination: entity.urn,
          kind: err instanceof DomainError ? err.kind : 'internal',
          message: err instanceof Error ? err.message : 'Unknown error',
        });
        continue;
      }
      for (const dest of destinations) {
        if (dest.strategy !== 'symlink') continue;
        try {
          const result = await this.deps.symlinkManager.removeIfPointsToWorkspace(dest.destination, workspacePath);
          if (result === 'removed') {
            removed++;
          } else {
            skipped++;
          }
        } catch (err) {
          errors.push({
            destination: dest.destination,
            kind: err instanceof DomainError ? err.kind : 'internal',
            message: err instanceof Error ? err.message : 'Unknown error',
          });
        }
      }
    }

    return { removed, skipped, errors };
  }

  /**
   * Removes every app-created symlink (those pointing into the workspace) across
   * all registered adapters, aggregating the per-adapter results. Used by the
   * factory-reset flow — it never touches symlinks pointing elsewhere or real files.
   */
  async removeAllAdapterSymlinks(): Promise<RemoveAdapterResult> {
    const aggregate: RemoveAdapterResult = { removed: 0, skipped: 0, errors: [] };
    for (const adapterId of this.deps.adapters.keys()) {
      const result = await this.removeAdapterSymlinks(adapterId);
      aggregate.removed += result.removed;
      aggregate.skipped += result.skipped;
      aggregate.errors.push(...result.errors);
    }
    return aggregate;
  }

  /** Marker-guarded removal of every generated (write) file for one adapter. */
  async removeAdapterGeneratedFiles(adapterId: string): Promise<RemoveAdapterResult> {
    const adapter = this.deps.adapters.get(adapterId);
    if (!adapter) return { removed: 0, skipped: 0, errors: [] };

    const entities = await this.deps.entityRepository.list();
    let removed = 0;
    let skipped = 0;
    const errors: SymlinkError[] = [];

    for (const entity of entities) {
      let destinations: AdapterDestination[];
      try {
        destinations = await adapter.resolveEntityDestinations({ entity });
      } catch (err) {
        // One entity's resolution failure must not abort removal for every
        // other entity — degrade to a per-entity error, same shape as the
        // per-destination catch below.
        errors.push({
          destination: entity.urn,
          kind: err instanceof DomainError ? err.kind : 'internal',
          message: err instanceof Error ? err.message : 'Unknown error',
        });
        continue;
      }
      for (const dest of destinations) {
        if (dest.strategy !== 'write') continue;
        try {
          const removeArgs: Parameters<typeof this.deps.fileMaterializer.removeIfOwned>[0] = {
            destination: dest.destination,
          };
          if (dest.ownershipMarker !== undefined) removeArgs.ownershipMarker = dest.ownershipMarker;
          if (dest.ownershipCheck !== undefined) removeArgs.ownershipCheck = dest.ownershipCheck;
          const result = await this.deps.fileMaterializer.removeIfOwned(removeArgs);
          if (result.removed) removed++;
          else skipped++;
        } catch (err) {
          errors.push({
            destination: dest.destination,
            kind: err instanceof DomainError ? err.kind : 'internal',
            message: err instanceof Error ? err.message : 'Unknown error',
          });
        }
      }
    }
    return { removed, skipped, errors };
  }

  /** Removes every app-generated file across all adapters (factory reset). */
  async removeAllGeneratedFiles(): Promise<RemoveAdapterResult> {
    const aggregate: RemoveAdapterResult = { removed: 0, skipped: 0, errors: [] };
    for (const adapterId of this.deps.adapters.keys()) {
      const result = await this.removeAdapterGeneratedFiles(adapterId);
      aggregate.removed += result.removed;
      aggregate.skipped += result.skipped;
      aggregate.errors.push(...result.errors);
    }
    return aggregate;
  }

  async countDestinations(adapterId: string): Promise<number> {
    const adapter = this.deps.adapters.get(adapterId);
    if (!adapter) return 0;

    const workspacePath = this.deps.workspacePath;
    const entities = await this.deps.entityRepository.list();
    let count = 0;

    for (const entity of entities) {
      let destinations: AdapterDestination[];
      try {
        destinations = await adapter.resolveEntityDestinations({ entity });
      } catch {
        // One entity's resolution failure must not abort counting for every
        // other entity — skip it, matching the silent per-destination skip
        // used just below for the same reason.
        continue;
      }
      for (const dest of destinations) {
        try {
          if (dest.strategy === 'symlink') {
            const isWorkspaceLink = await this.deps.symlinkManager.isSymlinkToWorkspace(dest.destination, workspacePath);
            if (isWorkspaceLink) count++;
          } else {
            const validateArgs: Parameters<typeof this.deps.fileMaterializer.validate>[0] = {
              destination: dest.destination,
              content: dest.content,
            };
            if (dest.ownershipMarker !== undefined) validateArgs.ownershipMarker = dest.ownershipMarker;
            if (dest.ownershipCheck !== undefined) validateArgs.ownershipCheck = dest.ownershipCheck;
            const state = await this.deps.fileMaterializer.validate(validateArgs);
            if (state === 'ok' || state === 'drift') count++;
          }
        } catch {
          // skip
        }
      }
    }
    return count;
  }

  /**
   * Read-only resolution of every expected symlink across enabled adapters and
   * all customizations. Mirrors syncAll's resolution but performs NO filesystem
   * writes — used by the health SymlinkCollector to validate integrity.
   */
  async planDestinations(): Promise<SymlinkPlanEntry[]> {
    const settings =
      (await this.deps.settingsService.load()) ?? this.deps.settingsService.getDefaults();
    const enabledAdapters = this.enabledAdapters(settings);
    const entities = await this.deps.entityRepository.list();

    const entries: SymlinkPlanEntry[] = [];
    for (const entity of entities) {
      const source = this.entitySourcePath(entity, this.deps.workspacePath);
      for (const adapter of enabledAdapters) {
        const destinations = await adapter.resolveEntityDestinations({ entity });
        for (const dest of destinations) {
          if (dest.strategy !== 'symlink') continue;
          entries.push({
            adapterId: adapter.adapterId,
            source,
            destination: dest.destination,
            scope: dest.scope,
          });
        }
      }
    }
    return entries;
  }

  /** Read-only plan of every generated (write) destination across enabled adapters. */
  async planGeneratedFiles(): Promise<GeneratedFilePlanEntry[]> {
    const settings = (await this.deps.settingsService.load()) ?? this.deps.settingsService.getDefaults();
    const enabledAdapters = this.enabledAdapters(settings);
    const entities = await this.deps.entityRepository.list();
    const entries: GeneratedFilePlanEntry[] = [];
    for (const entity of entities) {
      for (const adapter of enabledAdapters) {
        const destinations = await adapter.resolveEntityDestinations({ entity });
        for (const dest of destinations) {
          if (dest.strategy !== 'write') continue;
          entries.push({ adapterId: adapter.adapterId, destination: dest.destination, content: dest.content });
        }
      }
    }
    return entries;
  }

  private async removeDestination(adapterId: string, dest: AdapterDestination): Promise<SyncResult> {
    try {
      let result: { removed: boolean };
      if (dest.strategy === 'write') {
        const removeArgs: Parameters<typeof this.deps.fileMaterializer.removeIfOwned>[0] = {
          destination: dest.destination,
        };
        if (dest.ownershipMarker !== undefined) removeArgs.ownershipMarker = dest.ownershipMarker;
        if (dest.ownershipCheck !== undefined) removeArgs.ownershipCheck = dest.ownershipCheck;
        result = await this.deps.fileMaterializer.removeIfOwned(removeArgs);
      } else {
        result = await this.deps.symlinkManager.removeIfExists({ destination: dest.destination });
      }
      const payload: SyncResult = { adapter: adapterId, destination: dest.destination, status: 'ok' };
      if (!result.removed) payload.details = { skipped: 'not-found' };
      return payload;
    } catch (err) {
      return this.symlinkError(adapterId, dest.destination, err);
    }
  }

  private enabledAdapters(settings: NonNullable<Awaited<ReturnType<SettingsService['load']>>>): Adapter[] {
    const adapters: Adapter[] = [];
    for (const adapter of this.deps.adapters.values()) {
      const adapterConfig = (settings.adapters as Record<string, { enabled: boolean }>)[adapter.adapterId];
      if (adapterConfig?.enabled) {
        adapters.push(adapter);
      }
    }
    return adapters;
  }

  private entitySourcePath(entity: Entity, workspacePath: string): string {
    if (entity.kind === 'skill') return join(workspacePath, 'skills', entity.name);
    if (entity.kind === 'agent') return join(workspacePath, 'agents', `${entity.name}.md`);
    if (entity.kind === 'instruction') {
      // Personal singleton lives at instructions/default.md; project instructions
      // live at instructions/project/<slug>/INSTRUCTION.md (see FsEntityRepository).
      if (entity.name === 'default' && entity.scopes[0] === 'personal') {
        return join(workspacePath, 'instructions', 'default.md');
      }
      return join(workspacePath, 'instructions', 'project', entity.name, 'INSTRUCTION.md');
    }
    throw new DomainError('validation', `Unsupported entity kind for sync: ${entity.kind}`);
  }

  private async syncDestination(
    adapterId: string,
    source: string,
    dest: AdapterDestination,
  ): Promise<SyncResult> {
    if (dest.strategy === 'write') {
      return this.writeDestination(adapterId, dest);
    }
    try {
      const result = await this.deps.symlinkManager.create({ source, destination: dest.destination });
      const payload: SyncResult = { adapter: adapterId, destination: dest.destination, status: result.status };
      if (result.status === 'conflict') {
        payload.message = 'Overwrote existing destination and created a backup';
      }
      if (result.details !== undefined) payload.details = result.details;
      return payload;
    } catch (err) {
      return this.symlinkError(adapterId, dest.destination, err);
    }
  }

  private async writeDestination(adapterId: string, dest: Extract<AdapterDestination, { strategy: 'write' }>): Promise<SyncResult> {
    try {
      const writeArgs: Parameters<typeof this.deps.fileMaterializer.write>[0] = {
        destination: dest.destination,
        content: dest.content,
      };
      if (dest.ownershipMarker !== undefined) writeArgs.ownershipMarker = dest.ownershipMarker;
      if (dest.ownershipCheck !== undefined) writeArgs.ownershipCheck = dest.ownershipCheck;
      const result = await this.deps.fileMaterializer.write(writeArgs);
      const payload: SyncResult = { adapter: adapterId, destination: dest.destination, status: result.status };
      if (result.status === 'conflict') payload.message = 'Overwrote an existing file and created a backup';
      if (result.details !== undefined) payload.details = result.details as SyncResultDetails;
      return payload;
    } catch (err) {
      return this.symlinkError(adapterId, dest.destination, err);
    }
  }

  private symlinkError(adapterId: string, destination: string, err: unknown): SyncResult {
    if (err instanceof DomainError && err.kind === 'symlink_conflict') {
      return { adapter: adapterId, destination, status: 'conflict', message: err.message, details: err.details as SyncResultDetails };
    }
    if (err instanceof DomainError) {
      const payload: SyncResult = { adapter: adapterId, destination, status: 'error', message: err.message };
      if (err.details !== undefined) payload.details = err.details as SyncResultDetails;
      return payload;
    }
    return { adapter: adapterId, destination, status: 'error', message: err instanceof Error ? err.message : 'Unknown error' };
  }
}
