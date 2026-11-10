import { describe, expect, it } from 'vitest';
import { FakeAdapter } from '../../../../../src/main/application/services/__fixtures__/fake-adapter.js';
import { setupAdapterManager, defaultSettings } from './adapter-manager.helpers.js';
import { WORKSPACE_SOURCE, type Skill } from '../../../../../src/shared/entity.js';
import type { Settings } from '../../../../../src/shared/settings.js';

const baseSkill = (overrides: Partial<Skill> = {}): Skill => ({
  urn: `urn:skill:${overrides.name ?? 'foo'}`,
  kind: 'skill',
  name: 'foo',
  description: 'desc',
  scopes: ['personal'],
  metadata: { version: '1.0.0', createdAt: '', updatedAt: '' },
  source: WORKSPACE_SOURCE,
  content: '# foo',
  ...overrides,
});

describe('AdapterManager.removeEntity', () => {
  it('removes symlinks for a single entity across all registered adapters', async () => {
    const claude = new FakeAdapter('claude', '/personal/claude/skills/alpha');
    const { manager, registerEntity, fs } = await setupAdapterManager([claude]);
    const skill = baseSkill({ name: 'alpha' });
    await registerEntity(skill);
    fs.createFile('/workspace/skills/alpha/SKILL.md', '# alpha');
    await fs.symlink({ target: '/workspace/skills/alpha', path: '/personal/claude/skills/alpha' });

    const results = await manager.removeEntity({ entity: skill });

    expect(results).toHaveLength(1);
    expect(results.map((r) => r.adapter).sort()).toEqual(['claude']);
    expect(results.every((r) => r.status === 'ok')).toBe(true);
    expect(await fs.pathExists('/personal/claude/skills/alpha')).toBe(false);
  });

  it('removes symlinks even when adapter is disabled in settings', async () => {
    const adapter = new FakeAdapter('claude', '/personal/claude/skills/beta');
    const disabled: Settings = {
      ...defaultSettings,
      adapters: {
        claude: { enabled: false },
        cursor: { enabled: false }, lmstudio: { enabled: false },
      },
    };
    const { manager, registerEntity, fs } = await setupAdapterManager([adapter], disabled);
    const skill = baseSkill({ name: 'beta' });
    await registerEntity(skill);
    await fs.symlink({ target: '/workspace/skills/beta', path: '/personal/claude/skills/beta' });

    const results = await manager.removeEntity({ entity: skill });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      adapter: 'claude',
      destination: '/personal/claude/skills/beta',
      status: 'ok',
    });
    expect(await fs.pathExists('/personal/claude/skills/beta')).toBe(false);
  });

  it('returns ok with details.skipped="not-found" when symlink does not exist', async () => {
    const adapter = new FakeAdapter('claude', '/personal/claude/skills/missing');
    const { manager, registerEntity } = await setupAdapterManager([adapter]);
    const skill = baseSkill({ name: 'missing' });
    await registerEntity(skill);

    const results = await manager.removeEntity({ entity: skill });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      adapter: 'claude',
      destination: '/personal/claude/skills/missing',
      status: 'ok',
      details: { skipped: 'not-found' },
    });
  });

  it('maps generic Error from symlinkManager.removeIfExists into status=error envelope', async () => {
    const adapter = new FakeAdapter('claude', '/personal/claude/skills/omega');
    const { manager, registerEntity, symlinkManager, fs } = await setupAdapterManager([adapter]);
    const skill = baseSkill({ name: 'omega' });
    await registerEntity(skill);
    await fs.symlink({ target: '/workspace/skills/omega', path: '/personal/claude/skills/omega' });
    (symlinkManager as unknown as { removeIfExists: (args: { destination: string }) => Promise<never> }).removeIfExists = async () => {
      throw new Error('disk on fire');
    };

    const results = await manager.removeEntity({ entity: skill });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      adapter: 'claude',
      status: 'error',
      message: 'disk on fire',
    });
  });
});
