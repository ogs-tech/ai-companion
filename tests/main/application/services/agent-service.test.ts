import { describe, it, expect, vi } from 'vitest';
import { AgentService } from '../../../../src/main/application/services/agent-service.js';
import { EntityService } from '../../../../src/main/application/services/entity-service.js';
import { InMemoryEntityRepository } from '../../../../src/main/infrastructure/entity/in-memory-entity-repository.js';
import { FixedClock } from '../../../../src/main/infrastructure/clock/fixed-clock.js';
import type { AdapterManager } from '../../../../src/main/application/services/adapter-manager.js';
import { WORKSPACE_SOURCE, type Agent } from '../../../../src/shared/entity.js';
import { agentId } from '../../../../src/main/domain/agent-id.js';

const agent = (name = 'rev'): Agent => ({
  urn: `urn:agent:${name}`, kind: 'agent', name, description: 'reviewer', scopes: ['personal'],
  metadata: { version: '0.1.0', createdAt: '', updatedAt: '' }, source: WORKSPACE_SOURCE, systemPrompt: 'You review.',
});

const setup = () => {
  const repo = new InMemoryEntityRepository();
  const adapterManager = { syncEntity: vi.fn().mockResolvedValue([]), removeEntity: vi.fn().mockResolvedValue([]) } as unknown as AdapterManager;
  const base = new EntityService(repo, new FixedClock(new Date('2026-04-26T10:00:00.000Z')), adapterManager);
  return { service: new AgentService(base) };
};

describe('AgentService', () => {
  it('saves and gets a canonical agent', async () => {
    const { service } = setup();
    await service.save({ agent: agent(), isCreate: true });
    const got = await service.get(agentId('rev'));
    expect(got.urn).toBe('urn:agent:rev');
    expect(got.systemPrompt).toBe('You review.');
  });

  it('rejects saving a plugin-sourced agent', async () => {
    const { service } = setup();
    const pluginAgent: Agent = { ...agent(), source: { kind: 'plugin', pluginId: 'p', provenance: 'workspace-managed' } };
    await expect(service.save({ agent: pluginAgent })).rejects.toMatchObject({ kind: 'validation' });
  });

  it('resolvePath returns the agent\'s canonical source file path', async () => {
    const { service } = setup();
    await service.save({ agent: agent(), isCreate: true });
    expect(await service.resolvePath(agentId('rev'))).toBe('/in-memory/urn:agent:rev');
  });
});
