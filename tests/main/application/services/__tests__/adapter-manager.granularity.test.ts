import { describe, expect, it } from 'vitest';
import { FakeAdapter } from '../../../../../src/main/application/services/__fixtures__/fake-adapter.js';
import { setupAdapterManager } from './adapter-manager.helpers.js';
import { WORKSPACE_SOURCE, type Agent, type Skill } from '../../../../../src/shared/entity.js';

const meta = { version: '1.0.0', createdAt: '', updatedAt: '' };

describe('AdapterManager sync granularity by entity kind', () => {
  it('creates a directory symlink for skill entities and file symlinks for agent entities', async () => {
    const skillAdapter = new FakeAdapter('claude', '/workspace/personal/claude-skill');
    const { manager: skillManager, fs: skillFs, registerEntity: registerSkill } =
      await setupAdapterManager([skillAdapter]);

    const skillEntity: Skill = {
      urn: 'urn:skill:alpha',
      kind: 'skill', enabled: true,
      name: 'alpha',
      description: 'skill entity',
      scopes: ['personal'],
      metadata: meta,
      source: WORKSPACE_SOURCE,
      content: '# alpha',
    };
    await registerSkill(skillEntity);
    skillFs.createFile('/workspace/skills/alpha/SKILL.md', '# alpha');

    const skillResult = await skillManager.syncEntity({ entity: skillEntity });
    expect(skillResult).toHaveLength(1);
    expect(skillResult.every((entry) => entry.status === 'ok')).toBe(true);
    const skillTarget = await skillFs.readlink('/workspace/personal/claude-skill');
    expect(skillTarget).toBe('/workspace/skills/alpha');
    expect((await skillFs.lstat(skillTarget)).kind).toBe('directory');

    const agentAdapter = new FakeAdapter('claude', '/workspace/personal/claude-agent');
    const { manager: agentManager, fs: agentFs, registerEntity: registerAgent } =
      await setupAdapterManager([agentAdapter]);

    const agentEntity: Agent = {
      urn: 'urn:agent:beta',
      kind: 'agent', enabled: true,
      name: 'beta',
      description: 'agent entity',
      scopes: ['personal'],
      metadata: meta,
      source: WORKSPACE_SOURCE,
      systemPrompt: '# beta',
    };
    await registerAgent(agentEntity);
    agentFs.createFile('/workspace/agents/beta.md', '# beta');

    const agentResult = await agentManager.syncEntity({ entity: agentEntity });
    expect(agentResult).toHaveLength(1);
    expect(agentResult.every((entry) => entry.status === 'ok')).toBe(true);
    const agentTarget = await agentFs.readlink('/workspace/personal/claude-agent');
    expect(agentTarget).toBe('/workspace/agents/beta.md');
    expect((await agentFs.lstat(agentTarget)).kind).toBe('file');
  });
});
