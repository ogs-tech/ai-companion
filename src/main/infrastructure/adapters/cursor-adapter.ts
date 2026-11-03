import { join } from 'node:path';
import type { Adapter, AdapterDestination } from '../../application/ports/adapter.js';
import type { Entity, HookEntity, Instruction, McpEntity } from '../../../shared/entity.js';
import type { WorkspaceService } from '../../application/services/workspace-service.js';
import { resolveScopePath } from '../../application/resolve-scope-path.js';
import { DomainError } from '../../domain/errors.js';
import { CURSOR_HOOKS_VERSION, translateHookToCursor } from '../../application/entity/hook-translation.js';
import {
  CURSOR_PLUGIN_ID,
  CURSOR_PLUGIN_JSON_MARKER,
  CURSOR_PLUGIN_MANIFEST_SUBPATH,
  CURSOR_PLUGIN_PERSONAL_RULE_FILE,
  CURSOR_PLUGIN_RULES_SUBPATH,
  CURSOR_RULE_MDC_MARKER,
  renderCursorPersonalRule,
  renderCursorWorkspaceRule,
  renderCursorPluginManifest,
} from '../../application/entity/cursor-plugin-manifest.js';

export interface CursorAdapterDeps {
  homedir: string;
  workspaceService: Pick<WorkspaceService, 'get'>;
}

/**
 * Publishes workspace entities into Cursor's native file surface.
 *
 * - Skills / agents (scope `personal`) → `~/.cursor/{skills,agents}/…` (symlink).
 * - Personal Instruction → materialized as a Cursor local plugin under
 *   `~/.cursor/plugins/ai-companion/` (the "hack": Cursor loads plugin rules at
 *   startup and applies rules with `alwaysApply: true` to every conversation,
 *   which is the closest analogue to Claude's home-level CLAUDE.md today —
 *   native `~/.cursor/rules/*.mdc` support is not stable as of this writing).
 * - Workspace Instruction → `<scope path>/.cursor/rules/<name>.mdc` (write, marker-owned,
 *   `alwaysApply: true`). `<scope path>/AGENTS.md` belongs to the Claude adapter's symlink.
 * - MCP servers / hooks → merged entry in `mcp.json` / `hooks.json` (`~/.cursor/` or `<scope path>/.cursor/`).
 */
export class CursorAdapter implements Adapter {
  readonly adapterId = 'cursor';
  private readonly homedir: string;
  private readonly scopeDeps: Pick<CursorAdapterDeps, 'workspaceService' | 'homedir'>;

  constructor(deps: CursorAdapterDeps) {
    if (deps.homedir === undefined || deps.homedir === null || deps.homedir === '') {
      throw new DomainError('internal', 'CursorAdapter requires a non-empty homedir', {
        reason: 'missing-homedir',
      });
    }
    this.homedir = deps.homedir;
    this.scopeDeps = { workspaceService: deps.workspaceService, homedir: deps.homedir };
  }

  async resolveEntityDestinations(args: { entity: Entity }): Promise<AdapterDestination[]> {
    const { kind, name, scopes } = args.entity;

    if (kind === 'instruction') {
      const instruction = args.entity as Instruction;
      if (instruction.scopes[0] === 'personal') {
        return this.personalInstructionDestinations(instruction);
      }
      const scope = instruction.scopes[0];
      if (scope === undefined) {
        throw new DomainError('internal', `Instruction ${instruction.urn} has no scope`, {
          reason: 'missing-scope',
        });
      }
      const repoPath = await resolveScopePath(instruction, this.scopeDeps);
      return [
        {
          scope,
          destination: join(repoPath, '.cursor', 'rules', `${instruction.name}.mdc`),
          strategy: 'write' as const,
          content: renderCursorWorkspaceRule(instruction),
          ownershipMarker: CURSOR_RULE_MDC_MARKER,
          ownershipCheck: 'includes' as const,
        },
      ];
    }

    if (kind === 'mcp' || kind === 'hook') {
      return this.sharedFileDestinations(args.entity as McpEntity | HookEntity);
    }

    if (kind !== 'skill' && kind !== 'agent') {
      return [];
    }

    const subfolder = kind === 'skill' ? '.cursor/skills' : '.cursor/agents';
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

  private async sharedFileDestinations(entity: McpEntity | HookEntity): Promise<AdapterDestination[]> {
    const scope = entity.scopes[0];
    if (scope === undefined) {
      throw new DomainError('internal', `${entity.kind} ${entity.urn} has no scope`, { reason: 'missing-scope' });
    }
    const base = scope === 'personal' ? this.homedir : await resolveScopePath(entity, this.scopeDeps);
    if (entity.kind === 'mcp') {
      const file = join(base, '.cursor', 'mcp.json');
      return [{ scope, destination: file, strategy: 'merge', target: { shape: 'object-key', path: ['mcpServers'], key: entity.name, value: toCursorMcpDef(entity.def) } }];
    }
    const file = join(base, '.cursor', 'hooks.json');
    const translated = translateHookToCursor(entity);
    if (!translated.ok) return [{ scope, destination: file, strategy: 'skip', reason: `${entity.name}: ${translated.reason}` }];
    return [
      {
        scope,
        destination: file,
        strategy: 'merge',
        seed: { version: CURSOR_HOOKS_VERSION },
        target: { shape: 'array-item', path: ['hooks', translated.event], identity: translated.identity, value: translated.item },
      },
    ];
  }

  private personalInstructionDestinations(instruction: Instruction): AdapterDestination[] {
    const pluginRoot = join(this.homedir, '.cursor', 'plugins', CURSOR_PLUGIN_ID);
    return [
      {
        scope: 'personal',
        destination: join(pluginRoot, CURSOR_PLUGIN_MANIFEST_SUBPATH),
        strategy: 'write',
        content: renderCursorPluginManifest(),
        ownershipMarker: CURSOR_PLUGIN_JSON_MARKER,
        ownershipCheck: 'includes',
      },
      {
        scope: 'personal',
        destination: join(pluginRoot, CURSOR_PLUGIN_RULES_SUBPATH, CURSOR_PLUGIN_PERSONAL_RULE_FILE),
        strategy: 'write',
        content: renderCursorPersonalRule(instruction),
        ownershipMarker: CURSOR_RULE_MDC_MARKER,
        ownershipCheck: 'includes',
      },
    ];
  }
}

/**
 * Cursor's `mcp.json` entries are `{ command, args, env }` or `{ url }`; the
 * `type` discriminator is Claude's, so it is dropped (Cursor infers the transport).
 */
function toCursorMcpDef(def: Record<string, unknown>): Record<string, unknown> {
  const { type: _type, ...rest } = def;
  void _type;
  return rest;
}
