import { describe, it, expect, vi } from 'vitest';
import { SessionService } from '../../../../src/main/application/services/session-service.js';
import { EntityService } from '../../../../src/main/application/services/entity-service.js';
import { InMemoryEntityRepository } from '../../../../src/main/infrastructure/entity/in-memory-entity-repository.js';
import { FixedClock } from '../../../../src/main/infrastructure/clock/fixed-clock.js';
import type { AdapterManager } from '../../../../src/main/application/services/adapter-manager.js';
import { FakeClaudeSessionPort } from '../../../../src/main/application/services/__fixtures__/fake-claude-session-port.js';
import { WORKSPACE_SOURCE, entityUrn, type Skill, type ProjectInstruction } from '../../../../src/shared/entity.js';
import { DomainError } from '../../../../src/main/domain/errors.js';

const WORKSPACE = '/home/user/.ai-companion';

const skill = (name = 'foo'): Skill => ({
  urn: entityUrn('skill', name), kind: 'skill', name, description: '',
  scopes: ['personal'], metadata: { version: '0.1.0', createdAt: '', updatedAt: '' },
  source: WORKSPACE_SOURCE, content: 'body',
});

const projectInstruction = (name = 'acme', repoPath = '/repos/acme'): ProjectInstruction => ({
  urn: entityUrn('instruction', name), kind: 'instruction', name, description: '',
  scopes: ['project'], metadata: { version: '0.0.0', createdAt: '', updatedAt: '' },
  source: WORKSPACE_SOURCE, content: '# notes\n', repoPath,
});

const setup = () => {
  const repo = new InMemoryEntityRepository();
  const adapterManager = {
    syncEntity: vi.fn().mockResolvedValue([]),
    removeEntity: vi.fn().mockResolvedValue([]),
  } as unknown as AdapterManager;
  const base = new EntityService(repo, new FixedClock(new Date('2026-04-26T10:00:00.000Z')), adapterManager);
  const claudeSession = new FakeClaudeSessionPort();
  const service = new SessionService(base, claudeSession, WORKSPACE);
  return { service, base, claudeSession };
};

