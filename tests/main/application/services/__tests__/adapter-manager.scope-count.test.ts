import { describe, expect, it } from 'vitest';
import { FakeAdapter } from '../../../../../src/main/application/services/__fixtures__/fake-adapter.js';
import { setupAdapterManager, defaultSettings } from './adapter-manager.helpers.js';
import {
  WORKSPACE_SOURCE,
  type Instruction,
  type Skill,
} from '../../../../../src/shared/entity.js';

const meta = { version: '1.0.0', createdAt: '', updatedAt: '' };

describe('AdapterManager.syncEntity counts destinations by scope', () => {
  it('returns 1 result per project instruction (destination follows entity.scopeId)', async () => {
    const adapters = [new FakeAdapter('claude', '/workspace/personal/claude')];
    const { manager, fs, registerEntity } = await setupAdapterManager(adapters, defaultSettings);
    const entity: Instruction = {
      urn: 'urn:instruction:acme',
      kind: 'instruction',
      name: 'acme',
      description: 'acme rules',
      scopes: ['project'],
      metadata: meta,
      source: WORKSPACE_SOURCE,
      content: 'body',
      scopeId: '/repos/acme',
    };
    await registerEntity(entity);
    fs.createFile('/workspace/instructions/project/acme/INSTRUCTION.md', 'body');

    const result = await manager.syncEntity({ entity });

    expect(result).toHaveLength(1);
    expect(result.filter((item) => item.adapter === 'claude')).toHaveLength(1);
  });

  it('returns 1 result for personal scope with 1 adapter', async () => {
    const adapters = [new FakeAdapter('claude', '/workspace/personal/claude')];
    const { manager, fs, registerEntity } = await setupAdapterManager(adapters, defaultSettings);
    const entity: Skill = {
      urn: 'urn:skill:foo',
      kind: 'skill',
      name: 'foo',
      description: 'desc',
      scopes: ['personal'],
      metadata: meta,
      source: WORKSPACE_SOURCE,
      content: '# foo',
    };
    await registerEntity(entity);
    fs.createFile('/workspace/skills/foo/SKILL.md', '# foo');

    const result = await manager.syncEntity({ entity });

    expect(result).toHaveLength(1);
  });
});
