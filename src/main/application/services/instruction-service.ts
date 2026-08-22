import type { EntityService } from './entity-service.js';
import type { Instruction } from '../../../shared/entity.js';
import { entityUrn, WORKSPACE_SOURCE } from '../../../shared/entity.js';
import type { SyncResult } from '../../../shared/sync-result.js';
import { personalInstructionId, projectInstructionSlug } from '../../domain/instruction-id.js';
import { ioError } from '../../domain/errors.js';
import type { ClaudeCliPort } from '../ports/claude-cli-port.js';
import { buildPersonalInstructionPrompt } from './instruction-generation-prompt.js';
import type { GenerateDraftProgressEvent } from '../../../shared/instruction-generation.js';

export interface SaveInstructionResult {
  instruction: Instruction;
  syncReport: SyncResult[];
}

export interface DeleteInstructionResult {
  ok: true;
  syncReport?: SyncResult[];
}

export interface GenerateDraftResult {
  content: string;
}

export class InstructionService {
  constructor(
    private readonly base: EntityService,
    private readonly claudeCli: ClaudeCliPort,
  ) {}

  /**
   * List every instruction — the personal singleton (when present) followed by
   * any project instructions found under `instructions/project/*`.
   */
  async list(): Promise<Instruction[]> {
    const entities = await this.base.list('instruction');
    return entities as Instruction[];
  }

  /**
   * Load a single instruction by slug. Pass `'default'` for the personal
   * singleton (validated by `personalInstructionId`), or any slug otherwise
   * (validated by `projectInstructionSlug`).
   */
  async get(name = 'default'): Promise<Instruction> {
    if (name === 'default') {
      const id = personalInstructionId(name);
      return (await this.base.get(entityUrn('instruction', id))) as Instruction;
    }
    const slug = projectInstructionSlug(name);
    return (await this.base.get(entityUrn('instruction', slug))) as Instruction;
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

  /**
   * Drafts the body of a new personal instruction via the local `claude` CLI,
   * given optional free-text context from the user. Returns the raw Markdown
   * only — the caller (renderer) builds the full entity and lets the user
   * review/edit it in the create-flow editor before saving.
   */
  async generatePersonalDraft(
    context?: string,
    onEvent?: (event: GenerateDraftProgressEvent) => void,
  ): Promise<GenerateDraftResult> {
    const prompt = buildPersonalInstructionPrompt(context);
    try {
      const { text } = await this.claudeCli.generate({
        prompt,
        ...(onEvent ? { onEvent } : {}),
      });
      return { content: text };
    } catch (err) {
      throw ioError({
        message: `Failed to generate a draft via the claude CLI: ${(err as Error).message}`,
        details: { reason: 'claude_cli_failed' },
      });
    }
  }
}
