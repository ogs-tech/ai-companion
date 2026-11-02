import type { Entity } from '../../shared/entity.js';
import type { WorkspaceService } from './services/workspace-service.js';
import { workspaceFolders } from '../../shared/workspace.js';
import { workspaceHomePath } from '../../shared/brand-paths.js';
import { DomainError } from '../domain/errors.js';

export interface ResolveScopePathDeps {
  workspaceService: Pick<WorkspaceService, 'get'>;
  /** Needed to place a multi-folder workspace's shared set under `~/.ai-companion/workspaces/<id>`. */
  homedir?: string;
}

/**
 * The folder a `workspace`-scoped entity materializes into: its own `folder`
 * when it lives in one, the workspace's home directory for the shared set of a
 * multi-folder workspace, else the workspace's root.
 */
export async function resolveScopePath(entity: Entity, deps: ResolveScopePathDeps): Promise<string> {
  const scope = entity.scopes[0];

  if (scope === 'workspace') {
    if (entity.scopeId === undefined) {
      throw new DomainError('validation', `Entity ${entity.urn} has scope 'workspace' but no scopeId`);
    }
    const workspace = await deps.workspaceService.get(entity.scopeId);
    if (entity.folder !== undefined) return entity.folder;
    if (workspaceFolders(workspace).length > 1) {
      if (deps.homedir === undefined) {
        throw new DomainError('internal', 'resolveScopePath: a multi-folder shared entity needs the home dir');
      }
      return workspaceHomePath(deps.homedir, workspace.id);
    }
    return workspace.rootPath;
  }

  throw new DomainError('internal', `resolveScopePath: scope '${String(scope)}' has no path — callers must branch on 'personal' first`);
}
