import { pathToFileURL } from 'node:url';
import type { IpcHandlers } from './dispatcher.js';
import type { OpenWithService } from '../application/services/open-with-service.js';
import type { ProjectService } from '../application/services/project-service.js';
import type { FileBrowserPort } from '../application/ports/file-browser-port.js';
import type { DialogPort } from '../application/ports/dialog-port.js';
import type { EmbeddedBrowserPort } from '../application/ports/embedded-browser-port.js';
import { FileBrowserService } from '../application/services/file-browser-service.js';
import { DomainError } from '../domain/errors.js';
import type { OpenWithKind } from '../../shared/open-with.js';
import { asObject, asRawString, asString } from './_validators.js';

export interface OpenWithHandlerDeps {
  openWithService: OpenWithService;
  /** Browser rooted at the active workspace — used when no `projectId` is given. */
  workspaceBrowser: FileBrowserService;
  projectService: ProjectService;
  fileBrowserPort: FileBrowserPort;
  dialogPort: DialogPort;
  embeddedBrowser: EmbeddedBrowserPort;
}

function asKind(value: unknown): OpenWithKind {
  if (value !== 'file' && value !== 'dir') {
    throw new DomainError('validation', "Missing or invalid 'kind' (must be file | dir)");
  }
  return value;
}

/**
 * Opening a file elsewhere — another program, the Finder, the app's own
 * embedded browser — is the one place that hands an arbitrary path off, so it
 * is deliberately the renderer-facing methods that never see an absolute
 * path: they take the same workspace- or project-relative path the rest of
 * the file browser uses, and every one of them resolves it through
 * `FileBrowserService`, whose `resolveSafe` rejects `..`, absolute paths and
 * symlinks pointing outside the root.
 *
 * Unlike `workspace.*`/`project.*`, which duplicate each file method per
 * scope, this namespace takes an optional `projectId` and picks the root
 * itself — six methods instead of twelve, with the same guarantee.
 */
export function buildOpenWithHandlers(deps: OpenWithHandlerDeps): IpcHandlers {
  const { openWithService, workspaceBrowser, projectService, fileBrowserPort, dialogPort, embeddedBrowser } = deps;

  const resolvePath = async (raw: Record<string, unknown>): Promise<string> => {
    // Empty means the root itself — a Project folder browsed in place from the
    // workspace tree is its own root, and is a legitimate thing to open.
    const path = asRawString(raw['path'], 'path');
    const projectId = raw['projectId'];
    if (typeof projectId !== 'string' || projectId.length === 0) {
      return workspaceBrowser.resolveAbsolutePath(path);
    }
    const project = await projectService.get(projectId);
    return new FileBrowserService(fileBrowserPort, project.path).resolveAbsolutePath(path);
  };

  return {
    'openWith.suggest': async (params) => {
      const raw = asObject(params, 'openWith.suggest');
      const kind = asKind(raw['kind']);
      return openWithService.suggest(await resolvePath(raw), kind);
    },

    'openWith.open': async (params) => {
      const raw = asObject(params, 'openWith.open');
      const kind = asKind(raw['kind']);
      const app = {
        id: asString(raw['appId'], 'appId'),
        path: asString(raw['appPath'], 'appPath'),
      };
      await openWithService.open(await resolvePath(raw), kind, app);
    },

    'openWith.chooseApp': async (params) => {
      const raw = asObject(params, 'openWith.chooseApp');
      const kind = asKind(raw['kind']);
      // Resolved before the picker opens: a path that fails the sandbox check
      // should never get as far as showing the user a dialog.
      const absolutePath = await resolvePath(raw);

      const picked = await dialogPort.selectApplication();
      if (picked.canceled || picked.path === undefined) return { canceled: true };

      await openWithService.openByPath(absolutePath, kind, picked.path);
      return { canceled: false };
    },

    'openWith.openDefault': async (params) => {
      const raw = asObject(params, 'openWith.openDefault');
      await openWithService.openDefault(await resolvePath(raw));
    },

    'openWith.reveal': async (params) => {
      const raw = asObject(params, 'openWith.reveal');
      await openWithService.reveal(await resolvePath(raw));
    },

    'openWith.openInBrowser': async (params) => {
      const raw = asObject(params, 'openWith.openInBrowser');
      const absolutePath = await resolvePath(raw);
      return embeddedBrowser.openTab(pathToFileURL(absolutePath).href);
    },
  };
}
