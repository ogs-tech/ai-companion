import type { IpcHandlers } from './dispatcher.js';
import type { ProjectService } from '../application/services/project-service.js';
import type { FileBrowserPort } from '../application/ports/file-browser-port.js';
import { FileBrowserService } from '../application/services/file-browser-service.js';
import { asObject, asRawString, asString } from './_validators.js';

export function buildProjectHandlers(service: ProjectService, fileBrowserPort: FileBrowserPort): IpcHandlers {
  const browserForProject = async (projectId: string): Promise<FileBrowserService> => {
    const project = await service.get(projectId);
    return new FileBrowserService(fileBrowserPort, project.path);
  };

  return {
    'project.list': async () => service.list(),
    'project.create': async (params) => {
      const raw = asObject(params, 'project.create');
      return service.create({
        name: asString(raw['name'], 'name'),
        path: asString(raw['path'], 'path'),
      });
    },
    'project.findOrCreateByPath': async (params) => {
      const raw = asObject(params, 'project.findOrCreateByPath');
      return service.findOrCreateByPath(asString(raw['path'], 'path'));
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
    'project.listDir': async (params) => {
      const raw = asObject(params, 'project.listDir');
      const browser = await browserForProject(asString(raw['projectId'], 'projectId'));
      return browser.listDir(typeof raw['path'] === 'string' ? raw['path'] : '');
    },
    'project.readFile': async (params) => {
      const raw = asObject(params, 'project.readFile');
      const browser = await browserForProject(asString(raw['projectId'], 'projectId'));
      return browser.readFile(asString(raw['path'], 'path'));
    },
    'project.writeFile': async (params) => {
      const raw = asObject(params, 'project.writeFile');
      const browser = await browserForProject(asString(raw['projectId'], 'projectId'));
      await browser.writeFile(asString(raw['path'], 'path'), asRawString(raw['content'], 'content'));
    },
    'project.resolvePath': async (params) => {
      const raw = asObject(params, 'project.resolvePath');
      const browser = await browserForProject(asString(raw['projectId'], 'projectId'));
      const absolutePath = await browser.resolveAbsolutePath(asString(raw['path'], 'path'));
      return { absolutePath };
    },
  };
}
