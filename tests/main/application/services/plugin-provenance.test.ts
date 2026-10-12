import { describe, it, expect, vi } from 'vitest';
import {
  PluginProvenanceService,
  provenanceKey,
} from '../../../../src/main/application/services/plugin-provenance.js';
import type { ClaudeCodePluginRegistryPort } from '../../../../src/main/application/ports/claude-code-plugin-registry-port.js';
import { SkillService } from '../../../../src/main/application/services/skill-service.js';
import { AgentService } from '../../../../src/main/application/services/agent-service.js';
import { EntityService } from '../../../../src/main/application/services/entity-service.js';
import { InMemoryEntityRepository } from '../../../../src/main/infrastructure/entity/in-memory-entity-repository.js';
import { InMemoryFileSystem } from '../../../../src/main/infrastructure/filesystem/in-memory-filesystem.js';
import { FixedClock } from '../../../../src/main/infrastructure/clock/fixed-clock.js';
import { FakePluginCachePort } from '../../../../src/main/application/services/__fixtures__/fake-plugin-cache-port.js';
import { skillId } from '../../../../src/main/domain/skill-id.js';
import { pluginId } from '../../../../src/main/domain/plugin-id.js';
import { OperationNotAllowedForOriginError } from '../../../../src/main/domain/plugin-errors.js';
import type { AdapterManager } from '../../../../src/main/application/services/adapter-manager.js';
import { WORKSPACE_SOURCE, type Skill, type Agent } from '../../../../src/shared/entity.js';
import { scopedRepository } from '../../helpers/scoped-repository.js';

const FROZEN = new Date('2026-04-26T10:00:00.000Z');

const fakeEntityAdapterManager = () =>
  ({
    syncEntity: vi.fn().mockResolvedValue([]),
    removeEntity: vi.fn().mockResolvedValue([]),
  }) as unknown as AdapterManager;

const skillFile = (name: string) =>
  `---\nname: ${name}\ntype: skill\ndescription: from plugin\nscopes:\n  - personal\nversion: 1.0.0\ncreatedAt: ${FROZEN.toISOString()}\nupdatedAt: ${FROZEN.toISOString()}\n---\nplugin skill body\n`;

const skill = (name: string, content = 'x'): Skill => ({
  urn: `urn:skill:${name}`,
  kind: 'skill',
  name,
  description: `skill ${name}`,
  scopes: ['personal'],
  metadata: { version: '0.1.0', createdAt: FROZEN.toISOString(), updatedAt: FROZEN.toISOString() },
  source: WORKSPACE_SOURCE,
  content,
});

const agentFile = (name: string) =>
  `---\nname: ${name}\ntype: agent\ndescription: plugin agent\nscopes:\n  - personal\nversion: 1.0.0\ncreatedAt: ${FROZEN.toISOString()}\nupdatedAt: ${FROZEN.toISOString()}\n---\nplugin agent body\n`;

const agent = (name: string, systemPrompt = 'x'): Agent => ({
  urn: `urn:agent:${name}`,
  kind: 'agent',
  name,
  description: `agent ${name}`,
  scopes: ['personal'],
  metadata: { version: '0.1.0', createdAt: FROZEN.toISOString(), updatedAt: FROZEN.toISOString() },
  source: WORKSPACE_SOURCE,
  systemPrompt,
});

