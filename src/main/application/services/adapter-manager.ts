import { join } from 'node:path';
import type { SyncResult, SyncResultDetails } from '../../../shared/sync-result.js';
import type { Entity } from '../../../shared/entity.js';
import { coveringChannel, isChannelId, type ChannelId } from '../../../shared/channel.js';
import type { Settings } from '../../../shared/settings.js';
import type { SettingsService } from './settings-service.js';
import type { EntityRepository } from '../ports/entity-repository.js';
import type { Adapter, AdapterDestination, MergeTarget, OwnershipCheck } from '../ports/adapter.js';
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
  /** Runs after a sync wrote destinations (best-effort; errors are swallowed) — e.g. to refresh git-ignore rules. */
  afterSync?: () => Promise<void>;
}

export interface SymlinkPlanEntry {
  adapterId: string;
  entityUrn: string;
  source: string;
  destination: string;
  scope: 'personal' | 'workspace';
}

export interface GeneratedFilePlanEntry {
  adapterId: string;
  entityUrn: string;
  destination: string;
  content: string;
  /** How the materializer recognizes this file as app-owned (Cursor's .mdc/plugin.json use their own markers). */
  ownershipMarker?: string;
  ownershipCheck?: OwnershipCheck;
}

export interface MergePlanEntry {
  adapterId: string;
  entityUrn: string;
  /** The shared JSON file the entry lives in. */
  destination: string;
  target: MergeTarget;
}

/** A destination the app does not write because another channel's copy is read natively (see `coveringChannel`). */
export interface CoveragePlanEntry {
  adapterId: string;
  entityUrn: string;
  coveredBy: ChannelId;
  /** The covering channel's destination — the file the covered channel actually reads. */
  destination: string;
}

interface ResolvedDestination {
  adapterId: string;
  dest: AdapterDestination;
}

interface CoveredDestination extends ResolvedDestination {
  coveredBy: ChannelId;
  coveringDestination: string;
}

interface JointResolution {
  active: ResolvedDestination[];
  covered: CoveredDestination[];
  /** Adapters whose resolution threw for this entity (e.g. a dangling scopeId). */
  failed: Array<{ adapterId: string; error: unknown }>;
}

export interface InstallCommand {
  urn: string;
  adapterId: string;
}

/** What `install` took over: undoing it puts each backup back (in memory, so a scope switch drops it). */
interface TakenOver {
  strategy: 'symlink' | 'write';
  destination: string;
  backupPath: string;
}

export interface InstallResult {
  /** Present when something was backed up — pass it to `undoInstall`. */
  undoToken?: string;
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

/** An entity with `enabled: false` is removed from every harness by design, so it is never a health problem. */
function isDisabled(entity: Entity): boolean {
  // `=== false`, not `!enabled`: absent means enabled, the same rule the files on disk follow.
  return entity.enabled === false;
}

export class AdapterManager {
  private readonly pendingUndo = new Map<string, TakenOver[]>();
  private undoSeq = 0;

  constructor(private readonly deps: AdapterManagerDeps) {}

  /**
   * Installs one entity into one channel over whatever is there: a file/folder the app doesn't own is moved to
   * `_backups/` and replaced, so from now on the app controls it (and health reports deviations as errors).
   */
  async install(command: InstallCommand): Promise<InstallResult> {
    const adapter = this.deps.adapters.get(command.adapterId);
    if (adapter === undefined) throw new DomainError('not_found', `Unknown adapter: ${command.adapterId}`);
    const entity = (await this.deps.entityRepository.list()).find((e) => e.urn === command.urn);
    if (entity === undefined) throw new DomainError('not_found', `Unknown entity: ${command.urn}`);

    const source = this.entitySourcePath(entity);
    const takenOver: TakenOver[] = [];
    for (const dest of await adapter.resolveEntityDestinations({ entity })) {
      let backupPath: string | undefined;
      if (dest.strategy === 'symlink') {
        backupPath = (await this.deps.symlinkManager.create({ source, destination: dest.destination })).details?.backupPath;
      } else if (dest.strategy === 'write') {
        backupPath = (await this.deps.fileMaterializer.write(this.writeArgs(dest))).details?.backupPath;
      } else {
        await this.syncDestination(adapter.adapterId, source, dest);
      }
      if (backupPath !== undefined && dest.strategy !== 'merge' && dest.strategy !== 'skip') {
        takenOver.push({ strategy: dest.strategy, destination: dest.destination, backupPath });
      }
    }
    await this.deps.afterSync?.().catch(() => undefined);
    if (takenOver.length === 0) return {};
    const undoToken = `install-${++this.undoSeq}`;
    this.pendingUndo.set(undoToken, takenOver);
    return { undoToken };
  }

