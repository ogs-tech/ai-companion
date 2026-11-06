import { join } from 'node:path';
import type { EntitySyncState, SyncResult, SyncResultDetails } from '../../../shared/sync-result.js';
import type { Entity } from '../../../shared/entity.js';
import type { SettingsService } from './settings-service.js';
import type { EntityRepository } from '../ports/entity-repository.js';
import type { Adapter, AdapterDestination } from '../ports/adapter.js';
import type { SymlinkManager } from './symlink-manager.js';
import type { FileMaterializer } from './file-materializer.js';
import type { MergeMaterializer } from './merge-materializer.js';
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
  /** Required for `merge` destinations (mcp / hook entities); the composition root always supplies it. */
  mergeMaterializer?: MergeMaterializer;
  adapters: Map<string, Adapter>;
  /** The data dir holding an entity's canonical files (Global or the active workspace's) — see `ScopedEntityRepository.dataDirFor`. */
  entityDataDir: (entity: Entity) => string;
}

export interface SymlinkPlanEntry {
  adapterId: string;
  source: string;
  destination: string;
  scope: 'personal' | 'workspace';
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
      if ((entity as { enabled?: boolean }).enabled === false) continue;
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
              this.entitySourcePath(entity),
              destination,
            ),
          );
        }
      }
    }
    return results;
  }

  async syncEntity(command: SyncEntityCommand): Promise<SyncResult[]> {
    // A disabled mcp/hook keeps its canonical copy but is written to no harness.
    if ((command.entity as { enabled?: boolean }).enabled === false) {
      return this.removeEntity({ entity: command.entity });
    }
    const settings = (await this.deps.settingsService.load()) ?? this.deps.settingsService.getDefaults();
    const enabledAdapters = this.enabledAdapters(settings);
    const results: SyncResult[] = [];

    const source = this.entitySourcePath(command.entity);
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
          const result = await this.deps.symlinkManager.removeIfPointsToWorkspace(dest.destination, this.deps.entityDataDir(entity));
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
        if (dest.strategy === 'merge') {
          try {
            const { removed: gone } = await this.merger().remove({ file: dest.destination, target: dest.target });
            if (gone) removed++;
            else skipped++;
          } catch (err) {
            errors.push({
              destination: dest.destination,
              kind: err instanceof DomainError ? err.kind : 'internal',
              message: err instanceof Error ? err.message : 'Unknown error',
            });
          }
          continue;
        }
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
            const isWorkspaceLink = await this.deps.symlinkManager.isSymlinkToWorkspace(dest.destination, this.deps.entityDataDir(entity));
            if (isWorkspaceLink) count++;
          } else if (dest.strategy === 'merge') {
            const state = await this.merger().validate({ file: dest.destination, target: dest.target });
            if (state === 'ok' || state === 'drift') count++;
          } else if (dest.strategy === 'write') {
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
   * Read-only per-entity sync state, checked against the disk (never a cached Sync report, so a
   * file changed outside the app is noticed). An entity is `synced` only when every destination
   * of every enabled harness is in place; `skip` destinations are ignored, and an entity with
   * nothing to materialize is omitted.
   */
  async entitySyncStates(): Promise<Record<string, EntitySyncState>> {
    const settings = (await this.deps.settingsService.load()) ?? this.deps.settingsService.getDefaults();
    const enabledAdapters = this.enabledAdapters(settings);
    const entities = await this.deps.entityRepository.list();
    const states: Record<string, EntitySyncState> = {};

    for (const entity of entities) {
      const source = this.entitySourcePath(entity);
      let checked = 0;
      let inSync = true;
      for (const adapter of enabledAdapters) {
        let destinations: AdapterDestination[];
        try {
          destinations = await adapter.resolveEntityDestinations({ entity });
        } catch {
          // Unresolvable (e.g. its workspace is gone): it cannot be in sync, but must not hide the rest.
          checked++;
          inSync = false;
          continue;
        }
        for (const dest of destinations) {
          if (dest.strategy === 'skip') continue;
          checked++;
          if (!(await this.destinationInSync(dest, source))) inSync = false;
        }
      }
      if (checked > 0) states[entity.urn] = inSync ? 'synced' : 'pending';
    }
    return states;
  }

  private async destinationInSync(dest: AdapterDestination, source: string): Promise<boolean> {
    try {
      if (dest.strategy === 'symlink') {
        return (await this.deps.symlinkManager.validate({ destination: dest.destination, source })) === 'symlink-to-source';
      }
      if (dest.strategy === 'merge') {
        return (await this.merger().validate({ file: dest.destination, target: dest.target })) === 'ok';
      }
      if (dest.strategy === 'write') {
        const args: Parameters<typeof this.deps.fileMaterializer.validate>[0] = { destination: dest.destination, content: dest.content };
        if (dest.ownershipMarker !== undefined) args.ownershipMarker = dest.ownershipMarker;
        if (dest.ownershipCheck !== undefined) args.ownershipCheck = dest.ownershipCheck;
        return (await this.deps.fileMaterializer.validate(args)) === 'ok';
      }
      return true;
    } catch {
      return false;
    }
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
      const source = this.entitySourcePath(entity);
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
      } else if (dest.strategy === 'merge') {
        result = await this.merger().remove({ file: dest.destination, target: dest.target });
      } else if (dest.strategy === 'skip') {
        result = { removed: false };
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

  private entitySourcePath(entity: Entity): string {
    const dataDir = this.deps.entityDataDir(entity);
    if (entity.kind === 'skill') return join(dataDir, 'skills', entity.name);
    if (entity.kind === 'agent') return join(dataDir, 'agents', `${entity.name}.md`);
    if (entity.kind === 'instruction') {
      // Personal singleton lives at instructions/default.md; workspace instructions
      // live at instructions/project/<slug>/INSTRUCTION.md (see FsEntityRepository).
      if (entity.name === 'default' && entity.scopes[0] === 'personal') {
        return join(dataDir, 'instructions', 'default.md');
      }
      return join(dataDir, 'instructions', 'project', entity.name, 'INSTRUCTION.md');
    }
    // mcp / hook are never linked: their adapters only emit merge/skip destinations.
    return '';
  }

  private async syncDestination(
    adapterId: string,
    source: string,
    dest: AdapterDestination,
  ): Promise<SyncResult> {
    if ((dest.strategy === 'symlink' || dest.strategy === 'write') && dest.keepForeign === true) {
      const foreign = await this.foreignFileAt(dest, source);
      if (foreign) {
        const message = `${dest.destination} already exists and is not managed by the app; left untouched`;
        return {
          adapter: adapterId,
          destination: dest.destination,
          status: 'ok',
          message,
          details: { skipped: 'foreign-file', reason: message },
        };
      }
    }
    if (dest.strategy === 'write') {
      return this.writeDestination(adapterId, dest);
    }
    if (dest.strategy === 'merge') {
      return this.mergeDestination(adapterId, dest);
    }
    if (dest.strategy === 'skip') {
      return {
        adapter: adapterId,
        destination: dest.destination,
        status: 'ok',
        message: dest.reason,
        details: { skipped: 'unsupported-by-target', reason: dest.reason },
      };
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

  /** True when a file the app does not own occupies the destination (never our symlink or marked file). */
  private async foreignFileAt(dest: Extract<AdapterDestination, { strategy: 'symlink' | 'write' }>, source: string): Promise<boolean> {
    try {
      if (dest.strategy === 'symlink') {
        return (await this.deps.symlinkManager.validate({ destination: dest.destination, source })) === 'real-file';
      }
      const args: Parameters<typeof this.deps.fileMaterializer.validate>[0] = { destination: dest.destination, content: dest.content };
      if (dest.ownershipMarker !== undefined) args.ownershipMarker = dest.ownershipMarker;
      if (dest.ownershipCheck !== undefined) args.ownershipCheck = dest.ownershipCheck;
      return (await this.deps.fileMaterializer.validate(args)) === 'foreign';
    } catch {
      return false;
    }
  }

  private merger(): MergeMaterializer {
    if (this.deps.mergeMaterializer === undefined) {
      throw new DomainError('internal', 'AdapterManager: a merge destination needs a MergeMaterializer');
    }
    return this.deps.mergeMaterializer;
  }

  private async mergeDestination(adapterId: string, dest: Extract<AdapterDestination, { strategy: 'merge' }>): Promise<SyncResult> {
    try {
      const result = await this.merger().apply({
        file: dest.destination,
        target: dest.target,
        ...(dest.seed !== undefined ? { seed: dest.seed } : {}),
      });
      const payload: SyncResult = { adapter: adapterId, destination: dest.destination, status: result.status };
      if (result.status === 'conflict') payload.message = 'Replaced an existing entry and created a backup';
      if (result.details !== undefined) payload.details = result.details as SyncResultDetails;
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
