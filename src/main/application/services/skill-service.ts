import type { EntityService } from './entity-service.js';
import type { Skill } from '../../../shared/entity.js';
import { entityUrn, WORKSPACE_SOURCE } from '../../../shared/entity.js';
import type { SyncResult } from '../../../shared/sync-result.js';
import type { Scope } from '../ports/scope.js';
import type { SkillId } from '../../domain/skill-id.js';
import { OperationNotAllowedForOriginError } from '../../domain/plugin-errors.js';
import {
  collectPluginEntities,
  PLUGIN_COMMAND_SPEC,
  PLUGIN_SKILL_SPEC,
  assertEntityNotPluginSourced,
  type EntityPluginDeps,
} from './entity-plugin-helpers.js';

export interface SaveSkillResult {
  skill: Skill;
  syncReport: SyncResult[];
}

export class SkillService {
  constructor(
    private readonly base: EntityService,
    private readonly pluginDeps?: EntityPluginDeps,
  ) {}

  async list(scope: Scope = 'personal'): Promise<Skill[]> {
    const workspace = (await this.base.list('skill')) as Skill[];
    if (!this.pluginDeps) return workspace;
    const plugin = (await collectPluginEntities(
      this.pluginDeps,
      PLUGIN_SKILL_SPEC,
      scope,
    )) as Skill[];
    // A plugin's slash-commands are explicit-only Skills. Workspace skills and real plugin skills win on a name clash.
    const commands = (await collectPluginEntities(
      this.pluginDeps,
      PLUGIN_COMMAND_SPEC,
      scope,
    )) as Skill[];
    const urns = new Set(workspace.map((s) => s.urn));
    const merged = [...workspace];
    for (const s of [...plugin, ...commands]) {
      if (urns.has(s.urn)) continue;
      urns.add(s.urn);
      merged.push(s);
    }
    return merged;
  }

  async get(id: SkillId): Promise<Skill> {
    return (await this.base.get(entityUrn('skill', id))) as Skill;
  }

  resolvePath(id: SkillId): Promise<string> {
    return this.base.filePath(entityUrn('skill', id));
  }

  async save(input: { skill: Skill; isCreate?: boolean; scope?: Scope }): Promise<SaveSkillResult> {
    if (input.skill.source.kind === 'plugin') {
      throw new OperationNotAllowedForOriginError(
        `Cannot save a skill provided by plugin '${input.skill.source.pluginId}'`,
        { origin: 'plugin', operation: 'save' },
      );
    }
    await assertEntityNotPluginSourced(this.pluginDeps, {
      kind: 'skill',
      operation: 'save',
      name: input.skill.name,
      scope: input.scope ?? 'personal',
    });
    const result = await this.base.save({
      entity: { ...input.skill, source: WORKSPACE_SOURCE },
      ...(input.isCreate !== undefined ? { isCreate: input.isCreate } : {}),
    });
    return { skill: result.entity as Skill, syncReport: result.syncReport };
  }

  async delete(input: { id: SkillId; removeSymlinks: boolean; scope?: Scope }): Promise<{
    ok: true;
    syncReport?: SyncResult[];
  }> {
    await assertEntityNotPluginSourced(this.pluginDeps, {
      kind: 'skill',
      operation: 'delete',
      name: input.id,
      scope: input.scope ?? 'personal',
    });
    return this.base.delete({ urn: entityUrn('skill', input.id), removeSymlinks: input.removeSymlinks });
  }
}
