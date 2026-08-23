import { join } from 'node:path';
import type { Adapter, AdapterDestination } from '../../application/ports/adapter.js';
import type { Entity, Instruction } from '../../../shared/entity.js';
import type { WorkspaceService } from '../../application/services/workspace-service.js';
import type { ProjectService } from '../../application/services/project-service.js';
import { resolveScopePath } from '../../application/resolve-scope-path.js';
import { DomainError } from '../../domain/errors.js';

export interface ClaudeAdapterDeps {
  homedir: string;
  workspaceService: Pick<WorkspaceService, 'get'>;
  projectService: Pick<ProjectService, 'get'>;
}

export class ClaudeAdapter implements Adapter {
  readonly adapterId = 'claude';
  private readonly homedir: string;
  private readonly scopeDeps: Pick<ClaudeAdapterDeps, 'workspaceService' | 'projectService'>;

  constructor(deps: ClaudeAdapterDeps) {
    if (deps.homedir === undefined || deps.homedir === null || deps.homedir === '') {
      throw new DomainError(
        'internal',
        'ClaudeAdapter requires a non-empty homedir',
        { reason: 'missing-homedir' },
      );
    }
    this.homedir = deps.homedir;
    this.scopeDeps = { workspaceService: deps.workspaceService, projectService: deps.projectService };
  }

  async resolveEntityDestinations(args: { entity: Entity }): Promise<AdapterDestination[]> {
    const { kind, name, scopes } = args.entity;

    if (kind === 'instruction') {
      const instruction = args.entity as Instruction;
      if (instruction.scopes[0] === 'personal') {
        return [
          { scope: 'personal', destination: join(this.homedir, '.claude/CLAUDE.md'), strategy: 'symlink' },
          { scope: 'personal', destination: join(this.homedir, 'AGENTS.md'), strategy: 'symlink' },
        ];
      }
      const scope = instruction.scopes[0];
      if (scope === undefined) {
        throw new DomainError('internal', `Instruction ${instruction.urn} has no scope`, {
          reason: 'missing-scope',
        });
      }
      const repoPath = await resolveScopePath(instruction, this.scopeDeps);
      return [
        { scope, destination: join(repoPath, '.claude/CLAUDE.md'), strategy: 'symlink' },
        { scope, destination: join(repoPath, 'AGENTS.md'), strategy: 'symlink' },
      ];
    }

    if (kind !== 'skill' && kind !== 'agent') {
      return [];
    }

    // TODO(follow-up): skill/agent scope 'project'/'workspace' is temporarily
    // blocked at the schema level (skillAgentScopes still pins ['personal']).
    // When we introduce a per-entity repoPath/scopeId for skill/agent, re-add
    // project/workspace destinations here.
    const subfolder = kind === 'skill' ? '.claude/skills' : '.claude/agents';
    const fileName = kind === 'skill' ? name : `${name}.md`;
    const out: AdapterDestination[] = [];

    if (scopes.includes('personal')) {
      out.push({ scope: 'personal', destination: join(this.homedir, subfolder, fileName), strategy: 'symlink' });
    }
    return out;
  }
}