describe('PluginProvenanceService (real)', () => {
  it('returns empty map when no plugin meta exists', async () => {
    const cache = new FakePluginCachePort();
    const fs = new InMemoryFileSystem();
    const svc = new PluginProvenanceService({ cache, fs });
    expect(await svc.forScope('personal')).toEqual(new Map());
  });

  it('discovers skills and agents from installed plugins', async () => {
    const cache = new FakePluginCachePort();
    const fs = new InMemoryFileSystem();
    const pid = pluginId('superpowers');
    cache.seedMeta('personal', {
      version: 2,
      plugins: [
        {
          id: pid,
          origin: 'imported',
          installedAt: FROZEN.toISOString(),
          scope: 'personal',
          enabled: true,
        },
      ],
    });
    const dir = cache.pluginDir('personal', pid);
    await fs.writeFile(`${dir}/skills/foo/SKILL.md`, skillFile('foo'));
    await fs.writeFile(`${dir}/skills/bar/SKILL.md`, skillFile('bar'));
    await fs.writeFile(`${dir}/agents/reviewer.md`, agentFile('reviewer'));

    const svc = new PluginProvenanceService({ cache, fs });
    const map = await svc.forScope('personal');
    expect(map.get(provenanceKey({ type: 'skill', name: 'foo' }))).toBe(pid);
    expect(map.get(provenanceKey({ type: 'skill', name: 'bar' }))).toBe(pid);
    expect(map.get(provenanceKey({ type: 'agent', name: 'reviewer' }))).toBe(pid);
  });

  it('skips silently when plugin dir is missing', async () => {
    const cache = new FakePluginCachePort();
    const fs = new InMemoryFileSystem();
    cache.seedMeta('personal', {
      version: 2,
      plugins: [
        {
          id: 'ghost',
          origin: 'imported',
          installedAt: FROZEN.toISOString(),
          scope: 'personal',
          enabled: true,
        },
      ],
    });
    const svc = new PluginProvenanceService({ cache, fs });
    expect(await svc.forScope('personal')).toEqual(new Map());
  });
});

describe('SkillService — provenance merging', () => {
  const setup = () => {
    const repo = new InMemoryEntityRepository();
    const cache = new FakePluginCachePort();
    const fs = new InMemoryFileSystem();
    const clock = new FixedClock(FROZEN);
    const adapterManager = fakeEntityAdapterManager();
    const base = new EntityService(scopedRepository({ global: repo }).scoped, clock, adapterManager);
    const provenance = new PluginProvenanceService({ cache, fs });
    const skills = new SkillService(base, { provenance, fs });
    return { repo, cache, fs, skills };
  };

  it('list merges workspace skills with plugin-provided skills', async () => {
    const { repo, cache, fs, skills } = setup();
    await repo.save(skill('local', 'l'));
    const pid = pluginId('superpowers');
    cache.seedMeta('personal', {
      version: 2,
      plugins: [
        {
          id: pid,
          origin: 'imported',
          installedAt: FROZEN.toISOString(),
          scope: 'personal',
          enabled: true,
        },
      ],
    });
    await fs.writeFile(
      `${cache.pluginDir('personal', pid)}/skills/from-plugin/SKILL.md`,
      skillFile('from-plugin'),
    );

    const list = await skills.list('personal');
    expect(list).toHaveLength(2);
    const local = list.find((s) => s.name === 'local');
    const fromPlugin = list.find((s) => s.name === 'from-plugin');
    expect(local!.source.kind).toBe('workspace');
    expect(fromPlugin!.source.kind).toBe('plugin');
    if (fromPlugin!.source.kind === 'plugin') {
      expect(fromPlugin!.source.pluginId).toBe('superpowers');
    }
  });

  it('list prefers workspace when name collides with a plugin-provided skill', async () => {
    const { repo, cache, fs, skills } = setup();
    await repo.save(skill('foo', 'workspace'));
    const pid = pluginId('superpowers');
    cache.seedMeta('personal', {
      version: 2,
      plugins: [
        {
          id: pid,
          origin: 'imported',
          installedAt: FROZEN.toISOString(),
          scope: 'personal',
          enabled: true,
        },
      ],
    });
    await fs.writeFile(
      `${cache.pluginDir('personal', pid)}/skills/foo/SKILL.md`,
      skillFile('foo'),
    );

    const list = await skills.list('personal');
    expect(list).toHaveLength(1);
    expect(list[0]!.source.kind).toBe('workspace');
    expect((list[0] as Skill).content).toBe('workspace');
  });

  it('save throws OperationNotAllowedForOriginError when input has plugin source', async () => {
    const { skills } = setup();
    await expect(
      skills.save({
        skill: {
          ...skill('foo'),
          source: { kind: 'plugin', pluginId: pluginId('p'), provenance: 'workspace-managed' },
        },
      }),
    ).rejects.toThrow(OperationNotAllowedForOriginError);
  });

  it('save throws when skill name matches a plugin-provided skill', async () => {
    const { cache, fs, skills } = setup();
    const pid = pluginId('superpowers');
    cache.seedMeta('personal', {
      version: 2,
      plugins: [
        {
          id: pid,
          origin: 'imported',
          installedAt: FROZEN.toISOString(),
          scope: 'personal',
          enabled: true,
        },
      ],
    });
    await fs.writeFile(
      `${cache.pluginDir('personal', pid)}/skills/foo/SKILL.md`,
      skillFile('foo'),
    );
    await expect(
      skills.save({
        skill: skill('foo', 'x'),
        scope: 'personal',
      }),
    ).rejects.toThrow(OperationNotAllowedForOriginError);
  });

  it('delete throws when name matches a plugin-provided skill', async () => {
    const { cache, fs, skills } = setup();
    const pid = pluginId('superpowers');
    cache.seedMeta('personal', {
      version: 2,
      plugins: [
        {
          id: pid,
          origin: 'imported',
          installedAt: FROZEN.toISOString(),
          scope: 'personal',
          enabled: true,
        },
      ],
    });
    await fs.writeFile(
      `${cache.pluginDir('personal', pid)}/skills/foo/SKILL.md`,
      skillFile('foo'),
    );
    await expect(
      skills.delete({ id: skillId('foo'), removeSymlinks: false, scope: 'personal' }),
    ).rejects.toThrow(OperationNotAllowedForOriginError);
  });
});

