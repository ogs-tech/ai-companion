import type { EntityService } from './entity-service.js';
import type { Instruction } from '../../../shared/entity.js';
import { entityUrn, WORKSPACE_SOURCE } from '../../../shared/entity.js';
import type { SyncResult } from '../../../shared/sync-result.js';
import { personalInstructionId, projectInstructionSlug } from '../../domain/instruction-id.js';

export interface SaveInstructionResult {
  instruction: Instruction;
  syncReport: SyncResult[];
}

export interface DeleteInstructionResult {
  ok: true;
  syncReport?: SyncResult[];
}

export class InstructionService {
  constructor(private readonly base: EntityService) {}

  /**
   * List every instruction — the personal singleton (when present) followed by
   * the open workspace's instructions.
   */
  async list(): Promise<Instruction[]> {
    return (await this.base.list('instruction')) as Instruction[];
  }

  /**
   * Load a single instruction by slug. Pass `'default'` for the personal
   * singleton (validated by `personalInstructionId`), or any slug otherwise
   * (validated by `projectInstructionSlug`).
   */
  async get(name = 'default'): Promise<Instruction> {
    const id = name === 'default' ? personalInstructionId(name) : projectInstructionSlug(name);
    return (await this.base.get(entityUrn('instruction', id))) as Instruction;
  }

  /** Absolute path of the instruction's own canonical source file. */
  resolvePath(name = 'default'): Promise<string> {
    const id = name === 'default' ? personalInstructionId(name) : projectInstructionSlug(name);
    return this.base.filePath(entityUrn('instruction', id));
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
