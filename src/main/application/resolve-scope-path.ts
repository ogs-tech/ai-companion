import type { Entity } from '../../shared/entity.js';
import type { WorkspaceService } from './services/workspace-service.js';
import type { ProjectService } from './services/project-service.js';
import { DomainError } from '../domain/errors.js';

export interface ResolveScopePathDeps {
  workspaceService: Pick<WorkspaceService, 'get'>;
  projectService: Pick<ProjectService, 'get'>;
}

export async function resolveScopePath(entity: Entity, deps: ResolveScopePathDeps): Promise<string> {
  const scope = entity.scopes[0];

  if (scope === 'project') {
    if (entity.scopeId === undefined) {
      throw new DomainError('validation', `Entity ${entity.urn} has scope 'project' but no scopeId`);
    }
    const project = await deps.projectService.get(entity.scopeId);
    return project.path;
  }

  if (scope === 'workspace') {
    if (entity.scopeId === undefined) {
      throw new DomainError('validation', `Entity ${entity.urn} has scope 'workspace' but no scopeId`);
    }
    const workspace = await deps.workspaceService.get(entity.scopeId);
    return workspace.rootPath;
  }

  throw new DomainError('internal', `resolveScopePath: scope '${scope}' has no path — callers must branch on 'personal' first`);
}
