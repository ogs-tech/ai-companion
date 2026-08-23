import { describe, expect, it } from 'vitest';
import { CursorAdapter } from '../../../../../src/main/infrastructure/adapters/cursor-adapter.js';
import { ClaudeAdapter } from '../../../../../src/main/infrastructure/adapters/claude-adapter.js';
import { WORKSPACE_SOURCE, type Skill } from '../../../../../src/shared/entity.js';
import type { Settings } from '../../../../../src/shared/settings.js';
import { setupAdapterManager } from '../../../application/services/__tests__/adapter-manager.helpers.js';

const skill: Skill = {
  urn: 'urn:skill:demo', kind: 'skill', name: 'demo', description: 'd',
  scopes: ['personal'], metadata: { version: '1.0.0', createdAt: '', updatedAt: '' },
  source: WORKSPACE_SOURCE, content: 'b',
};

const settings = (cursorEnabled: boolean): Settings => ({
  adapters: { claude: { enabled: true }, cursor: { enabled: cursorEnabled } },  ui: { theme: 'system' },
  language: 'off',
});

const scopeDeps = {
  workspaceService: { get: async () => { throw new Error('not stubbed'); } },
  projectService: { get: async () => { throw new Error('not stubbed'); } },
};

describe('CursorAdapter wiring through AdapterManager', () => {
  it('plans a ~/.cursor destination when cursor is enabled', async () => {
    const claude = new ClaudeAdapter({ homedir: '/home/u', ...scopeDeps });
    const cursor = new CursorAdapter({ homedir: '/home/u', ...scopeDeps });
    const { manager, registerEntity } = await setupAdapterManager([claude, cursor], settings(true));
    await registerEntity(skill);

    const plan = await manager.planDestinations();
    const destinations = plan.map((p) => p.destination);

    expect(destinations).toContain('/home/u/.cursor/skills/demo');
    expect(destinations).toContain('/home/u/.claude/skills/demo');
  });

  it('plans NO .cursor destination when cursor is disabled', async () => {
    const claude = new ClaudeAdapter({ homedir: '/home/u', ...scopeDeps });
    const cursor = new CursorAdapter({ homedir: '/home/u', ...scopeDeps });
    const { manager, registerEntity } = await setupAdapterManager([claude, cursor], settings(false));
    await registerEntity(skill);

    const plan = await manager.planDestinations();

    expect(plan.some((p) => p.destination.includes('/.cursor/'))).toBe(false);
    expect(plan.some((p) => p.adapterId === 'cursor')).toBe(false);
  });
});
