import type { EntityService } from './entity-service.js';
import type { Instruction } from '../../../shared/entity.js';
import { entityUrn, WORKSPACE_SOURCE } from '../../../shared/entity.js';
import type { SyncResult } from '../../../shared/sync-result.js';
import { personalInstructionId, projectInstructionSlug } from '../../domain/instruction-id.js';
import type { ProjectService } from './project-service.js';

export interface SaveInstructionResult {
  instruction: Instruction;
  syncReport: SyncResult[];
}

export interface DeleteInstructionResult {
  ok: true;
  syncReport?: SyncResult[];
}

export class InstructionService {
  constructor(
    private readonly base: EntityService,
    private readonly projectService: Pick<ProjectService, 'findOrCreateByPath'>,
  ) {}

  /**
   * Backfills the `scopeId` for pre-migration on-disk instructions that still
   * carry a `legacyRepoPath` (the old `repoPath`-only shape), persisting the
   * migrated entity so a subsequent read never sees `legacyRepoPath` again.
   */
  private async migrateIfLegacy(instruction: Instruction): Promise<Instruction> {
    if (instruction.legacyRepoPath === undefined) return instruction;
    const project = await this.projectService.findOrCreateByPath(instruction.legacyRepoPath);
    const migrated: Instruction = { ...instruction, scopeId: project.id };
    delete migrated.legacyRepoPath;
    await this.base.save({ entity: migrated });
    return migrated;
  }

  /**
   * List every instruction — the personal singleton (when present) followed by
   * any project instructions found under `instructions/project/*`.
   *
   * Migration is sequential (not `Promise.all`) on purpose: `migrateIfLegacy`
   * calls `ProjectService.findOrCreateByPath`, which does a non-atomic
   * read-modify-write over the whole `projects.json` registry file (`load()`
   * then `save()`, no lock). Running migrations concurrently lets two
   * `save()`s race — the second overwrites the first's newly-created
   * `Project`, silently and permanently losing it (the instruction's own
   * `meta.json` has already been persisted with the now-dangling `scopeId` by
   * then). Sequential awaits make each migration's read-modify-write land
   * before the next one starts.
   */
  async list(): Promise<Instruction[]> {
    const entities = (await this.base.list('instruction')) as Instruction[];
    const migrated: Instruction[] = [];
    for (const entity of entities) {
      migrated.push(await this.migrateIfLegacy(entity));
    }
    return migrated;
  }

  /**
   * Load a single instruction by slug. Pass `'default'` for the personal
   * singleton (validated by `personalInstructionId`), or any slug otherwise
   * (validated by `projectInstructionSlug`).
   */
  async get(name = 'default'): Promise<Instruction> {
    let entity: Instruction;
    if (name === 'default') {
      const id = personalInstructionId(name);
      entity = (await this.base.get(entityUrn('instruction', id))) as Instruction;
    } else {
      const slug = projectInstructionSlug(name);
      entity = (await this.base.get(entityUrn('instruction', slug))) as Instruction;
    }
    return this.migrateIfLegacy(entity);
  }

  async save(input: { instruction: Instruction; isCreate?: boolean }): Promise<SaveInstructionResult> {
    const result = await this.base.save({
      entity: { ...input.instruction, source: WORKSPACE_SOURCE },
      ...(input.isCreate !== undefined ? { isCreate: input.isCreate } : {}),
    });
    return { instruction: result.entity as Instruction, syncReport: result.syncReport };
  }

  async delete(input: { name: string; removeSymlinks?: boolean }): Promise<DeleteInstructionResult> {
    const removeSymlinks = input.removeSymlinks ?? true;
    // The domain guards throw a validation DomainError on bad slugs, so callers
    // don't need to pre-validate.
    if (input.name === 'default') {
      personalInstructionId(input.name);
    } else {
      projectInstructionSlug(input.name);
    }
    const urn = entityUrn('instruction', input.name);
    return this.base.delete({ urn, removeSymlinks });
  }
}
