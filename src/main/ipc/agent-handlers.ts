import type { IpcHandlers } from './dispatcher.js';
import type { AgentService } from '../application/services/agent-service.js';
import type { Agent } from '../../shared/entity.js';
import type { Scope } from '../application/ports/scope.js';
import { agentId } from '../domain/agent-id.js';
import { asBoolean, asObject, asScope, asString, optParams } from './_validators.js';

export function buildAgentHandlers(service: AgentService): IpcHandlers {
  return {
    'agent.list': async (params) => {
      const raw = optParams(params, 'agent.list');
      const scope: Scope = raw['scope'] !== undefined ? asScope(raw['scope']) : 'personal';
      return service.list(scope);
    },

    'agent.get': async (params) => {
      const raw = asObject(params, 'agent.get');
      return service.get(agentId(asString(raw['id'], 'id')));
    },

    'agent.resolvePath': async (params) => {
      const raw = asObject(params, 'agent.resolvePath');
      const absolutePath = await service.resolvePath(agentId(asString(raw['id'], 'id')));
      return { absolutePath };
    },

    'agent.save': async (params) => {
      const raw = asObject(params, 'agent.save');
      const agent = asObject(raw['agent'], 'agent') as unknown as Agent;
      const isCreate = typeof raw['isCreate'] === 'boolean' ? raw['isCreate'] : undefined;
      return service.save({ agent, ...(isCreate !== undefined ? { isCreate } : {}) });
    },

    'agent.delete': async (params) => {
      const raw = asObject(params, 'agent.delete');
      return service.delete({
        id: agentId(asString(raw['id'], 'id')),
        removeSymlinks: asBoolean(raw['removeSymlinks'], 'removeSymlinks'),
      });
    },
  };
}
