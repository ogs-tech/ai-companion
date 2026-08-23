import type { IpcHandlers } from './dispatcher.js';
import type { ProjectService } from '../application/services/project-service.js';
import { asObject, asString } from './_validators.js';

export function buildProjectHandlers(service: ProjectService): IpcHandlers {
  return {
    'project.list': async () => service.list(),
    'project.create': async (params) => {
      const raw = asObject(params, 'project.create');
      return service.create({
        name: asString(raw['name'], 'name'),
        path: asString(raw['path'], 'path'),
      });
    },
    'project.update': async (params) => {
      const raw = asObject(params, 'project.update');
      const name = typeof raw['name'] === 'string' ? raw['name'] : undefined;
      const path = typeof raw['path'] === 'string' ? raw['path'] : undefined;
      return service.update({
        id: asString(raw['id'], 'id'),
        ...(name !== undefined ? { name } : {}),
        ...(path !== undefined ? { path } : {}),
      });
    },
    'project.delete': async (params) => {
      const raw = asObject(params, 'project.delete');
      return service.delete(asString(raw['id'], 'id'));
    },
  };
}
