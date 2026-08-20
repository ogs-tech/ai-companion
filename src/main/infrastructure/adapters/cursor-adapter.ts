import { join } from 'node:path';
import type { Adapter, AdapterDestination } from '../../application/ports/adapter.js';
import type { Entity, Instruction, PersonalInstruction, ProjectInstruction } from '../../../shared/entity.js';
import { DomainError } from '../../domain/errors.js';
import { renderAgentsFile } from '../../application/entity/agents-file.js';
import {
  CURSOR_PLUGIN_ID,
  CURSOR_PLUGIN_JSON_MARKER,
  CURSOR_PLUGIN_MANIFEST_SUBPATH,
  CURSOR_PLUGIN_PERSONAL_RULE_FILE,
  CURSOR_PLUGIN_RULES_SUBPATH,
  CURSOR_RULE_MDC_MARKER,
  renderCursorPersonalRule,
  renderCursorPluginManifest,
} from '../../application/entity/cursor-plugin-manifest.js';

export interface CursorAdapterDeps {
  homedir: string;
}

/**
 * Publishes workspace entities into Cursor's native file surface.
 *
 * - Skills / agents (scope `personal`) → `~/.cursor/{skills,agents}/…` (symlink).
 * - Skills / agents (scope `project`) → `<repo>/.cursor/…` per linked repo (symlink).
 * - Personal Instruction → materialized as a Cursor local plugin under
 *   `~/.cursor/plugins/ai-companion/` (the "hack": Cursor loads plugin rules at
 *   startup and applies rules with `alwaysApply: true` to every conversation,
 *   which is the closest analogue to Claude's home-level CLAUDE.md today —
 *   native `~/.cursor/rules/*.mdc` support is not stable as of this writing).
 * - Project Instruction → `<entity.repoPath>/AGENTS.md` (write, marker-owned).
 */
export class CursorAdapter implements Adapter {
  readonly adapterId = 'cursor';
  private readonly homedir: string;

  constructor(deps: CursorAdapterDeps) {
    if (deps.homedir === undefined || deps.homedir === null || deps.homedir === '') {
      throw new DomainError('internal', 'CursorAdapter requires a non-empty homedir', {
        reason: 'missing-homedir',
      });
    }
    this.homedir = deps.homedir;
  }

  resolveEntityDestinations(args: { entity: Entity }): AdapterDestination[] {
    const { kind, name, scopes } = args.entity;

    if (kind === 'instruction') {
      const instruction = args.entity as Instruction;
      if (instruction.scopes[0] === 'personal') {
        return this.personalInstructionDestinations(instruction as PersonalInstruction);
      }
      const project = instruction as ProjectInstruction;
      return [
        {
          scope: 'project' as const,
          destination: join(project.repoPath, 'AGENTS.md'),
          strategy: 'write' as const,
          content: renderAgentsFile(project),
        },
      ];
    }

    if (kind !== 'skill' && kind !== 'agent') {
      return [];
    }

    // TODO(follow-up): skill/agent scope 'project' is temporarily blocked at
    // the schema level while linkedRepos is removed.
    const subfolder = kind === 'skill' ? '.cursor/skills' : '.cursor/agents';
    const fileName = kind === 'skill' ? name : `${name}.md`;
    const out: AdapterDestination[] = [];

    if (scopes.includes('personal')) {
      out.push({ scope: 'personal', destination: join(this.homedir, subfolder, fileName), strategy: 'symlink' });
    }
    return out;
  }

  private personalInstructionDestinations(instruction: PersonalInstruction): AdapterDestination[] {
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
