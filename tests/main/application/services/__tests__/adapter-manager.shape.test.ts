import { describe, expect, it } from 'vitest';
import { FakeAdapter } from '../../../../../src/main/application/services/__fixtures__/fake-adapter.js';
import { setupAdapterManager } from './adapter-manager.helpers.js';
import { WORKSPACE_SOURCE, type Skill } from '../../../../../src/shared/entity.js';

describe('AdapterManager.syncEntity shape', () => {
  it('delegates to SettingsService and returns SyncResult[] with adapter destination status', async () => {
    const adapter = new FakeAdapter('claude', '/workspace/personal/claude', (repoPath) => `${repoPath}/.claude`);
    const { manager, fs, registerEntity } = await setupAdapterManager([adapter]);
    const entity: Skill = {
      urn: 'urn:skill:foo',
      kind: 'skill', enabled: true,
      name: 'foo',
      description: 'desc',
      scopes: ['personal'],
      metadata: { version: '1.0.0', createdAt: '', updatedAt: '' },
      source: WORKSPACE_SOURCE,
      content: '# foo',
    };
    await registerEntity(entity);
    fs.createFile('/workspace/skills/foo/SKILL.md', '# foo');

    const result = await manager.syncEntity({ entity });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      adapter: 'claude',
      destination: '/workspace/personal/claude',
      status: 'ok',
    });
  });
});
