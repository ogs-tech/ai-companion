import type { IpcHandlers } from './dispatcher.js';
import type { McpService } from '../application/services/mcp-service.js';
import type { McpServerInput } from '../../shared/mcp.js';
import { asObject, asString, asBoolean } from './_validators.js';

export function buildMcpHandlers(service: McpService): IpcHandlers {
  return {
    'mcp.list': async () => service.list(),

    'mcp.get': async (params) => {
      const raw = asObject(params, 'mcp.get');
      return service.get(asString(raw['id'], 'id'));
    },

    'mcp.save': async (params) => {
      const raw = asObject(params, 'mcp.save');
      const server = asObject(raw['server'], 'server') as unknown as McpServerInput;
      const isCreate = typeof raw['isCreate'] === 'boolean' ? raw['isCreate'] : undefined;
      return service.save({ server, ...(isCreate !== undefined ? { isCreate } : {}) });
    },

    'mcp.delete': async (params) => {
      const raw = asObject(params, 'mcp.delete');
      return service.delete({ id: asString(raw['id'], 'id') });
    },

    'mcp.setEnabled': async (params) => {
      const raw = asObject(params, 'mcp.setEnabled');
      return service.setEnabled({
        id: asString(raw['id'], 'id'),
        enabled: asBoolean(raw['enabled'], 'enabled'),
      });
    },

    'mcp.authenticate': async (params) => {
      const raw = asObject(params, 'mcp.authenticate');
      return service.authenticate({ id: asString(raw['id'], 'id') });
    },

    'mcp.refreshHealth': async () => service.refreshHealth(),
  };
}
