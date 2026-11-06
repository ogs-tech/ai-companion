import type { IpcHandlers } from './dispatcher.js';
import type { WorkspaceService } from '../application/services/workspace-service.js';
import type { Workspace } from '../../shared/workspace.js';
import type { FileBrowserService } from '../application/services/file-browser-service.js';
import { DomainError } from '../domain/errors.js';
import type { FileOperationsService } from '../application/services/file-operations-service.js';
import type { ProjectSearchService } from '../application/services/project-search-service.js';
import type { ConflictResolution, SearchRequest, TransferMode, TransferRecord, TransferRequest } from '../../shared/file-ops.js';
import { asBoolean, asObject, asRawString, asString, asStringArray } from './_validators.js';

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
  /** Folder/name edits; the open workspace's graph is rebuilt only when its primary folder changed. */
  addFolder(id: string, path: string): Promise<Workspace>;
  removeFolder(id: string, path: string): Promise<Workspace>;
  rename(id: string, name: string): Promise<Workspace>;
}

/** The open workspace's file browser — `null` at Início, which has no file tree. */
export function requireFileBrowser(browser: FileBrowserService | null): FileBrowserService {
  if (browser === null) throw new DomainError('validation', 'No workspace is open — open a folder first');
  return browser;
}

/** The open workspace's file operations and search — `null` at Início. */
export interface WorkspaceFileExtras {
  operations: FileOperationsService | null;
  search: ProjectSearchService | null;
}

function requireExtra<T>(value: T | null): T {
  if (value === null) throw new DomainError('validation', 'No workspace is open — open a folder first');
  return value;
}

const MODES: readonly string[] = ['move', 'copy'];
const RESOLUTIONS: readonly string[] = ['replace', 'keep-both', 'skip'];

function parseTransferRequest(params: unknown, label: string): TransferRequest {
  const raw = asObject(params, label);
  const mode = raw['mode'];
  if (typeof mode !== 'string' || !MODES.includes(mode)) throw new DomainError('validation', "Missing or invalid 'mode'");
  const targetDir = raw['targetDir'];
  if (typeof targetDir !== 'string') throw new DomainError('validation', "Missing or invalid 'targetDir'");
  const request: TransferRequest = { sources: asStringArray(raw['sources'], 'sources'), targetDir, mode: mode as TransferMode };
  if (raw['external'] !== undefined) request.external = asBoolean(raw['external'], 'external');
  if (raw['resolutions'] !== undefined) {
    const resolutions = asObject(raw['resolutions'], 'resolutions');
    const parsed: Record<string, ConflictResolution> = {};
    for (const [target, value] of Object.entries(resolutions)) {
      if (typeof value !== 'string' || !RESOLUTIONS.includes(value)) {
        throw new DomainError('validation', `Invalid resolution for '${target}'`);
      }
      parsed[target] = value as ConflictResolution;
    }
    request.resolutions = parsed;
  }
  return request;
}

function parseRecords(value: unknown): TransferRecord[] {
  if (!Array.isArray(value)) throw new DomainError('validation', "Missing or invalid 'records'");
  return value.map((entry) => {
    const raw = asObject(entry, 'record');
    const mode = raw['mode'];
    if (typeof mode !== 'string' || !MODES.includes(mode)) throw new DomainError('validation', "Invalid record 'mode'");
    return { mode: mode as TransferMode, from: asString(raw['from'], 'from'), to: asString(raw['to'], 'to'), replaced: raw['replaced'] === true };
  });
}

function parseSearchRequest(params: unknown): SearchRequest {
  const raw = asObject(params, 'workspace.search');
  if (typeof raw['query'] !== 'string') throw new DomainError('validation', "Missing or invalid 'query'");
  return {
    requestId: asString(raw['requestId'], 'requestId'),
    query: raw['query'],
    caseSensitive: raw['caseSensitive'] === true,
    wholeWord: raw['wholeWord'] === true,
    regex: raw['regex'] === true,
  };
}

export function buildWorkspaceHandlers(
  service: WorkspaceService,
  activation: WorkspaceActivation,
  fileBrowserService: FileBrowserService | null,
  extras: WorkspaceFileExtras = { operations: null, search: null },
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
    'workspace.addFolder': async (params) => {
      const raw = asObject(params, 'workspace.addFolder');
      return activation.addFolder(asString(raw['id'], 'id'), asString(raw['path'], 'path'));
    },
    'workspace.removeFolder': async (params) => {
      const raw = asObject(params, 'workspace.removeFolder');
      return activation.removeFolder(asString(raw['id'], 'id'), asString(raw['path'], 'path'));
    },
    'workspace.rename': async (params) => {
      const raw = asObject(params, 'workspace.rename');
      return activation.rename(asString(raw['id'], 'id'), asString(raw['name'], 'name'));
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
    'workspace.createFile': async (params) => {
      const raw = asObject(params, 'workspace.createFile');
      await requireExtra(extras.operations).createFile(asString(raw['path'], 'path'));
    },
    'workspace.createDir': async (params) => {
      const raw = asObject(params, 'workspace.createDir');
      await requireExtra(extras.operations).createDir(asString(raw['path'], 'path'));
    },
    'workspace.renameEntry': async (params) => {
      const raw = asObject(params, 'workspace.renameEntry');
      return requireExtra(extras.operations).rename(asString(raw['path'], 'path'), asRawString(raw['newName'], 'newName'));
    },
    'workspace.duplicate': async (params) => {
      const raw = asObject(params, 'workspace.duplicate');
      return requireExtra(extras.operations).duplicate(asString(raw['path'], 'path'));
    },
    'workspace.trash': async (params) => {
      const raw = asObject(params, 'workspace.trash');
      return requireExtra(extras.operations).trash(asStringArray(raw['paths'], 'paths'));
    },
    'workspace.planTransfer': async (params) =>
      requireExtra(extras.operations).planTransfer(parseTransferRequest(params, 'workspace.planTransfer')),
    'workspace.transfer': async (params) =>
      requireExtra(extras.operations).transfer(parseTransferRequest(params, 'workspace.transfer')),
    'workspace.undoTransfer': async (params) => {
      const raw = asObject(params, 'workspace.undoTransfer');
      return requireExtra(extras.operations).undoTransfer(parseRecords(raw['records']));
    },
    'workspace.listFiles': async () => requireExtra(extras.operations).listFiles(),
    'workspace.search': async (params) => requireExtra(extras.search).search(parseSearchRequest(params)),
    'workspace.cancelSearch': async (params) => {
      const raw = asObject(params, 'workspace.cancelSearch');
      extras.search?.cancel(asString(raw['requestId'], 'requestId'));
    },
  };
}
