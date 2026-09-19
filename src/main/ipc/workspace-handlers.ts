import type { IpcHandlers } from './dispatcher.js';
import type { WorkspaceService } from '../application/services/workspace-service.js';
import type { Workspace } from '../../shared/workspace.js';
import type { FileBrowserService } from '../application/services/file-browser-service.js';
import { asObject, asRawString, asString } from './_validators.js';

export function buildWorkspaceHandlers(
  service: WorkspaceService,
  switchActiveWorkspace: (id: string) => Promise<Workspace>,
  fileBrowserService: FileBrowserService,
  /**
   * Registers the picked root folder as that workspace's first `Project` (see
   * `docs/superpowers/specs/2026-09-19-workspace-view-mode-design.md` decision #4) — best-effort
   * by design: a failure here must not fail workspace creation itself, it just leaves the fresh
   * workspace with zero registered Projects (spec §5), which `viewMode` already handles.
   */
  registerRootProject: (rootPath: string) => Promise<void>,
): IpcHandlers {
  return {
    'workspace.list': async () => service.list(),
    'workspace.getActive': async () => service.getActive(),
    'workspace.create': async (params) => {
      const raw = asObject(params, 'workspace.create');
      const rootPath = asString(raw['rootPath'], 'rootPath');
      const workspace = await service.create({ name: asString(raw['name'], 'name'), rootPath });
      await registerRootProject(rootPath).catch(() => undefined);
      return workspace;
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
    'workspace.writeFile': async (params) => {
      const raw = asObject(params, 'workspace.writeFile');
      await fileBrowserService.writeFile(asString(raw['path'], 'path'), asRawString(raw['content'], 'content'));
    },
    'workspace.resolvePath': async (params) => {
      const raw = asObject(params, 'workspace.resolvePath');
      const absolutePath = await fileBrowserService.resolveAbsolutePath(asString(raw['path'], 'path'));
      return { absolutePath };
    },
  };
}
