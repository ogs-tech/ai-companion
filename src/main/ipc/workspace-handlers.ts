import type { IpcHandlers } from './dispatcher.js';
import type { WorkspaceService } from '../application/services/workspace-service.js';
import type { Workspace } from '../../shared/workspace.js';
import type { FileBrowserService } from '../application/services/file-browser-service.js';
import { DomainError } from '../domain/errors.js';
import { asObject, asRawString, asString } from './_validators.js';

/**
 * The calls that change which workspace is open — each tears down and rebuilds
 * the workspace-scoped service graph, so they live in the composition root,
 * not on `WorkspaceService`.
 */
export interface WorkspaceActivation {
  switchTo(id: string): Promise<Workspace>;
  open(path: string): Promise<Workspace>;
  goHome(): Promise<void>;
  /** Goes home first when `id` is the open workspace. */
  delete(id: string): Promise<void>;
}

/** The open workspace's file browser — `null` at Início, which has no file tree. */
export function requireFileBrowser(browser: FileBrowserService | null): FileBrowserService {
  if (browser === null) throw new DomainError('validation', 'No workspace is open — open a folder first');
  return browser;
}

export function buildWorkspaceHandlers(
  service: WorkspaceService,
  activation: WorkspaceActivation,
  fileBrowserService: FileBrowserService | null,
): IpcHandlers {
  return {
    'workspace.list': async () => service.list(),
    'workspace.getActive': async () => service.getActive(),
    'workspace.create': async (params) => {
      const raw = asObject(params, 'workspace.create');
      return service.create({ name: asString(raw['name'], 'name'), rootPath: asString(raw['rootPath'], 'rootPath') });
    },
    'workspace.open': async (params) => {
      const raw = asObject(params, 'workspace.open');
      return activation.open(asString(raw['path'], 'path'));
    },
    'workspace.goHome': async () => activation.goHome(),
    'workspace.switchTo': async (params) => {
      const raw = asObject(params, 'workspace.switchTo');
      return activation.switchTo(asString(raw['id'], 'id'));
    },
    'workspace.delete': async (params) => {
      const raw = asObject(params, 'workspace.delete');
      return activation.delete(asString(raw['id'], 'id'));
    },
    'workspace.listDir': async (params) => {
      const raw = asObject(params, 'workspace.listDir');
      return requireFileBrowser(fileBrowserService).listDir(
        typeof raw['path'] === 'string' ? raw['path'] : '',
        raw['showHidden'] === true,
      );
    },
    'workspace.listFolders': async () => requireFileBrowser(fileBrowserService).listFolders(),
    'workspace.readFile': async (params) => {
      const raw = asObject(params, 'workspace.readFile');
      return requireFileBrowser(fileBrowserService).readFile(asString(raw['path'], 'path'));
    },
    'workspace.writeFile': async (params) => {
      const raw = asObject(params, 'workspace.writeFile');
      await requireFileBrowser(fileBrowserService).writeFile(
        asString(raw['path'], 'path'),
        asRawString(raw['content'], 'content'),
      );
    },
    'workspace.resolvePath': async (params) => {
      const raw = asObject(params, 'workspace.resolvePath');
      const absolutePath = await requireFileBrowser(fileBrowserService).resolveAbsolutePath(asString(raw['path'], 'path'));
      return { absolutePath };
    },
  };
}
