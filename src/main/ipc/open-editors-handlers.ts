import type { IpcHandlers } from './dispatcher.js';
import type { OpenEditorsService } from '../application/services/open-editors-service.js';

export function buildOpenEditorsHandlers(openEditorsService: OpenEditorsService): IpcHandlers {
  return {
    'openEditors.get': async () => openEditorsService.load(),
    // The service drops anything malformed itself, so the raw payload goes straight in.
    'openEditors.save': async (params) => {
      await openEditorsService.save(params);
    },
  };
}
