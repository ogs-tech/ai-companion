import type { IpcHandlers } from './dispatcher.js';
import type { EntityService } from '../application/services/entity-service.js';
import { asObject, asString, asBoolean } from './_validators.js';

/** Verbs every customization kind shares, addressed by urn (the per-kind namespaces keep their own save/list). */
export function buildEntityHandlers(service: EntityService): IpcHandlers {
  return {
    'entity.setEnabled': async (params) => {
      const raw = asObject(params, 'entity.setEnabled');
      const { syncReport } = await service.setEnabled({
        urn: asString(raw['urn'], 'urn'),
        enabled: asBoolean(raw['enabled'], 'enabled'),
      });
      return { ok: true as const, syncReport };
    },
  };
}