  /** Reverts an `install`: each replaced file/folder goes back, so the entity is a draft again in that channel. */
  async undoInstall(args: { undoToken: string }): Promise<void> {
    const takenOver = this.pendingUndo.get(args.undoToken);
    if (takenOver === undefined) throw new DomainError('not_found', 'Nothing to undo');
    this.pendingUndo.delete(args.undoToken);
    for (const { strategy, destination, backupPath } of takenOver) {
      if (strategy === 'symlink') await this.deps.symlinkManager.restoreBackup({ destination, backupPath });
      else await this.deps.fileMaterializer.restoreBackup({ destination, backupPath });
    }
    await this.deps.afterSync?.().catch(() => undefined);
  }

  async syncAll(command: SyncAllCommand): Promise<SyncResult[]> {
    const settings = (await this.deps.settingsService.load()) ?? this.deps.settingsService.getDefaults();

    const entities = await this.deps.entityRepository.list();
    const results: SyncResult[] = [];
    for (const entity of entities) {
      if (isDisabled(entity)) continue;
      // Coverage is decided across every enabled adapter, even when the write is filtered to one.
      const joint = await this.resolveJoint(entity, this.enabledAdapters(settings), settings);
      const inScope = (adapterId: string): boolean => command.adapterId === undefined || command.adapterId === adapterId;
      // One entity's resolution failure (e.g. a dangling scopeId) must not
      // abort sync for every other entity — degrade to a per-entity error.
      for (const { adapterId, error } of joint.failed) if (inScope(adapterId)) results.push(this.symlinkError(adapterId, entity.urn, error));
      const source = this.entitySourcePath(entity);
      for (const { adapterId, dest } of joint.active) {
        if (inScope(adapterId)) results.push(await this.syncDestination(adapterId, source, dest));
      }
      results.push(...(await this.removeCovered(entity, joint.covered)));
    }
    await this.deps.afterSync?.().catch(() => undefined);
    return results;
  }

  /** Absolute paths of every symlink and generated file the sync creates (merge entries live in shared JSON, so they're excluded). */
  async managedPaths(): Promise<string[]> {
    const [links, files] = await Promise.all([this.planDestinations(), this.planGeneratedFiles()]);
    return [...links.map((l) => l.destination), ...files.map((f) => f.destination)];
  }

