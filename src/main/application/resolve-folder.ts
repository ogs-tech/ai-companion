import type { Workspace } from '../../shared/workspace.js';
import { workspaceFolders } from '../../shared/workspace.js';
import { DomainError } from '../domain/errors.js';

/**
 * The folder a per-folder call targets: `folder` when given (it must be one of
 * the workspace's folders — never an arbitrary path), else the primary root.
 */
export function resolveFolder(workspace: Pick<Workspace, 'rootPath' | 'extraFolders'>, folder?: string): string {
  if (folder === undefined) return workspace.rootPath;
  if (!workspaceFolders(workspace).includes(folder)) {
    throw new DomainError('validation', `${folder} is not a folder of the open workspace`, { reason: 'unknown-folder' });
  }
  return folder;
}
