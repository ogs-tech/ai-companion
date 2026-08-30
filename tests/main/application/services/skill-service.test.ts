import { describe, it, expect } from 'vitest';
import { SkillService } from '../../../../src/main/application/services/skill-service.js';
import { EntityService } from '../../../../src/main/application/services/entity-service.js';
import { InMemoryEntityRepository } from '../../../../src/main/infrastructure/entity/in-memory-entity-repository.js';
import { FixedClock } from '../../../../src/main/infrastructure/clock/fixed-clock.js';
import type { AdapterManager } from '../../../../src/main/application/services/adapter-manager.js';
import { vi } from 'vitest';
import { WORKSPACE_SOURCE, type Skill } from '../../../../src/shared/entity.js';
import { skillId } from '../../../../src/main/domain/skill-id.js';

const skill = (name = 'demo'): Skill => ({
  urn: `urn:skill:${name}`, kind: 'skill', name, description: 'd', scopes: ['personal'],
  metadata: { version: '0.1.0', createdAt: '', updatedAt: '' }, source: WORKSPACE_SOURCE, content: 'b',
});

const setup = () => {
  const repo = new InMemoryEntityRepository();
  const adapterManager = { syncEntity: vi.fn().mockResolvedValue([]), removeEntity: vi.fn().mockResolvedValue([]) } as unknown as AdapterManager;
  const base = new EntityService(repo, new FixedClock(new Date('2026-04-26T10:00:00.000Z')), adapterManager);
  return { repo, service: new SkillService(base) };
};

describe('SkillService', () => {
  it('lists only workspace skills when there are no plugin deps', async () => {
    const { service } = setup();
    await service.save({ skill: skill(), isCreate: true });
    const list = await service.list();
    expect(list.map((s) => s.name)).toEqual(['demo']);
    expect(list[0]?.source).toEqual(WORKSPACE_SOURCE);
  });

  it('rejects saving a plugin-sourced skill', async () => {
    const { service } = setup();
    const pluginSkill: Skill = { ...skill(), source: { kind: 'plugin', pluginId: 'p', provenance: 'workspace-managed' } };
    await expect(service.save({ skill: pluginSkill })).rejects.toMatchObject({ kind: 'validation' });
  });

  it('gets by branded id', async () => {
    const { service } = setup();
    await service.save({ skill: skill(), isCreate: true });
    expect((await service.get(skillId('demo'))).urn).toBe('urn:skill:demo');
  });

  it('resolvePath returns the skill\'s canonical source file path', async () => {
    const { service } = setup();
    await service.save({ skill: skill(), isCreate: true });
    expect(await service.resolvePath(skillId('demo'))).toBe('/in-memory/urn:skill:demo');
  });
});