describe('AgentService — provenance merging', () => {
  const setup = () => {
    const repo = new InMemoryEntityRepository();
    const cache = new FakePluginCachePort();
    const fs = new InMemoryFileSystem();
    const clock = new FixedClock(FROZEN);
    const adapterManager = fakeEntityAdapterManager();
    const base = new EntityService(scopedRepository({ global: repo }).scoped, clock, adapterManager);
    const provenance = new PluginProvenanceService({ cache, fs });
    const agents = new AgentService(base, { provenance, fs });
    return { repo, cache, fs, agents };
  };

  it('list includes plugin agents with plugin source', async () => {
    const { cache, fs, agents } = setup();
    const pid = pluginId('superpowers');
    cache.seedMeta('personal', {
      version: 2,
      plugins: [
        {
          id: pid,
          origin: 'imported',
          installedAt: FROZEN.toISOString(),
          scope: 'personal',
          enabled: true,
        },
      ],
    });
    await fs.writeFile(
      `${cache.pluginDir('personal', pid)}/agents/reviewer.md`,
      agentFile('reviewer'),
    );

    const list = await agents.list('personal');
    expect(list).toHaveLength(1);
    expect(list[0]!.name).toBe('reviewer');
    expect(list[0]!.source.kind).toBe('plugin');
  });

  it('save rejects plugin-source input', async () => {
    const { agents } = setup();

    await expect(
      agents.save({
        agent: {
          ...agent('reviewer'),
          source: { kind: 'plugin', pluginId: pluginId('p'), provenance: 'workspace-managed' },
        },
      }),
    ).rejects.toThrow(OperationNotAllowedForOriginError);
  });
});

describe('provenanceKey', () => {
  it('formats key as type/name', () => {
    expect(provenanceKey({ type: 'skill', name: 'foo' })).toBe('skill/foo');
    expect(provenanceKey({ type: 'agent', name: 'reviewer' })).toBe('agent/reviewer');
    expect(provenanceKey({ type: 'command', name: 'feature-dev' })).toBe('command/feature-dev');
  });
});