  async syncEntity(command: SyncEntityCommand): Promise<SyncResult[]> {
    // A disabled entity keeps its canonical copy but is written to no channel.
    if (isDisabled(command.entity)) {
      return this.removeEntity({ entity: command.entity });
    }
    const settings = (await this.deps.settingsService.load()) ?? this.deps.settingsService.getDefaults();
    const joint = await this.resolveJoint(command.entity, this.enabledAdapters(settings), settings);
    const first = joint.failed[0];
    if (first !== undefined) throw first.error;
    const results: SyncResult[] = [];
    const source = this.entitySourcePath(command.entity);
    for (const { adapterId, dest } of joint.active) {
      results.push(await this.syncDestination(adapterId, source, dest));
    }
    results.push(...(await this.removeCovered(command.entity, joint.covered)));
    await this.deps.afterSync?.().catch(() => undefined);
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
      if (isDisabled(entity)) continue;
      const source = this.entitySourcePath(entity);
      for (const { adapterId, dest } of (await this.resolveJoint(entity, enabledAdapters, settings, { strict: true })).active) {
        if (dest.strategy !== 'symlink') continue;
        entries.push({ adapterId, entityUrn: entity.urn, source, destination: dest.destination, scope: dest.scope });
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
      if (isDisabled(entity)) continue;
      for (const { adapterId, dest } of (await this.resolveJoint(entity, enabledAdapters, settings, { strict: true })).active) {
        if (dest.strategy !== 'write') continue;
        entries.push({
          adapterId,
          entityUrn: entity.urn,
          destination: dest.destination,
          content: dest.content,
          ...(dest.ownershipMarker !== undefined ? { ownershipMarker: dest.ownershipMarker } : {}),
          ...(dest.ownershipCheck !== undefined ? { ownershipCheck: dest.ownershipCheck } : {}),
        });
      }
    }
    return entries;
  }

  /** Read-only plan of every merge destination (one entry in a shared JSON file: MCP servers, hooks) across enabled adapters. */
  async planMergeDestinations(): Promise<MergePlanEntry[]> {
    const settings = (await this.deps.settingsService.load()) ?? this.deps.settingsService.getDefaults();
    const enabledAdapters = this.enabledAdapters(settings);
    const entities = await this.deps.entityRepository.list();
    const entries: MergePlanEntry[] = [];
    for (const entity of entities) {
      if (isDisabled(entity)) continue;
      for (const { adapterId, dest } of (await this.resolveJoint(entity, enabledAdapters, settings, { strict: true })).active) {
        if (dest.strategy !== 'merge') continue;
        entries.push({ adapterId, entityUrn: entity.urn, destination: dest.destination, target: dest.target });
      }
    }
    return entries;
  }

  /** Read-only plan of every destination left unwritten because another channel's copy is read natively. */
  async planCoverage(): Promise<CoveragePlanEntry[]> {
    const settings = (await this.deps.settingsService.load()) ?? this.deps.settingsService.getDefaults();
    const enabledAdapters = this.enabledAdapters(settings);
    const entries: CoveragePlanEntry[] = [];
    for (const entity of await this.deps.entityRepository.list()) {
      if (isDisabled(entity)) continue;
      // Not strict: an entity that fails to resolve is reported by the plan methods' collectors, not here.
      const { covered } = await this.resolveJoint(entity, enabledAdapters, settings);
      // One entry per covered adapter (an adapter may emit several destinations for one entity).
      const seen = new Set<string>();
      for (const { adapterId, coveredBy, coveringDestination } of covered) {
        if (seen.has(adapterId)) continue;
        seen.add(adapterId);
        entries.push({ adapterId, entityUrn: entity.urn, coveredBy, destination: coveringDestination });
      }
    }
    return entries;
  }

