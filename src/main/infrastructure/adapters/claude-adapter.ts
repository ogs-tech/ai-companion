import { join } from 'node:path';
import type { Adapter, AdapterDestination } from '../../application/ports/adapter.js';
import type { Entity, HookEntity, Instruction, McpEntity } from '../../../shared/entity.js';
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
  private readonly scopeDeps: Pick<ClaudeAdapterDeps, 'workspaceService' | 'homedir'>;

  constructor(deps: ClaudeAdapterDeps) {
    if (deps.homedir === undefined || deps.homedir === null || deps.homedir === '') {
      throw new DomainError(
        'internal',
        'ClaudeAdapter requires a non-empty homedir',
        { reason: 'missing-homedir' },
      );
    }
    this.homedir = deps.homedir;
    this.scopeDeps = { workspaceService: deps.workspaceService, homedir: deps.homedir };
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

    if (kind === 'mcp' || kind === 'hook') {
      return this.sharedFileDestinations(args.entity as McpEntity | HookEntity);
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

  /** MCP servers and hooks live in files Claude also edits: merge one entry, never own the file. */
  private async sharedFileDestinations(entity: McpEntity | HookEntity): Promise<AdapterDestination[]> {
    const scope = entity.scopes[0];
    if (scope === undefined) {
      throw new DomainError('internal', `${entity.kind} ${entity.urn} has no scope`, { reason: 'missing-scope' });
    }
    const base = scope === 'personal' ? this.homedir : await resolveScopePath(entity, this.scopeDeps);
    if (entity.kind === 'mcp') {
      const file = scope === 'personal' ? join(base, '.claude.json') : join(base, '.mcp.json');
      return [{ scope, destination: file, strategy: 'merge', target: { shape: 'object-key', path: ['mcpServers'], key: entity.name, value: entity.def } }];
    }
    const file = scope === 'personal' ? join(base, '.claude/settings.json') : join(base, '.claude/settings.json');
    const handler = entity.handler;
    const key = ['command', 'url', 'prompt'].find((k) => typeof handler[k] === 'string') ?? 'type';
    return [
      {
        scope,
        destination: file,
        strategy: 'merge',
        target: {
          shape: 'array-item',
          path: ['hooks', entity.event],
          identity: { matcher: entity.matcher, 'hooks.0.type': handler['type'], [`hooks.0.${key}`]: handler[key] },
          value: { ...(entity.matcher !== undefined ? { matcher: entity.matcher } : {}), hooks: [handler] },
        },
      },
    ];
  }
}
