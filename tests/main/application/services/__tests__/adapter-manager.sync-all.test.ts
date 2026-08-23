import { describe, expect, it } from 'vitest';
import { FakeAdapter } from '../../../../../src/main/application/services/__fixtures__/fake-adapter.js';
import { ClaudeAdapter } from '../../../../../src/main/infrastructure/adapters/claude-adapter.js';
import { setupAdapterManager } from './adapter-manager.helpers.js';
import { WORKSPACE_SOURCE, type Agent, type Instruction, type Scope, type Skill } from '../../../../../src/shared/entity.js';

const meta = { version: '1.0.0', createdAt: '', updatedAt: '' };

const skillEntity = (name: string, scopes: Scope[] = ['personal']): Skill => ({
  urn: `urn:skill:${name}`,
  kind: 'skill',
  name,
  description: 'desc',
  scopes,
  metadata: meta,
  source: WORKSPACE_SOURCE,
  content: `# ${name}`,
});

const agentEntity = (name: string, scopes: Scope[] = ['personal']): Agent => ({
  urn: `urn:agent:${name}`,
  kind: 'agent',
  name,
  description: 'desc',
  scopes,
  metadata: meta,
  source: WORKSPACE_SOURCE,
  systemPrompt: `# ${name}`,
});

const scopeDeps = {
  workspaceService: { get: async () => { throw new Error('not stubbed'); } },
  projectService: { get: async () => { throw new Error('not stubbed'); } },
};

const instructionEntity = (): Instruction => ({
  urn: 'urn:instruction:default',
  kind: 'instruction',
  name: 'default',
  description: '',
  scopes: ['personal'],
  metadata: meta,
  source: WORKSPACE_SOURCE,
  content: '# instructions',
});

describe('AdapterManager.syncAll', () => {
  it('aggregates results across all customizations and enabled adapters', async () => {
    const adapters = [new FakeAdapter('claude', '/personal/claude/{slug}')];
    const { manager, registerEntity, fs } = await setupAdapterManager(adapters);
    await registerEntity(skillEntity('alpha'));
    await registerEntity(agentEntity('beta'));
    fs.createFile('/workspace/skills/alpha/SKILL.md', '# alpha');
    fs.createFile('/workspace/agents/beta.md', '# beta');

    const results = await manager.syncAll({});

    expect(results).toHaveLength(2);
    const adapterIds = results.map((r) => r.adapter).sort();
    expect(adapterIds).toEqual(['claude', 'claude']);
  });

  it('filters by adapterId when provided', async () => {
    const adapters = [new FakeAdapter('claude', '/personal/claude')];
    const { manager, registerEntity, fs } = await setupAdapterManager(adapters);
    await registerEntity(skillEntity('alpha'));
    fs.createFile('/workspace/skills/alpha/SKILL.md', '# alpha');

    const results = await manager.syncAll({ adapterId: 'claude' });

    expect(results).toHaveLength(1);
    expect(results[0]?.adapter).toBe('claude');
  });

  it('falls back to defaults when SettingsService.load returns null', async () => {
    const adapter = new FakeAdapter('claude', '/personal/claude');
    const { manager } = await setupAdapterManager([adapter]);

    const results = await manager.syncAll({});

    expect(results).toEqual([]);
  });

  it('fans a single instruction out to BOTH CLAUDE.md and AGENTS.md', async () => {
    const { manager, registerEntity, fs } = await setupAdapterManager([
      new ClaudeAdapter({ homedir: '/home/u', ...scopeDeps }),
    ]);
    await registerEntity(instructionEntity());

    const results = await manager.syncAll({});

    // One instruction entity → the ClaudeAdapter fans it out to two destinations.
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.status === 'ok')).toBe(true);
    const destinations = results.map((r) => r.destination).sort();
    expect(destinations).toEqual(['/home/u/.claude/CLAUDE.md', '/home/u/AGENTS.md']);

    // Both symlinks resolve to the single instruction source in the workspace.
    expect(await fs.readlink('/home/u/.claude/CLAUDE.md')).toBe('/workspace/instructions/default.md');
    expect(await fs.readlink('/home/u/AGENTS.md')).toBe('/workspace/instructions/default.md');
  });

  it('isolates a per-entity resolveEntityDestinations failure without aborting sync for other entities', async () => {
    const failingAdapter = new FakeAdapter(
      'claude',
      '/personal/claude',
      undefined,
      (entity) => entity.name === 'broken',
    );
    const { manager, registerEntity } = await setupAdapterManager([failingAdapter]);
    await registerEntity(skillEntity('alpha'));
    await registerEntity(skillEntity('broken'));

    const results = await manager.syncAll({});

    expect(results).toHaveLength(2);
    const okResults = results.filter((r) => r.status === 'ok');
    const errorResults = results.filter((r) => r.status === 'error');
    expect(okResults).toHaveLength(1);
    expect(errorResults).toHaveLength(1);
    expect(errorResults[0]).toMatchObject({
      adapter: 'claude',
      destination: 'urn:skill:broken',
      status: 'error',
    });
  });
});

describe('AdapterManager error mapping', () => {
  it('maps generic Error from symlinkManager into status=error envelope', async () => {
    const adapter = new FakeAdapter('claude', '/personal/claude');
    const { manager, registerEntity, symlinkManager } = await setupAdapterManager([adapter]);
    const skill = skillEntity('omega');
    await registerEntity(skill);
    (symlinkManager as unknown as { create: (args: { source: string; destination: string }) => Promise<never> }).create = async () => {
      throw new Error('disk on fire');
    };

    const results = await manager.syncEntity({ entity: skill });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      adapter: 'claude',
      status: 'error',
      message: 'disk on fire',
    });
  });
});
