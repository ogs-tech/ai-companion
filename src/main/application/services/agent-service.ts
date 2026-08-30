import type { EntityService } from './entity-service.js';
import type { Agent } from '../../../shared/entity.js';
import { entityUrn, WORKSPACE_SOURCE } from '../../../shared/entity.js';
import type { SyncResult } from '../../../shared/sync-result.js';
import type { Scope } from '../ports/scope.js';
import type { AgentId } from '../../domain/agent-id.js';
import { OperationNotAllowedForOriginError } from '../../domain/plugin-errors.js';
import {
  collectPluginEntities,
  assertEntityNotPluginSourced,
  type EntityPluginDeps,
} from './entity-plugin-helpers.js';

export interface SaveAgentResult {
  agent: Agent;
  syncReport: SyncResult[];
}

export class AgentService {
  constructor(
    private readonly base: EntityService,
    private readonly pluginDeps?: EntityPluginDeps,
  ) {}

  async list(scope: Scope = 'personal'): Promise<Agent[]> {
    const workspace = (await this.base.list('agent')) as Agent[];
    if (!this.pluginDeps) return workspace;
    const plugin = (await collectPluginEntities(
      this.pluginDeps,
      { kind: 'agent', relPath: (name) => `agents/${name}.md` },
      scope,
    )) as Agent[];
    const urns = new Set(workspace.map((a) => a.urn));
    return [...workspace, ...plugin.filter((a) => !urns.has(a.urn))];
  }

  async get(id: AgentId): Promise<Agent> {
    return (await this.base.get(entityUrn('agent', id))) as Agent;
  }

  resolvePath(id: AgentId): Promise<string> {
    return this.base.filePath(entityUrn('agent', id));
  }

  async save(input: { agent: Agent; isCreate?: boolean; scope?: Scope }): Promise<SaveAgentResult> {
    if (input.agent.source.kind === 'plugin') {
      throw new OperationNotAllowedForOriginError(
        `Cannot save an agent provided by plugin '${input.agent.source.pluginId}'`,
        { origin: 'plugin', operation: 'save' },
      );
    }
    await assertEntityNotPluginSourced(this.pluginDeps, {
      kind: 'agent',
      operation: 'save',
      name: input.agent.name,
      scope: input.scope ?? 'personal',
    });
    const result = await this.base.save({
      entity: { ...input.agent, source: WORKSPACE_SOURCE },
      ...(input.isCreate !== undefined ? { isCreate: input.isCreate } : {}),
    });
    return { agent: result.entity as Agent, syncReport: result.syncReport };
  }

  async delete(input: { id: AgentId; removeSymlinks: boolean; scope?: Scope }): Promise<{
    ok: true;
    syncReport?: SyncResult[];
  }> {
    await assertEntityNotPluginSourced(this.pluginDeps, {
      kind: 'agent',
      operation: 'delete',
      name: input.id,
      scope: input.scope ?? 'personal',
    });
    return this.base.delete({ urn: entityUrn('agent', input.id), removeSymlinks: input.removeSymlinks });
  }
}
