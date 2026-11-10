import { describe, expect, it } from 'vitest';
import { FakeAdapter } from '../../../../../src/main/application/services/__fixtures__/fake-adapter.js';
import { setupAdapterManager, defaultSettings } from './adapter-manager.helpers.js';
import { WORKSPACE_SOURCE, type Scope, type Skill } from '../../../../../src/shared/entity.js';
import type { Settings as SettingsType } from '../../../../../src/shared/settings.js';

const meta = { version: '1.0.0', createdAt: '', updatedAt: '' };

const baseEntity = (overrides: Partial<Pick<Skill, 'name' | 'scopes'>> = {}): Skill => ({
  urn: `urn:skill:${overrides.name ?? 'foo'}`,
  kind: 'skill',
  name: overrides.name ?? 'foo',
  description: 'desc',
  scopes: overrides.scopes ?? (['personal'] as Scope[]),
  metadata: meta,
  source: WORKSPACE_SOURCE,
  content: '# foo',
});

describe('AdapterManager.removeAll', () => {
  it('removes symlinks for all customizations of the given adapter, even when adapter is disabled in settings', async () => {
    const adapter = new FakeAdapter('claude', '/personal/claude/skills/alpha');
    const disabled: SettingsType = {
      ...defaultSettings,
      adapters: {
        claude: { enabled: false },
        cursor: { enabled: false }, lmstudio: { enabled: false },
      },
    };
    const { manager, registerEntity, fs } = await setupAdapterManager([adapter], disabled);
    await registerEntity(baseEntity({ name: 'alpha' }));
    fs.createFile('/workspace/skills/alpha/SKILL.md', '# alpha');
    await fs.symlink({ target: '/workspace/skills/alpha', path: '/personal/claude/skills/alpha' });

    const results = await manager.removeAll({ adapterId: 'claude' });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      adapter: 'claude',
      destination: '/personal/claude/skills/alpha',
      status: 'ok',
    });
    const exists = await fs.pathExists('/personal/claude/skills/alpha');
    expect(exists).toBe(false);
  });

  it('returns ok with details.skipped="not-found" when symlink does not exist', async () => {
    const adapter = new FakeAdapter('claude', '/personal/claude/skills/missing');
    const { manager, registerEntity } = await setupAdapterManager([adapter]);
    await registerEntity(baseEntity({ name: 'missing' }));

    const results = await manager.removeAll({ adapterId: 'claude' });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      adapter: 'claude',
      destination: '/personal/claude/skills/missing',
      status: 'ok',
      details: { skipped: 'not-found' },
    });
  });

  it('returns empty array when adapterId is not registered', async () => {
    const adapter = new FakeAdapter('claude', '/personal/claude');
    const { manager } = await setupAdapterManager([adapter]);

    const results = await manager.removeAll({ adapterId: 'unknown' });

    expect(results).toEqual([]);
  });

  it('maps generic Error from symlinkManager.remove into status=error envelope', async () => {
    const adapter = new FakeAdapter('claude', '/personal/claude/skills/omega');
    const { manager, registerEntity, symlinkManager, fs } = await setupAdapterManager([adapter]);
    await registerEntity(baseEntity({ name: 'omega' }));
    await fs.symlink({ target: '/workspace/skills/omega', path: '/personal/claude/skills/omega' });
    (symlinkManager as unknown as { removeIfExists: (args: { destination: string }) => Promise<never> }).removeIfExists = async () => {
      throw new Error('disk on fire');
    };

    const results = await manager.removeAll({ adapterId: 'claude' });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      adapter: 'claude',
      status: 'error',
      message: 'disk on fire',
    });
  });
});