describe('PluginProvenanceService — commands scan', () => {
  it('discovers commands from installed plugins (commands/<name>.md)', async () => {
    const cache = new FakePluginCachePort();
    const fs = new InMemoryFileSystem();
    const pid = pluginId('feature-dev');
    cache.seedMeta('personal', {
      version: 2,
      plugins: [
        {
          id: pid,
          origin: 'imported',
          installedAt: FROZEN.toISOString(),
          scope: 'personal',
          enabled: true,
        },
      ],
    });
    const dir = cache.pluginDir('personal', pid);
    await fs.writeFile(
      `${dir}/commands/feature-dev.md`,
      `---\nname: feature-dev\ntype: command\ndescription: orchestrate feature workflow\nscopes:\n  - personal\nversion: 1.0.0\ncreatedAt: ${FROZEN.toISOString()}\nupdatedAt: ${FROZEN.toISOString()}\n---\nbody\n`,
    );

    const svc = new PluginProvenanceService({ cache, fs });
    const map = await svc.forScope('personal');
    expect(map.get(provenanceKey({ type: 'command', name: 'feature-dev' }))).toBe(pid);
  });
});

describe('PluginProvenanceService.scan — roots', () => {
  it('enumerates a Claude Code installPath and tags claude-code provenance', async () => {
    const cache = new FakePluginCachePort();
    const fs = new InMemoryFileSystem();
    fs.createFile('/cc/feature-dev/agents/code-reviewer.md', agentFile('code-reviewer'));
    fs.createFile('/cc/feature-dev/commands/feature-dev.md', skillFile('feature-dev'));

    const claudeCodeRegistry: ClaudeCodePluginRegistryPort = {
      list: async () => [
        {
          pluginId: pluginId('feature-dev'),
          marketplace: 'claude-plugins-official',
          installPath: '/cc/feature-dev',
          version: 'unknown',
          scope: 'user',
        },
      ],
    };

    const svc = new PluginProvenanceService({ cache, fs, claudeCodeRegistry });
    const refs = await svc.scan('personal');

    expect(refs).toContainEqual({
      type: 'agent',
      name: 'code-reviewer',
      pluginId: 'feature-dev',
      dir: '/cc/feature-dev',
      provenance: 'claude-code',
    });
    expect(refs.find((r) => r.type === 'command')?.provenance).toBe('claude-code');
  });

  it('excludes claude-code roots when scope is not personal', async () => {
    const cache = new FakePluginCachePort();
    const fs = new InMemoryFileSystem();
    fs.createFile('/cc/feature-dev/agents/x.md', agentFile('x'));

    const claudeCodeRegistry: ClaudeCodePluginRegistryPort = {
      list: async () => [
        {
          pluginId: pluginId('feature-dev'),
          marketplace: 'claude-plugins-official',
          installPath: '/cc/feature-dev',
          version: 'unknown',
          scope: 'user',
        },
      ],
    };

    const svc = new PluginProvenanceService({ cache, fs, claudeCodeRegistry });
    const refs = await svc.scan('project');

    expect(refs.some((r) => r.provenance === 'claude-code')).toBe(false);
  });

  it('shadows a claude-code ref when a workspace-managed plugin provides the same type/name', async () => {
    const cache = new FakePluginCachePort();
    const fs = new InMemoryFileSystem();
    cache.seedMeta('personal', {
      version: 2,
      plugins: [
        { id: 'p', origin: 'imported', installedAt: FROZEN.toISOString(), scope: 'personal', enabled: true },
      ],
    });
    // Workspace-managed dir is `${scope}/plugins/${id}` per FakePluginCachePort.
    fs.createFile('personal/plugins/p/agents/dup.md', agentFile('dup'));
    fs.createFile('/cc/q/agents/dup.md', agentFile('dup'));

    const claudeCodeRegistry: ClaudeCodePluginRegistryPort = {
      list: async () => [
        { pluginId: pluginId('q'), marketplace: 'mp', installPath: '/cc/q', version: '1', scope: 'user' },
      ],
    };

    const svc = new PluginProvenanceService({ cache, fs, claudeCodeRegistry });
    const refs = (await svc.scan('personal')).filter((r) => r.name === 'dup');
    expect(refs).toHaveLength(1);
    expect(refs[0]?.provenance).toBe('workspace-managed');
  });
});
