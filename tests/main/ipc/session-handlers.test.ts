import { describe, it, expect, vi } from 'vitest';
import { buildSessionHandlers } from '../../../src/main/ipc/session-handlers.js';
import { SessionService } from '../../../src/main/application/services/session-service.js';
import { EntityService } from '../../../src/main/application/services/entity-service.js';
import { InMemoryEntityRepository } from '../../../src/main/infrastructure/entity/in-memory-entity-repository.js';
import { FixedClock } from '../../../src/main/infrastructure/clock/fixed-clock.js';
import type { AdapterManager } from '../../../src/main/application/services/adapter-manager.js';
import { FakeClaudeSessionPort } from '../../../src/main/application/services/__fixtures__/fake-claude-session-port.js';
import { WORKSPACE_SOURCE, entityUrn, type Skill } from '../../../src/shared/entity.js';

const skill = (name = 'foo'): Skill => ({
  urn: entityUrn('skill', name), kind: 'skill', name, description: '',
  scopes: ['personal'], metadata: { version: '0.1.0', createdAt: '', updatedAt: '' },
  source: WORKSPACE_SOURCE, content: 'body',
});

const setup = () => {
  const repo = new InMemoryEntityRepository();
  const adapterManager = {
    syncEntity: vi.fn().mockResolvedValue([]),
    removeEntity: vi.fn().mockResolvedValue([]),
  } as unknown as AdapterManager;
  const base = new EntityService(repo, new FixedClock(new Date('2026-04-26T10:00:00.000Z')), adapterManager);
  const claudeSession = new FakeClaudeSessionPort();
  const scopeDeps = {
    workspaceService: { get: async () => { throw new Error('not stubbed'); } },
    projectService: { get: async () => { throw new Error('not stubbed'); } },
  };
  const service = new SessionService(base, claudeSession, '/workspace', scopeDeps);
  return { service, base, claudeSession };
};

describe('session-handlers', () => {
  it('session.spawn validates entityUrn and calls service.spawn', async () => {
    const { service, base } = setup();
    await base.save({ entity: skill('foo'), isCreate: true });
    const spy = vi.spyOn(service, 'spawn');
    const h = buildSessionHandlers(service);
    await h['session.spawn']!({ entityUrn: entityUrn('skill', 'foo') });
    expect(spy).toHaveBeenCalledWith(entityUrn('skill', 'foo'));
  });

  it('session.spawn rejects a missing entityUrn', async () => {
    const { service } = setup();
    const h = buildSessionHandlers(service);
    await expect(h['session.spawn']!({})).rejects.toMatchObject({ kind: 'validation' });
  });

  it('session.write validates and forwards sessionId + data', async () => {
    const { service, base } = setup();
    await base.save({ entity: skill('foo'), isCreate: true });
    const h = buildSessionHandlers(service);
    await h['session.spawn']!({ entityUrn: entityUrn('skill', 'foo') });
    const spy = vi.spyOn(service, 'write');
    await h['session.write']!({ sessionId: entityUrn('skill', 'foo'), data: 'ls\n' });
    expect(spy).toHaveBeenCalledWith(entityUrn('skill', 'foo'), 'ls\n');
  });

  it('session.write accepts an empty data string', async () => {
    const { service, base } = setup();
    await base.save({ entity: skill('foo'), isCreate: true });
    const h = buildSessionHandlers(service);
    await h['session.spawn']!({ entityUrn: entityUrn('skill', 'foo') });
    await expect(
      h['session.write']!({ sessionId: entityUrn('skill', 'foo'), data: '' }),
    ).resolves.toBeUndefined();
  });

  it('session.resize validates numeric cols/rows', async () => {
    const { service } = setup();
    const h = buildSessionHandlers(service);
    await expect(
      h['session.resize']!({ sessionId: 'x', cols: 'wide', rows: 24 }),
    ).rejects.toMatchObject({ kind: 'validation' });
  });

  it('session.kill forwards sessionId', async () => {
    const { service, base } = setup();
    await base.save({ entity: skill('foo'), isCreate: true });
    const h = buildSessionHandlers(service);
    await h['session.spawn']!({ entityUrn: entityUrn('skill', 'foo') });
    const spy = vi.spyOn(service, 'kill');
    await h['session.kill']!({ sessionId: entityUrn('skill', 'foo') });
    expect(spy).toHaveBeenCalledWith(entityUrn('skill', 'foo'));
  });

  it('session.status returns null for an unknown session', async () => {
    const { service } = setup();
    const h = buildSessionHandlers(service);
    const result = await h['session.status']!({ sessionId: 'urn:skill:none' });
    expect(result).toBeNull();
  });

  it('session.status returns the snapshot for a live session', async () => {
    const { service, base } = setup();
    await base.save({ entity: skill('foo'), isCreate: true });
    const h = buildSessionHandlers(service);
    await h['session.spawn']!({ entityUrn: entityUrn('skill', 'foo') });
    const result = await h['session.status']!({ sessionId: entityUrn('skill', 'foo') });
    expect(result).toMatchObject({ entityUrn: entityUrn('skill', 'foo'), status: 'running' });
  });
});
