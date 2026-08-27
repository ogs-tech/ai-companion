import { describe, it, expect } from 'vitest';
import { ClaudeAdapter } from '../../../../../src/main/infrastructure/adapters/claude-adapter.js';
import { DomainError } from '../../../../../src/main/domain/errors.js';
import {
  WORKSPACE_SOURCE,
  type Agent,
  type Instruction,
  type Skill,
} from '../../../../../src/shared/entity.js';

const meta = { version: '0.1.0', createdAt: '', updatedAt: '' };

const scopeDeps = {
  workspaceService: { get: async () => { throw new Error('not stubbed'); } },
  projectService: { get: async (id: string) => ({ id, name: 'acme', path: '/repos/acme', createdAt: '' }) },
};

const adapter = new ClaudeAdapter({ homedir: '/home/u', ...scopeDeps });

describe('ClaudeAdapter.resolveEntityDestinations', () => {
  it('routes a personal skill to ~/.claude/skills/<name>', async () => {
    const skill: Skill = { urn: 'urn:skill:demo', kind: 'skill', name: 'demo', description: 'd',
      scopes: ['personal'], metadata: meta, source: WORKSPACE_SOURCE, content: 'b' };
    expect(await adapter.resolveEntityDestinations({ entity: skill })).toEqual([
      { scope: 'personal', destination: '/home/u/.claude/skills/demo', strategy: 'symlink' },
    ]);
  });

  it('fans the personal instruction out to both ~/.claude/CLAUDE.md and ~/AGENTS.md', async () => {
    const ins: Instruction = {
      urn: 'urn:instruction:default', kind: 'instruction', name: 'default',
      description: '', scopes: ['personal'], metadata: meta,
      source: WORKSPACE_SOURCE, content: 'body',
    };
    expect(await adapter.resolveEntityDestinations({ entity: ins })).toEqual([
      { scope: 'personal', destination: '/home/u/.claude/CLAUDE.md', strategy: 'symlink' },
      { scope: 'personal', destination: '/home/u/AGENTS.md', strategy: 'symlink' },
    ]);
  });

  it('routes a project-scoped skill to <resolved project path>/.claude/skills/<name>', async () => {
    const skill: Skill = { urn: 'urn:skill:acme', kind: 'skill', name: 'acme', description: 'd',
      scopes: ['project'], scopeId: 'proj-1', metadata: meta, source: WORKSPACE_SOURCE, content: 'b' };
    expect(await adapter.resolveEntityDestinations({ entity: skill })).toEqual([
      { scope: 'project', destination: '/repos/acme/.claude/skills/acme', strategy: 'symlink' },
    ]);
  });

  it('routes a project-scoped agent to <resolved project path>/.claude/agents/<name>.md', async () => {
    const agent: Agent = { urn: 'urn:agent:triage', kind: 'agent', name: 'triage', description: 'd',
      scopes: ['project'], scopeId: 'proj-1', metadata: meta, source: WORKSPACE_SOURCE, systemPrompt: 'b' };
    expect(await adapter.resolveEntityDestinations({ entity: agent })).toEqual([
      { scope: 'project', destination: '/repos/acme/.claude/agents/triage.md', strategy: 'symlink' },
    ]);
  });

  it('routes a workspace-scoped skill to <resolved workspace root>/.claude/skills/<name>', async () => {
    const wsAdapter = new ClaudeAdapter({
      homedir: '/home/u',
      workspaceService: { get: async (id: string) => ({ id, name: 'W', rootPath: '/repos/ws', isDefault: false, createdAt: '' }) },
      projectService: { get: async () => { throw new Error('not stubbed'); } },
    });
    const skill: Skill = { urn: 'urn:skill:ws-wide', kind: 'skill', name: 'ws-wide', description: 'd',
      scopes: ['workspace'], scopeId: 'ws-1', metadata: meta, source: WORKSPACE_SOURCE, content: 'b' };
    expect(await wsAdapter.resolveEntityDestinations({ entity: skill })).toEqual([
      { scope: 'workspace', destination: '/repos/ws/.claude/skills/ws-wide', strategy: 'symlink' },
    ]);
  });

  it('rejects a project-scoped skill when the referenced project no longer exists', async () => {
    const goneAdapter = new ClaudeAdapter({
      homedir: '/home/u',
      workspaceService: { get: async () => { throw new Error('not stubbed'); } },
      projectService: { get: async () => { throw new DomainError('not_found', 'Project not found'); } },
    });
    const skill: Skill = { urn: 'urn:skill:gone', kind: 'skill', name: 'gone', description: 'd',
      scopes: ['project'], scopeId: 'gone', metadata: meta, source: WORKSPACE_SOURCE, content: 'b' };
    await expect(goneAdapter.resolveEntityDestinations({ entity: skill })).rejects.toMatchObject({ kind: 'not_found' });
  });

  it('routes a project instruction to <resolved project path>/{.claude/CLAUDE.md, AGENTS.md}', async () => {
    const ins: Instruction = {
      urn: 'urn:instruction:acme', kind: 'instruction', name: 'acme',
      description: '', scopes: ['project'], scopeId: 'proj-1', metadata: meta,
      source: WORKSPACE_SOURCE, content: 'body',
    };
    expect(await adapter.resolveEntityDestinations({ entity: ins })).toEqual([
      { scope: 'project', destination: '/repos/acme/.claude/CLAUDE.md', strategy: 'symlink' },
      { scope: 'project', destination: '/repos/acme/AGENTS.md', strategy: 'symlink' },
    ]);
  });

  it('routes a workspace instruction to <resolved workspace root>/{.claude/CLAUDE.md, AGENTS.md}', async () => {
    const wsAdapter = new ClaudeAdapter({
      homedir: '/home/u',
      workspaceService: { get: async (id: string) => ({ id, name: 'W', rootPath: '/repos/ws', isDefault: false, createdAt: '' }) },
      projectService: { get: async () => { throw new Error('not stubbed'); } },
    });
    const ins: Instruction = {
      urn: 'urn:instruction:ws-wide', kind: 'instruction', name: 'ws-wide',
      description: '', scopes: ['workspace'], scopeId: 'ws-1', metadata: meta,
      source: WORKSPACE_SOURCE, content: 'body',
    };
    expect(await wsAdapter.resolveEntityDestinations({ entity: ins })).toEqual([
      { scope: 'workspace', destination: '/repos/ws/.claude/CLAUDE.md', strategy: 'symlink' },
      { scope: 'workspace', destination: '/repos/ws/AGENTS.md', strategy: 'symlink' },
    ]);
  });

  it('rejects when the referenced project no longer exists', async () => {
    const goneAdapter = new ClaudeAdapter({
      homedir: '/home/u',
      workspaceService: { get: async () => { throw new Error('not stubbed'); } },
      projectService: { get: async () => { throw new DomainError('not_found', 'Project not found'); } },
    });
    const ins: Instruction = {
      urn: 'urn:instruction:gone', kind: 'instruction', name: 'gone',
      description: '', scopes: ['project'], scopeId: 'gone', metadata: meta,
      source: WORKSPACE_SOURCE, content: 'body',
    };
    await expect(goneAdapter.resolveEntityDestinations({ entity: ins })).rejects.toMatchObject({ kind: 'not_found' });
  });

  it('preserves non-ASCII / spaced paths as-is', async () => {
    const accented = new ClaudeAdapter({ homedir: '/Users/José Silva', ...scopeDeps });
    const skill: Skill = { urn: 'urn:skill:review', kind: 'skill', name: 'review', description: 'd',
      scopes: ['personal'], metadata: meta, source: WORKSPACE_SOURCE, content: 'b' };
    const [personal] = await accented.resolveEntityDestinations({ entity: skill });
    expect(personal?.destination).toBe('/Users/José Silva/.claude/skills/review');
  });
});