describe('SessionService', () => {
  it('spawn resolves cwd to the workspace root for a skill', async () => {
    const { service, base } = setup();
    await base.save({ entity: skill('foo'), isCreate: true });
    const session = await service.spawn(entityUrn('skill', 'foo'));
    expect(session.cwd).toBe(WORKSPACE);
    expect(session.status).toBe('running');
  });

  it('spawn resolves cwd to repoPath for a project instruction', async () => {
    const { service, base } = setup();
    await base.save({ entity: projectInstruction('acme', '/repos/acme'), isCreate: true });
    const session = await service.spawn(entityUrn('instruction', 'acme'));
    expect(session.cwd).toBe('/repos/acme');
  });

  it('spawn reuses the existing live session for the same entityUrn (idempotent open)', async () => {
    const { service, base, claudeSession } = setup();
    await base.save({ entity: skill('foo'), isCreate: true });
    const first = await service.spawn(entityUrn('skill', 'foo'));
    const second = await service.spawn(entityUrn('skill', 'foo'));
    expect(second).toEqual(first);
    expect(claudeSession.spawnCalls).toHaveLength(1);
  });

  it('spawn starts a new PTY when the previous session for the entity has exited', async () => {
    const { service, base, claudeSession } = setup();
    await base.save({ entity: skill('foo'), isCreate: true });
    await service.spawn(entityUrn('skill', 'foo'));
    claudeSession.simulateExit(entityUrn('skill', 'foo'), 0);
    await service.spawn(entityUrn('skill', 'foo'));
    expect(claudeSession.spawnCalls).toHaveLength(2);
  });

  it('spawn rejects with not_found for an entity that does not exist', async () => {
    const { service } = setup();
    const err = await service.spawn('urn:skill:missing').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).kind).toBe('not_found');
  });

  it('spawn wraps a port failure as an io DomainError', async () => {
    const { service, base, claudeSession } = setup();
    await base.save({ entity: skill('foo'), isCreate: true });
    claudeSession.failNextSpawn(new Error('claude CLI not found in PATH'));
    const err = await service.spawn(entityUrn('skill', 'foo')).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).kind).toBe('io');
  });

  it('write forwards data to the port for a running session', async () => {
    const { service, base, claudeSession } = setup();
    await base.save({ entity: skill('foo'), isCreate: true });
    await service.spawn(entityUrn('skill', 'foo'));
    service.write(entityUrn('skill', 'foo'), 'hello\n');
    expect(claudeSession.writes).toEqual([[entityUrn('skill', 'foo'), 'hello\n']]);
  });

  it('write is a no-op once the session has exited', async () => {
    const { service, base, claudeSession } = setup();
    await base.save({ entity: skill('foo'), isCreate: true });
    await service.spawn(entityUrn('skill', 'foo'));
    claudeSession.simulateExit(entityUrn('skill', 'foo'), 0);
    service.write(entityUrn('skill', 'foo'), 'hello\n');
    expect(claudeSession.writes).toEqual([]);
  });

  it('kill marks the session exited and calls the port; a second kill is a no-op', async () => {
    const { service, base, claudeSession } = setup();
    await base.save({ entity: skill('foo'), isCreate: true });
    await service.spawn(entityUrn('skill', 'foo'));
    service.kill(entityUrn('skill', 'foo'));
    service.kill(entityUrn('skill', 'foo'));
    expect(claudeSession.killed).toEqual([entityUrn('skill', 'foo')]);
    expect(service.status(entityUrn('skill', 'foo'))?.status).toBe('exited');
  });

  it('the running → exited transition happens when the port reports the PTY exited', async () => {
    const { service, base, claudeSession } = setup();
    await base.save({ entity: skill('foo'), isCreate: true });
    await service.spawn(entityUrn('skill', 'foo'));
    claudeSession.simulateExit(entityUrn('skill', 'foo'), 1);
    expect(service.status(entityUrn('skill', 'foo'))?.status).toBe('exited');
  });

  it('killAll kills every running session and leaves exited ones alone', async () => {
    const { service, base, claudeSession } = setup();
    await base.save({ entity: skill('foo'), isCreate: true });
    await base.save({ entity: skill('bar'), isCreate: true });
    await service.spawn(entityUrn('skill', 'foo'));
    await service.spawn(entityUrn('skill', 'bar'));
    claudeSession.simulateExit(entityUrn('skill', 'bar'), 0);
    service.killAll();
    expect(claudeSession.killed).toEqual([entityUrn('skill', 'foo')]);
  });

  it('onOutput relays chunks emitted by the port for any session', async () => {
    const { service, base, claudeSession } = setup();
    await base.save({ entity: skill('foo'), isCreate: true });
    await service.spawn(entityUrn('skill', 'foo'));
    const received: Array<[string, string]> = [];
    service.onOutput((sessionId, chunk) => received.push([sessionId, chunk]));
    claudeSession.simulateData(entityUrn('skill', 'foo'), 'hello');
    expect(received).toEqual([[entityUrn('skill', 'foo'), 'hello']]);
  });

  it('onExit relays the exit code alongside the exited status', async () => {
    const { service, base, claudeSession } = setup();
    await base.save({ entity: skill('foo'), isCreate: true });
    await service.spawn(entityUrn('skill', 'foo'));
    const received: Array<[string, string, number]> = [];
    service.onExit((sessionId, status, exitCode) => received.push([sessionId, status, exitCode]));
    claudeSession.simulateExit(entityUrn('skill', 'foo'), 7);
    expect(received).toEqual([[entityUrn('skill', 'foo'), 'exited', 7]]);
  });

  it('spawn deduplicates concurrent calls for the same entityUrn (single-flight)', async () => {
    const { service, base, claudeSession } = setup();
    await base.save({ entity: skill('foo'), isCreate: true });
    const first = service.spawn(entityUrn('skill', 'foo'));
    const second = service.spawn(entityUrn('skill', 'foo'));
    const [result1, result2] = await Promise.all([first, second]);
    expect(result1).toEqual(result2);
    expect(claudeSession.spawnCalls).toHaveLength(1);
  });
});
