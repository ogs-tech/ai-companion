import { describe, expect, it } from 'vitest';
import { FakeAdapter } from '../../../../../src/main/application/services/__fixtures__/fake-adapter.js';
import { setupAdapterManager } from './adapter-manager.helpers.js';
import { WORKSPACE_SOURCE, type Skill } from '../../../../../src/shared/entity.js';

const meta = { version: '1.0.0', createdAt: '', updatedAt: '' };

const skillEntity = (name: string): Skill => ({
  urn: `urn:skill:${name}`,
  kind: 'skill',
  name,
  description: 'desc',
  scopes: ['personal'],
  metadata: meta,
  source: WORKSPACE_SOURCE,
  content: `# ${name}`,
});

describe('AdapterManager.removeAllAdapterSymlinks', () => {
  it('removes workspace-pointing symlinks across every registered adapter and aggregates the result', async () => {
    const claude = new FakeAdapter('claude', '/personal/claude/skills/alpha');
    const other = new FakeAdapter('other', '/personal/other/skills/alpha');
    const { manager, registerEntity, fs } = await setupAdapterManager([claude, other]);

    await registerEntity(skillEntity('alpha'));
    await fs.symlink({ target: '/workspace/skills/alpha', path: '/personal/claude/skills/alpha' });
    await fs.symlink({ target: '/workspace/skills/alpha', path: '/personal/other/skills/alpha' });

    const result = await manager.removeAllAdapterSymlinks();

    expect(result).toEqual({ removed: 2, skipped: 0, errors: [] });
    expect(await fs.pathExists('/personal/claude/skills/alpha')).toBe(false);
    expect(await fs.pathExists('/personal/other/skills/alpha')).toBe(false);
  });

  it('leaves symlinks that point outside the workspace untouched (counts them as skipped)', async () => {
    const claude = new FakeAdapter('claude', '/personal/claude/skills/alpha');
    const { manager, registerEntity, fs } = await setupAdapterManager([claude]);

    await registerEntity(skillEntity('alpha'));
    // A symlink the user created by hand, pointing elsewhere — restore must not touch it.
    await fs.symlink({ target: '/somewhere/else/alpha', path: '/personal/claude/skills/alpha' });

    const result = await manager.removeAllAdapterSymlinks();

    expect(result).toEqual({ removed: 0, skipped: 1, errors: [] });
    expect(await fs.pathExists('/personal/claude/skills/alpha')).toBe(true);
  });

  it('returns zeroed totals when there are no adapters', async () => {
    const { manager } = await setupAdapterManager([]);

    const result = await manager.removeAllAdapterSymlinks();

    expect(result).toEqual({ removed: 0, skipped: 0, errors: [] });
  });
});

describe('AdapterManager.removeAdapterSymlinks per-entity error isolation', () => {
  it('surfaces a per-entity resolveEntityDestinations failure as an error without aborting removal for other entities', async () => {
    const claude = new FakeAdapter(
      'claude',
      '/personal/claude/skills/alpha',
      undefined,
      (entity) => entity.name === 'broken',
    );
    const { manager, registerEntity, fs } = await setupAdapterManager([claude]);

    await registerEntity(skillEntity('alpha'));
    await registerEntity(skillEntity('broken'));
    await fs.symlink({ target: '/workspace/skills/alpha', path: '/personal/claude/skills/alpha' });

    const result = await manager.removeAdapterSymlinks('claude');

    expect(result.removed).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ destination: 'urn:skill:broken' });
    expect(await fs.pathExists('/personal/claude/skills/alpha')).toBe(false);
  });
});
