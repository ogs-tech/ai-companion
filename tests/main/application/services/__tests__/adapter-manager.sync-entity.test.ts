import { describe, it, expect } from 'vitest';
import { setupAdapterManager } from './adapter-manager.helpers.js';
import { ClaudeAdapter } from '../../../../../src/main/infrastructure/adapters/claude-adapter.js';
import { WORKSPACE_SOURCE, type Skill } from '../../../../../src/shared/entity.js';

const scopeDeps = {
  workspaceService: { get: async () => { throw new Error('not stubbed'); } },
  projectService: { get: async () => { throw new Error('not stubbed'); } },
};

describe('AdapterManager.syncEntity', () => {
  it('creates a symlink for a personal skill', async () => {
    const { manager, fs } = await setupAdapterManager([new ClaudeAdapter({ homedir: '/home/u', ...scopeDeps })]);
    const skill: Skill = { urn: 'urn:skill:demo', kind: 'skill', name: 'demo', description: 'd',
      scopes: ['personal'], metadata: { version: '0.1.0', createdAt: '', updatedAt: '' },
      source: WORKSPACE_SOURCE, content: 'b' };
    const report = await manager.syncEntity({ entity: skill });
    expect(report.every((r) => r.status === 'ok')).toBe(true);
    const link = await fs.lstat('/home/u/.claude/skills/demo');
    expect(link.kind).toBe('symlink');
    expect(link.target).toBe('/workspace/skills/demo');
  });
});
