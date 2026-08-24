import type { IpcHandlers } from './dispatcher.js';
import type { WorkspaceService } from '../application/services/workspace-service.js';
import type { Workspace } from '../../shared/workspace.js';
import type { FileBrowserService } from '../application/services/file-browser-service.js';
import { asObject, asString } from './_validators.js';

export function buildWorkspaceHandlers(
  service: WorkspaceService,
  switchActiveWorkspace: (id: string) => Promise<Workspace>,
  fileBrowserService: FileBrowserService,
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
    'workspace.listDir': async (params) => {
      const raw = asObject(params, 'workspace.listDir');
      return fileBrowserService.listDir(typeof raw['path'] === 'string' ? raw['path'] : '');
    },
    'workspace.readFile': async (params) => {
      const raw = asObject(params, 'workspace.readFile');
      return fileBrowserService.readFile(asString(raw['path'], 'path'));
    },
    'workspace.resolvePath': async (params) => {
      const raw = asObject(params, 'workspace.resolvePath');
      const absolutePath = await fileBrowserService.resolveAbsolutePath(asString(raw['path'], 'path'));
      return { absolutePath };
    },
  };
}
