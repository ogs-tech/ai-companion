import type { Entity } from '../../shared/entity.js';
import type { WorkspaceService } from './services/workspace-service.js';
import { DomainError } from '../domain/errors.js';

export interface ResolveScopePathDeps {
  workspaceService: Pick<WorkspaceService, 'get'>;
}

/** The folder a `workspace`-scoped entity materializes into — its workspace's root. */
export async function resolveScopePath(entity: Entity, deps: ResolveScopePathDeps): Promise<string> {
  const scope = entity.scopes[0];

  if (scope === 'workspace') {
    if (entity.scopeId === undefined) {
      throw new DomainError('validation', `Entity ${entity.urn} has scope 'workspace' but no scopeId`);
    }
    const workspace = await deps.workspaceService.get(entity.scopeId);
    return workspace.rootPath;
  }

  throw new DomainError('internal', `resolveScopePath: scope '${String(scope)}' has no path — callers must branch on 'personal' first`);
}
