import { describe, it, expect } from 'vitest';
import { CursorAdapter } from '../../../../../src/main/infrastructure/adapters/cursor-adapter.js';
import {
  WORKSPACE_SOURCE,
  type Agent,
  type Instruction,
  type Skill,
} from '../../../../../src/shared/entity.js';
import {
  CURSOR_PLUGIN_JSON_MARKER,
  CURSOR_RULE_MDC_MARKER,
} from '../../../../../src/main/application/entity/cursor-plugin-manifest.js';
import { brand } from '../../../../../src/shared/brand.js';

const meta = { version: '0.1.0', createdAt: '', updatedAt: '' };

const scopeDeps = {
  workspaceService: { get: async () => { throw new Error('not stubbed'); } },
  projectService: { get: async (id: string) => ({ id, name: 'acme', path: '/repos/acme', createdAt: '' }) },
};

const adapter = new CursorAdapter({ homedir: '/home/u', ...scopeDeps });

describe('CursorAdapter.resolveEntityDestinations', () => {
  it('routes a personal skill to ~/.cursor/skills/<name> (directory)', async () => {
    const skill: Skill = { urn: 'urn:skill:demo', kind: 'skill', name: 'demo', description: 'd',
      scopes: ['personal'], metadata: meta, source: WORKSPACE_SOURCE, content: 'b' };
    expect(await adapter.resolveEntityDestinations({ entity: skill })).toEqual([
      { scope: 'personal', destination: '/home/u/.cursor/skills/demo', strategy: 'symlink' },
    ]);
  });

  it('routes an explicit-only skill (slash-command) to the same skills directory', async () => {
    const command: Skill = { urn: 'urn:skill:deploy', kind: 'skill', name: 'deploy', description: 'd',
      scopes: ['personal'], metadata: meta, source: WORKSPACE_SOURCE, content: 'b', explicitOnly: true };
    expect(await adapter.resolveEntityDestinations({ entity: command })).toEqual([
      { scope: 'personal', destination: '/home/u/.cursor/skills/deploy', strategy: 'symlink' },
    ]);
  });

  it('drops project-scoped skill/agent destinations while linkedRepos is being replaced', async () => {
    // Skill/agent scope 'project' is temporarily a no-op — see the TODO in
    // CursorAdapter.resolveEntityDestinations.
    const skill: Skill = { urn: 'urn:skill:multi', kind: 'skill', name: 'multi', description: 'd',
      scopes: ['personal', 'project'], metadata: meta, source: WORKSPACE_SOURCE, content: 'b' };
    expect(await adapter.resolveEntityDestinations({ entity: skill })).toEqual([
      { scope: 'personal', destination: '/home/u/.cursor/skills/multi', strategy: 'symlink' },
    ]);
  });

  it('returns [] for a project-only agent (linkedRepos gone; no per-agent repoPath yet)', async () => {
    const agent: Agent = { urn: 'urn:agent:triage', kind: 'agent', name: 'triage', description: 'd',
      scopes: ['project'], metadata: meta, source: WORKSPACE_SOURCE, systemPrompt: 'b' };
    expect(await adapter.resolveEntityDestinations({ entity: agent })).toEqual([]);
  });

  it('materializes the personal instruction as a Cursor plugin (manifest + rule)', async () => {
    const ins: Instruction = {
      urn: 'urn:instruction:default', kind: 'instruction', name: 'default',
      description: 'Global instructions', scopes: ['personal'], metadata: meta,
      source: WORKSPACE_SOURCE, content: 'Reply in pt-BR.',
    };
    const out = await adapter.resolveEntityDestinations({ entity: ins });
    expect(out).toHaveLength(2);
    const [manifest, rule] = out;
    expect(manifest).toMatchObject({
      scope: 'personal',
      destination: `/home/u/.cursor/plugins/${brand.cursorPluginId}/.cursor-plugin/plugin.json`,
      strategy: 'write',
      ownershipMarker: CURSOR_PLUGIN_JSON_MARKER,
      ownershipCheck: 'includes',
    });
    expect(rule).toMatchObject({
      scope: 'personal',
      destination: `/home/u/.cursor/plugins/${brand.cursorPluginId}/rules/personal-default.mdc`,
      strategy: 'write',
      ownershipMarker: CURSOR_RULE_MDC_MARKER,
      ownershipCheck: 'includes',
    });
    // sanity: rule body contains the instruction content.
    expect((rule as { content: string }).content).toContain('Reply in pt-BR.');
    // sanity: rule opens with valid Cursor frontmatter (Cursor requires --- as line 1).
    expect((rule as { content: string }).content.startsWith('---\n')).toBe(true);
  });

  it('routes a project instruction to <resolved project path>/AGENTS.md (write, marker-owned)', async () => {
    const ins: Instruction = {
      urn: 'urn:instruction:acme', kind: 'instruction', name: 'acme',
      description: '', scopes: ['project'], scopeId: 'proj-1', metadata: meta,
      source: WORKSPACE_SOURCE, content: 'body',
    };
    const result = await adapter.resolveEntityDestinations({ entity: ins });
    expect(result).toEqual([
      {
        scope: 'project',
        destination: '/repos/acme/AGENTS.md',
        strategy: 'write',
        content: expect.stringContaining('body'),
      },
    ]);
  });
});
