import { join } from 'node:path';
import type { Adapter, AdapterDestination } from '../../application/ports/adapter.js';
import type { Entity, Instruction } from '../../../shared/entity.js';
import type { WorkspaceService } from '../../application/services/workspace-service.js';
import { resolveScopePath } from '../../application/resolve-scope-path.js';
import { DomainError } from '../../domain/errors.js';

export interface ClaudeAdapterDeps {
  homedir: string;
  workspaceService: Pick<WorkspaceService, 'get'>;
}

export class ClaudeAdapter implements Adapter {
  readonly adapterId = 'claude';
  private readonly homedir: string;
  private readonly scopeDeps: Pick<ClaudeAdapterDeps, 'workspaceService'>;

  constructor(deps: ClaudeAdapterDeps) {
    if (deps.homedir === undefined || deps.homedir === null || deps.homedir === '') {
      throw new DomainError(
        'internal',
        'ClaudeAdapter requires a non-empty homedir',
        { reason: 'missing-homedir' },
      );
    }
    this.homedir = deps.homedir;
    this.scopeDeps = { workspaceService: deps.workspaceService };
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

    const subfolder = kind === 'skill' ? '.claude/skills' : '.claude/agents';
    const fileName = kind === 'skill' ? name : `${name}.md`;
    const scope = scopes[0];
    if (scope === undefined) {
      throw new DomainError('internal', `${kind} ${args.entity.urn} has no scope`, { reason: 'missing-scope' });
    }
    if (scope === 'personal') {
      return [{ scope: 'personal', destination: join(this.homedir, subfolder, fileName), strategy: 'symlink' }];
    }
    const basePath = await resolveScopePath(args.entity, this.scopeDeps);
    return [{ scope, destination: join(basePath, subfolder, fileName), strategy: 'symlink' }];
  }
}