  /**
   * Resolves one entity's destinations across every given adapter at once, then splits off the ones a coverage rule
   * says another channel already serves. `strict` rethrows a resolution failure (the plan methods' behaviour);
   * otherwise it is reported in `failed` and the other adapters still resolve.
   */
  private async resolveJoint(
    entity: Entity,
    adapters: Adapter[],
    settings: Settings,
    options: { strict?: boolean } = {},
  ): Promise<JointResolution> {
    const resolved: Array<{ adapterId: string; dests: AdapterDestination[] }> = [];
    const failed: JointResolution['failed'] = [];
    for (const adapter of adapters) {
      try {
        resolved.push({ adapterId: adapter.adapterId, dests: await adapter.resolveEntityDestinations({ entity }) });
      } catch (error) {
        if (options.strict) throw error;
        failed.push({ adapterId: adapter.adapterId, error });
      }
    }
    const served = new Set<ChannelId>();
    for (const { adapterId, dests } of resolved) {
      if (isChannelId(adapterId) && dests.some((d) => d.strategy !== 'skip')) served.add(adapterId);
    }
    const firstServed = (adapterId: string): string | undefined =>
      resolved.find((r) => r.adapterId === adapterId)?.dests.find((d) => d.strategy !== 'skip')?.destination;

    const active: ResolvedDestination[] = [];
    const covered: CoveredDestination[] = [];
    for (const { adapterId, dests } of resolved) {
      const coveredBy = isChannelId(adapterId) ? coveringChannel({ covered: adapterId, kind: entity.kind, settings, served }) : undefined;
      const coveringDestination = coveredBy === undefined ? undefined : firstServed(coveredBy);
      for (const dest of dests) {
        if (coveredBy !== undefined && coveringDestination !== undefined) covered.push({ adapterId, dest, coveredBy, coveringDestination });
        else active.push({ adapterId, dest });
      }
    }
    return { active, covered, failed };
  }

  /**
   * Removes the app's own copies at destinations another channel now covers. Ownership-safe: a symlink goes only
   * when it points into the app's data, a written file only when it carries the app's marker, a merge entry only
   * when the merge index owns it — a user's own file there is left alone. Only actual removals and errors are reported.
   */
  private async removeCovered(entity: Entity, covered: readonly CoveredDestination[]): Promise<SyncResult[]> {
    const results: SyncResult[] = [];
    for (const { adapterId, dest } of covered) {
      try {
        let removed = false;
        if (dest.strategy === 'symlink') {
          removed = (await this.deps.symlinkManager.removeIfPointsToWorkspace(dest.destination, this.deps.entityDataDir(entity))) === 'removed';
        } else if (dest.strategy === 'write') {
          removed = (await this.deps.fileMaterializer.removeIfOwned(this.removeArgs(dest))).removed;
        } else if (dest.strategy === 'merge') {
          if (this.deps.mergeMaterializer === undefined) continue;
          removed = (await this.deps.mergeMaterializer.remove({ file: dest.destination, target: dest.target })).removed;
        }
        if (removed) results.push({ adapter: adapterId, destination: dest.destination, status: 'ok', message: 'covered by another channel' });
      } catch (err) {
        results.push(this.symlinkError(adapterId, dest.destination, err));
      }
    }
    return results;
  }

  private removeArgs(dest: Extract<AdapterDestination, { strategy: 'write' }>): Parameters<FileMaterializer['removeIfOwned']>[0] {
    return {
      destination: dest.destination,
      ...(dest.ownershipMarker !== undefined ? { ownershipMarker: dest.ownershipMarker } : {}),
      ...(dest.ownershipCheck !== undefined ? { ownershipCheck: dest.ownershipCheck } : {}),
    };
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
    // A file the app doesn't own is never replaced by a sync: it stays a draft until the user installs over it.
    if (dest.strategy === 'symlink' || dest.strategy === 'write') {
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
      const result = await this.deps.fileMaterializer.write(this.writeArgs(dest));
      const payload: SyncResult = { adapter: adapterId, destination: dest.destination, status: result.status };
      if (result.status === 'conflict') payload.message = 'Overwrote an existing file and created a backup';
      if (result.details !== undefined) payload.details = result.details as SyncResultDetails;
      return payload;
    } catch (err) {
      return this.symlinkError(adapterId, dest.destination, err);
    }
  }

  private writeArgs(dest: Extract<AdapterDestination, { strategy: 'write' }>): Parameters<FileMaterializer['write']>[0] {
    return {
      destination: dest.destination,
      content: dest.content,
      ...(dest.ownershipMarker !== undefined ? { ownershipMarker: dest.ownershipMarker } : {}),
      ...(dest.ownershipCheck !== undefined ? { ownershipCheck: dest.ownershipCheck } : {}),
    };
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
