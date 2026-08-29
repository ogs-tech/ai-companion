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
    workspaceService: { get: async (id: string) => ({ id, name: 'W', rootPath: '/workspace', isDefault: false, createdAt: '' }) },
    projectService: { get: async (id: string) => ({ id, name: 'Test', path: '/project', createdAt: '' }) },
  };
  const service = new SessionService(base, claudeSession, '/workspace', scopeDeps);
  return { service, base, claudeSession };
};

describe('session-handlers', () => {
  it('session.spawn validates the anchor and calls service.spawn', async () => {
    const { service, base } = setup();
    await base.save({ entity: skill('foo'), isCreate: true });
    const spy = vi.spyOn(service, 'spawn');
    const h = buildSessionHandlers(service);
    await h['session.spawn']!({ anchor: { kind: 'entity', urn: entityUrn('skill', 'foo') } });
    expect(spy).toHaveBeenCalledWith({ kind: 'entity', urn: entityUrn('skill', 'foo') });
  });

  it('session.spawn accepts a workspace anchor', async () => {
    const { service } = setup();
    const spy = vi.spyOn(service, 'spawn');
    const h = buildSessionHandlers(service);
    await h['session.spawn']!({ anchor: { kind: 'workspace', workspaceId: 'w1' } });
    expect(spy).toHaveBeenCalledWith({ kind: 'workspace', workspaceId: 'w1' });
  });

  it('session.spawn accepts a project anchor', async () => {
    const { service } = setup();
    const spy = vi.spyOn(service, 'spawn');
    const h = buildSessionHandlers(service);
    await h['session.spawn']!({ anchor: { kind: 'project', projectId: 'p1' } });
    expect(spy).toHaveBeenCalledWith({ kind: 'project', projectId: 'p1' });
  });

  it('session.spawn rejects a missing anchor', async () => {
    const { service } = setup();
    const h = buildSessionHandlers(service);
    await expect(h['session.spawn']!({})).rejects.toMatchObject({ kind: 'validation' });
  });

  it('session.spawn rejects an anchor with an unknown kind', async () => {
    const { service } = setup();
    const h = buildSessionHandlers(service);
    await expect(h['session.spawn']!({ anchor: { kind: 'bogus' } })).rejects.toMatchObject({ kind: 'validation' });
  });

  it('session.spawn rejects an entity anchor with an empty urn', async () => {
    const { service } = setup();
    const h = buildSessionHandlers(service);
    await expect(h['session.spawn']!({ anchor: { kind: 'entity', urn: '' } })).rejects.toMatchObject({ kind: 'validation' });
  });

  it('session.write validates and forwards sessionId + data', async () => {
    const { service, base } = setup();
    await base.save({ entity: skill('foo'), isCreate: true });
    const h = buildSessionHandlers(service);
    await h['session.spawn']!({ anchor: { kind: 'entity', urn: entityUrn('skill', 'foo') } });
    const spy = vi.spyOn(service, 'write');
    await h['session.write']!({ sessionId: 'entity:urn:skill:foo', data: 'ls\n' });
    expect(spy).toHaveBeenCalledWith('entity:urn:skill:foo', 'ls\n');
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
    await h['session.spawn']!({ anchor: { kind: 'entity', urn: entityUrn('skill', 'foo') } });
    const spy = vi.spyOn(service, 'kill');
    await h['session.kill']!({ sessionId: 'entity:urn:skill:foo' });
    expect(spy).toHaveBeenCalledWith('entity:urn:skill:foo');
  });

  it('session.remove forwards sessionId', async () => {
    const { service, base } = setup();
    await base.save({ entity: skill('foo'), isCreate: true });
    const h = buildSessionHandlers(service);
    await h['session.spawn']!({ anchor: { kind: 'entity', urn: entityUrn('skill', 'foo') } });
    const spy = vi.spyOn(service, 'remove');
    await h['session.remove']!({ sessionId: 'entity:urn:skill:foo' });
    expect(spy).toHaveBeenCalledWith('entity:urn:skill:foo');
  });

  it('session.resume validates and forwards sessionId to service.resume', async () => {
    const { service } = setup();
    const spy = vi.spyOn(service, 'resume').mockResolvedValue({
      sessionId: 'workspace:w1', anchor: { kind: 'workspace', workspaceId: 'w1' },
      cwd: '/workspace', label: 'W', status: 'running', outputBuffer: '',
    });
    const h = buildSessionHandlers(service);
    const result = await h['session.resume']!({ sessionId: 'workspace:w1' });
    expect(spy).toHaveBeenCalledWith('workspace:w1');
    expect(result).toMatchObject({ sessionId: 'workspace:w1', status: 'running' });
  });

  it('session.resume rejects a missing sessionId', async () => {
    const { service } = setup();
    const h = buildSessionHandlers(service);
    await expect(h['session.resume']!({})).rejects.toMatchObject({ kind: 'validation' });
  });

  it('session.status returns null for an unknown session', async () => {
    const { service } = setup();
    const h = buildSessionHandlers(service);
    const result = await h['session.status']!({ sessionId: 'entity:urn:skill:none' });
    expect(result).toBeNull();
  });

  it('session.status returns the snapshot for a live session', async () => {
    const { service, base } = setup();
    await base.save({ entity: skill('foo'), isCreate: true });
    const h = buildSessionHandlers(service);
    await h['session.spawn']!({ anchor: { kind: 'entity', urn: entityUrn('skill', 'foo') } });
    const result = await h['session.status']!({ sessionId: 'entity:urn:skill:foo' });
    expect(result).toMatchObject({ sessionId: 'entity:urn:skill:foo', status: 'running' });
  });

  it('session.list returns an empty array when no session is live', async () => {
    const { service } = setup();
    const h = buildSessionHandlers(service);
    expect(await h['session.list']!({})).toEqual([]);
  });

  it('session.list returns every spawned session', async () => {
    const { service, base } = setup();
    await base.save({ entity: skill('foo'), isCreate: true });
    const h = buildSessionHandlers(service);
    await h['session.spawn']!({ anchor: { kind: 'entity', urn: entityUrn('skill', 'foo') } });
    const result = (await h['session.list']!({})) as Array<{ sessionId: string }>;
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ sessionId: 'entity:urn:skill:foo', label: 'foo', status: 'running' });
  });
});
