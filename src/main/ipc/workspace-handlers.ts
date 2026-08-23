import type { IpcHandlers } from './dispatcher.js';
import type { WorkspaceService } from '../application/services/workspace-service.js';
import type { Workspace } from '../../shared/workspace.js';
import { asObject, asString } from './_validators.js';

export function buildWorkspaceHandlers(
  service: WorkspaceService,
  switchActiveWorkspace: (id: string) => Promise<Workspace>,
): IpcHandlers {
  return {
    'workspace.list': async () => service.list(),
    'workspace.getActive': async () => service.getActive(),
    'workspace.create': async (params) => {
      const raw = asObject(params, 'workspace.create');
      return service.create({
        name: asString(raw['name'], 'name'),
        rootPath: asString(raw['rootPath'], 'rootPath'),
      });
    },
    'workspace.switchTo': async (params) => {
      const raw = asObject(params, 'workspace.switchTo');
      return switchActiveWorkspace(asString(raw['id'], 'id'));
    },
    'workspace.delete': async (params) => {
      const raw = asObject(params, 'workspace.delete');
      return service.delete(asString(raw['id'], 'id'));
    },
  };
}
