import type { IpcHandlers } from './dispatcher.js';
import type { HookService } from '../application/services/hook-service.js';
import type { Hook, HookHandler } from '../application/schemas/hook.js';
import type { Scope } from '../application/ports/scope.js';
import { hookId } from '../domain/hook-id.js';
import { asObject, asScope, asString, optParams } from './_validators.js';

export function buildHookHandlers(service: HookService): IpcHandlers {
  return {
    'hook.list': async (params) => {
      const raw = optParams(params, 'hook.list');
      const scope: Scope = raw['scope'] !== undefined ? asScope(raw['scope']) : 'personal';
      return service.list(scope);
    },

    'hook.get': async (params) => {
      const raw = asObject(params, 'hook.get');
      const scope: Scope = raw['scope'] !== undefined ? asScope(raw['scope']) : 'personal';
      return service.get({ id: hookId(asString(raw['id'], 'id')), scope });
    },

    'hook.save': async (params) => {
      const raw = asObject(params, 'hook.save');
      const scope: Scope = raw['scope'] !== undefined ? asScope(raw['scope']) : 'personal';
      const hook = asObject(raw['hook'], 'hook') as unknown as Omit<Hook, 'source'>;
      return service.save({
        hook: {
          ...(hook.id !== undefined ? { id: hookId(hook.id as unknown as string) } : {}),
          event: asString(hook.event, 'event'),
          ...(hook.matcher !== undefined ? { matcher: hook.matcher } : {}),
          ...(hook.description !== undefined ? { description: hook.description } : {}),
          handler: hook.handler as HookHandler,
          ...(typeof hook.enabled === 'boolean' ? { enabled: hook.enabled } : {}),
        },
        scope,
      });
    },

    'hook.delete': async (params) => {
      const raw = asObject(params, 'hook.delete');
      const scope: Scope = raw['scope'] !== undefined ? asScope(raw['scope']) : 'personal';
      return service.delete({ id: hookId(asString(raw['id'], 'id')), scope });
    },
  };
}
