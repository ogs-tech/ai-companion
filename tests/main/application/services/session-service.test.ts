import { describe, it, expect, vi } from 'vitest';
import { SessionService } from '../../../../src/main/application/services/session-service.js';
import { EntityService } from '../../../../src/main/application/services/entity-service.js';
import { InMemoryEntityRepository } from '../../../../src/main/infrastructure/entity/in-memory-entity-repository.js';
import { FixedClock } from '../../../../src/main/infrastructure/clock/fixed-clock.js';
import type { AdapterManager } from '../../../../src/main/application/services/adapter-manager.js';
import { FakeClaudeSessionPort } from '../../../../src/main/application/services/__fixtures__/fake-claude-session-port.js';
import { WORKSPACE_SOURCE, entityUrn, type Skill, type Instruction } from '../../../../src/shared/entity.js';
import type { SessionAnchor } from '../../../../src/shared/session.js';
import { DomainError } from '../../../../src/main/domain/errors.js';

const WORKSPACE = '/home/user/.ai-companion';

const skill = (name = 'foo'): Skill => ({
  urn: entityUrn('skill', name), kind: 'skill', name, description: '',
  scopes: ['personal'], metadata: { version: '0.1.0', createdAt: '', updatedAt: '' },
  source: WORKSPACE_SOURCE, content: 'body',
});

const projectScopedSkill = (name = 'acme', scopeId = 'proj-1'): Skill => ({
  urn: entityUrn('skill', name), kind: 'skill', name, description: '',
  scopes: ['project'], scopeId, metadata: { version: '0.1.0', createdAt: '', updatedAt: '' },
  source: WORKSPACE_SOURCE, content: 'body',
});

const projectInstruction = (name = 'acme', scopeId = 'proj-1'): Instruction => ({
  urn: entityUrn('instruction', name), kind: 'instruction', name, description: '',
  scopes: ['project'], scopeId, metadata: { version: '0.0.0', createdAt: '', updatedAt: '' },
  source: WORKSPACE_SOURCE, content: '# notes\n',
});

const setup = (options?: { maxBufferChars?: number }) => {
  const repo = new InMemoryEntityRepository();
  const adapterManager = {
    syncEntity: vi.fn().mockResolvedValue([]),
    removeEntity: vi.fn().mockResolvedValue([]),
  } as unknown as AdapterManager;
  const base = new EntityService(repo, new FixedClock(new Date('2026-04-26T10:00:00.000Z')), adapterManager);
  const claudeSession = new FakeClaudeSessionPort();
  const scopeDeps = {
    workspaceService: { get: async (id: string) => ({ id, name: 'W', rootPath: '/repos/ws', isDefault: false, createdAt: '' }) },
    projectService: { get: async (id: string) => ({ id, name: 'acme', path: '/repos/acme', createdAt: '' }) },
  };
  const service = new SessionService(base, claudeSession, WORKSPACE, scopeDeps, options);
  return { service, base, claudeSession };
};

const entityAnchor = (urn: string): SessionAnchor => ({ kind: 'entity', urn });

describe('SessionService', () => {
  it('spawn resolves cwd to the workspace root for a skill entity anchor', async () => {
    const { service, base } = setup();
    await base.save({ entity: skill('foo'), isCreate: true });
    const session = await service.spawn(entityAnchor(entityUrn('skill', 'foo')));
    expect(session.cwd).toBe(WORKSPACE);
    expect(session.sessionId).toBe('entity:urn:skill:foo');
    expect(session.anchor).toEqual(entityAnchor(entityUrn('skill', 'foo')));
    expect(session.status).toBe('running');
  });

  it('spawn resolves cwd via resolveScopePath for a project instruction entity anchor', async () => {
    const { service, base } = setup();
    await base.save({ entity: projectInstruction('acme', 'proj-1'), isCreate: true });
    const session = await service.spawn(entityAnchor(entityUrn('instruction', 'acme')));
    expect(session.cwd).toBe('/repos/acme');
  });

  it('spawn resolves cwd via resolveScopePath for a project-scoped skill entity anchor', async () => {
    const { service, base } = setup();
    await base.save({ entity: projectScopedSkill('acme', 'proj-1'), isCreate: true });
    const session = await service.spawn(entityAnchor(entityUrn('skill', 'acme')));
    expect(session.cwd).toBe('/repos/acme');
  });

  it('spawn resolves cwd directly for a workspace anchor (no entity lookup)', async () => {
    const { service } = setup();
    const session = await service.spawn({ kind: 'workspace', workspaceId: 'w1' });
    expect(session.cwd).toBe('/repos/ws');
  });

  it('spawn resolves cwd directly for a project anchor (no entity lookup)', async () => {
    const { service } = setup();
    const session = await service.spawn({ kind: 'project', projectId: 'p1' });
    expect(session.cwd).toBe('/repos/acme');
  });

  it('spawn reuses the existing live session for the same anchor (idempotent open)', async () => {
    const { service, base, claudeSession } = setup();
    await base.save({ entity: skill('foo'), isCreate: true });
    const first = await service.spawn(entityAnchor(entityUrn('skill', 'foo')));
    const second = await service.spawn(entityAnchor(entityUrn('skill', 'foo')));
    expect(second).toEqual(first);
    expect(claudeSession.spawnCalls).toHaveLength(1);
  });

  it('spawn starts a new PTY when the previous session for the anchor has exited', async () => {
    const { service, base, claudeSession } = setup();
    await base.save({ entity: skill('foo'), isCreate: true });
    await service.spawn(entityAnchor(entityUrn('skill', 'foo')));
    claudeSession.simulateExit('entity:urn:skill:foo', 0);
    await service.spawn(entityAnchor(entityUrn('skill', 'foo')));
    expect(claudeSession.spawnCalls).toHaveLength(2);
  });

  it('spawn rejects with not_found for an entity anchor that does not exist', async () => {
    const { service } = setup();
    const err = await service.spawn(entityAnchor('urn:skill:missing')).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).kind).toBe('not_found');
  });

  it('spawn wraps a port failure as an io DomainError', async () => {
    const { service, base, claudeSession } = setup();
    await base.save({ entity: skill('foo'), isCreate: true });
    claudeSession.failNextSpawn(new Error('claude CLI not found in PATH'));
    const err = await service.spawn(entityAnchor(entityUrn('skill', 'foo'))).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).kind).toBe('io');
  });

  it('write forwards data to the port for a running session', async () => {
    const { service, base, claudeSession } = setup();
    await base.save({ entity: skill('foo'), isCreate: true });
    const session = await service.spawn(entityAnchor(entityUrn('skill', 'foo')));
    service.write(session.sessionId, 'hello\n');
    expect(claudeSession.writes).toEqual([[session.sessionId, 'hello\n']]);
  });

  it('kill marks the session exited and calls the port; a second kill is a no-op', async () => {
    const { service, base, claudeSession } = setup();
    await base.save({ entity: skill('foo'), isCreate: true });
    const session = await service.spawn(entityAnchor(entityUrn('skill', 'foo')));
    service.kill(session.sessionId);
    service.kill(session.sessionId);
    expect(claudeSession.killed).toEqual([session.sessionId]);
    expect(service.status(session.sessionId)?.status).toBe('exited');
  });

  it('remove kills a running session and purges it from list', async () => {
    const { service, base, claudeSession } = setup();
    await base.save({ entity: skill('foo'), isCreate: true });
    const session = await service.spawn(entityAnchor(entityUrn('skill', 'foo')));
    service.remove(session.sessionId);
    expect(claudeSession.killed).toEqual([session.sessionId]);
    expect(service.status(session.sessionId)).toBeUndefined();
    expect(service.list()).toEqual([]);
  });

  it('remove purges an already-exited session without calling the port again', async () => {
    const { service, base, claudeSession } = setup();
    await base.save({ entity: skill('foo'), isCreate: true });
    const session = await service.spawn(entityAnchor(entityUrn('skill', 'foo')));
    claudeSession.simulateExit(session.sessionId, 0);
    service.remove(session.sessionId);
    expect(claudeSession.killed).toEqual([]);
    expect(service.list()).toEqual([]);
  });

  it('remove on an unknown sessionId is a no-op', async () => {
    const { service } = setup();
    expect(() => service.remove('entity:urn:skill:missing')).not.toThrow();
    expect(service.list()).toEqual([]);
  });

  it('killAll kills every running session across anchor kinds, leaving exited ones alone', async () => {
    const { service, base, claudeSession } = setup();
    await base.save({ entity: skill('foo'), isCreate: true });
    const entitySession = await service.spawn(entityAnchor(entityUrn('skill', 'foo')));
    const wsSession = await service.spawn({ kind: 'workspace', workspaceId: 'w1' });
    claudeSession.simulateExit(entitySession.sessionId, 0);
    service.killAll();
    expect(claudeSession.killed).toEqual([wsSession.sessionId]);
  });

  it('onOutput/onExit relay by sessionId regardless of anchor kind', async () => {
    const { service, claudeSession } = setup();
    const session = await service.spawn({ kind: 'project', projectId: 'p1' });
    const received: Array<[string, string]> = [];
    service.onOutput((sessionId, chunk) => received.push([sessionId, chunk]));
    claudeSession.simulateData(session.sessionId, 'hello');
    expect(received).toEqual([[session.sessionId, 'hello']]);
  });

  it('spawn resolves a human-readable label for each anchor kind', async () => {
    const { service, base } = setup();
    await base.save({ entity: skill('foo'), isCreate: true });
    const entitySession = await service.spawn(entityAnchor(entityUrn('skill', 'foo')));
    const wsSession = await service.spawn({ kind: 'workspace', workspaceId: 'w1' });
    const projectSession = await service.spawn({ kind: 'project', projectId: 'p1' });
    expect(entitySession.label).toBe('foo');
    expect(wsSession.label).toBe('W');
    expect(projectSession.label).toBe('acme');
  });

  it('list returns an empty array before any session is spawned', () => {
    const { service } = setup();
    expect(service.list()).toEqual([]);
  });

  it('list returns every session, running and exited alike', async () => {
    const { service, base, claudeSession } = setup();
    await base.save({ entity: skill('foo'), isCreate: true });
    const entitySession = await service.spawn(entityAnchor(entityUrn('skill', 'foo')));
    const wsSession = await service.spawn({ kind: 'workspace', workspaceId: 'w1' });
    claudeSession.simulateExit(entitySession.sessionId, 0);

    const sessions = service.list();
    expect(sessions).toHaveLength(2);
    expect(sessions.find((s) => s.sessionId === entitySession.sessionId)?.status).toBe('exited');
    expect(sessions.find((s) => s.sessionId === wsSession.sessionId)?.status).toBe('running');
  });

  it('spawn deduplicates concurrent calls for the same anchor (single-flight)', async () => {
    const { service, base, claudeSession } = setup();
    await base.save({ entity: skill('foo'), isCreate: true });
    const anchor = entityAnchor(entityUrn('skill', 'foo'));
    const first = service.spawn(anchor);
    const second = service.spawn(anchor);
    const [result1, result2] = await Promise.all([first, second]);
    expect(result1).toEqual(result2);
    expect(claudeSession.spawnCalls).toHaveLength(1);
  });
});

describe('SessionService concurrent workspace/project sessions', () => {
  it('spawn mints a fresh sessionId on every call for a workspace anchor, and both stay live in list()', async () => {
    const { service, claudeSession } = setup();
    const anchor: SessionAnchor = { kind: 'workspace', workspaceId: 'w1' };
    const first = await service.spawn(anchor);
    const second = await service.spawn(anchor);
    expect(second.sessionId).not.toBe(first.sessionId);
    expect(claudeSession.spawnCalls).toHaveLength(2);
    const ids = service.list().map((s) => s.sessionId);
    expect(ids).toEqual(expect.arrayContaining([first.sessionId, second.sessionId]));
    expect(service.list().every((s) => s.status === 'running')).toBe(true);
  });

  it('spawn mints a fresh sessionId on every call for a project anchor, and both stay live in list()', async () => {
    const { service, claudeSession } = setup();
    const anchor: SessionAnchor = { kind: 'project', projectId: 'p1' };
    const first = await service.spawn(anchor);
    const second = await service.spawn(anchor);
    expect(second.sessionId).not.toBe(first.sessionId);
    expect(claudeSession.spawnCalls).toHaveLength(2);
    expect(service.list()).toHaveLength(2);
  });

  it('entity spawn/resume identity is unaffected by the workspace/project change (regression)', async () => {
    const { service, base, claudeSession } = setup();
    await base.save({ entity: skill('foo'), isCreate: true });
    const first = await service.spawn(entityAnchor(entityUrn('skill', 'foo')));
    const second = await service.spawn(entityAnchor(entityUrn('skill', 'foo')));
    expect(second.sessionId).toBe(first.sessionId);
    expect(claudeSession.spawnCalls).toHaveLength(1);
  });

  it('labels the first session for an anchor plainly, and numbers subsequent ones', async () => {
    const { service } = setup();
    const anchor: SessionAnchor = { kind: 'workspace', workspaceId: 'w1' };
    const first = await service.spawn(anchor);
    const second = await service.spawn(anchor);
    const third = await service.spawn(anchor);
    expect(first.label).toBe('W');
    expect(second.label).toBe('W (2)');
    expect(third.label).toBe('W (3)');
  });

  it('does not reuse an ordinal once the session holding it is removed', async () => {
    const { service } = setup();
    const anchor: SessionAnchor = { kind: 'workspace', workspaceId: 'w1' };
    const first = await service.spawn(anchor);
    const second = await service.spawn(anchor);
    service.remove(second.sessionId);
    const third = await service.spawn(anchor);
    expect(first.label).toBe('W');
    expect(third.label).toBe('W (3)');
  });

  it('spawn for a workspace/project anchor never asks to continue a prior conversation — it is always a fresh session', async () => {
    const { service, claudeSession } = setup();
    await service.spawn({ kind: 'workspace', workspaceId: 'w1' });
    expect(claudeSession.spawnCalls[0]?.opts.continueConversation).toBe(false);
  });

  it('spawn for an entity anchor still asks to continue a prior conversation, unchanged from before this feature', async () => {
    const { service, base, claudeSession } = setup();
    await base.save({ entity: skill('foo'), isCreate: true });
    await service.spawn(entityAnchor(entityUrn('skill', 'foo')));
    expect(claudeSession.spawnCalls[0]?.opts.continueConversation).toBe(true);
  });

  it('ordinal counters for different anchors are independent', async () => {
    const { service } = setup();
    await service.spawn({ kind: 'workspace', workspaceId: 'w1' });
    const secondWs = await service.spawn({ kind: 'workspace', workspaceId: 'w1' });
    const firstProject = await service.spawn({ kind: 'project', projectId: 'p1' });
    expect(secondWs.label).toBe('W (2)');
    expect(firstProject.label).toBe('acme');
  });
});

describe('SessionService.resume', () => {
  it('rejects with not_found for an unknown sessionId', async () => {
    const { service } = setup();
    const err = await service.resume('workspace:missing').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).kind).toBe('not_found');
  });

  it('is an idempotent no-op that returns the existing snapshot when the session is already running', async () => {
    const { service, claudeSession } = setup();
    const session = await service.spawn({ kind: 'workspace', workspaceId: 'w1' });
    claudeSession.spawnCalls.length = 0;
    const resumed = await service.resume(session.sessionId);
    expect(resumed).toEqual(session);
    expect(claudeSession.spawnCalls).toHaveLength(0);
  });

  it('relaunches an exited session under the same sessionId, keeping its stored label', async () => {
    const { service, claudeSession } = setup();
    const first = await service.spawn({ kind: 'workspace', workspaceId: 'w1' });
    const second = await service.spawn({ kind: 'workspace', workspaceId: 'w1' });
    claudeSession.simulateExit(second.sessionId, 0);

    const resumed = await service.resume(second.sessionId);

    expect(resumed.sessionId).toBe(second.sessionId);
    expect(resumed.label).toBe(second.label);
    expect(resumed.status).toBe('running');
    expect(claudeSession.spawnCalls.map((c) => c.sessionId)).toEqual([first.sessionId, second.sessionId, second.sessionId]);
  });

  it('resume deduplicates concurrent calls for the same sessionId (single-flight), spawning only one PTY', async () => {
    const { service, claudeSession } = setup();
    const session = await service.spawn({ kind: 'workspace', workspaceId: 'w1' });
    claudeSession.simulateExit(session.sessionId, 0);
    claudeSession.spawnCalls.length = 0;

    const first = service.resume(session.sessionId);
    const second = service.resume(session.sessionId);
    const [result1, result2] = await Promise.all([first, second]);

    expect(result1).toEqual(result2);
    expect(claudeSession.spawnCalls).toHaveLength(1);
  });

  it('resume never bumps the anchor ordinal counter', async () => {
    const { service, claudeSession } = setup();
    const anchor: SessionAnchor = { kind: 'workspace', workspaceId: 'w1' };
    const first = await service.spawn(anchor);
    claudeSession.simulateExit(first.sessionId, 0);
    await service.resume(first.sessionId);
    const second = await service.spawn(anchor);
    expect(second.label).toBe('W (2)');
  });

  it('asks the adapter to continue the conversation it is relaunching', async () => {
    const { service, claudeSession } = setup();
    const session = await service.spawn({ kind: 'workspace', workspaceId: 'w1' });
    claudeSession.simulateExit(session.sessionId, 0);
    claudeSession.spawnCalls.length = 0;

    await service.resume(session.sessionId);

    expect(claudeSession.spawnCalls[0]?.opts.continueConversation).toBe(true);
  });

  it('works for an entity-anchored session too, resuming it in place by its known sessionId', async () => {
    const { service, base, claudeSession } = setup();
    await base.save({ entity: skill('foo'), isCreate: true });
    const session = await service.spawn(entityAnchor(entityUrn('skill', 'foo')));
    claudeSession.simulateExit(session.sessionId, 0);
    const resumed = await service.resume(session.sessionId);
    expect(resumed.sessionId).toBe(session.sessionId);
    expect(resumed.status).toBe('running');
  });
});

describe('SessionService output buffering', () => {
  it('status returns the accumulated outputBuffer for a running session', async () => {
    const { service, base, claudeSession } = setup();
    await base.save({ entity: skill('foo'), isCreate: true });
    const session = await service.spawn(entityAnchor(entityUrn('skill', 'foo')));
    claudeSession.simulateData(session.sessionId, 'hello ');
    claudeSession.simulateData(session.sessionId, 'world');
    expect(service.status(session.sessionId)?.outputBuffer).toBe('hello world');
  });

  it('spawn returns the outputBuffer accumulated so far for an already-running session', async () => {
    const { service, base, claudeSession } = setup();
    await base.save({ entity: skill('foo'), isCreate: true });
    const first = await service.spawn(entityAnchor(entityUrn('skill', 'foo')));
    claudeSession.simulateData(first.sessionId, 'hi');
    const second = await service.spawn(entityAnchor(entityUrn('skill', 'foo')));
    expect(second.outputBuffer).toBe('hi');
  });

  it('outputBuffer survives a respawn after the previous process exited', async () => {
    const { service, base, claudeSession } = setup();
    await base.save({ entity: skill('foo'), isCreate: true });
    const first = await service.spawn(entityAnchor(entityUrn('skill', 'foo')));
    claudeSession.simulateData(first.sessionId, 'before exit');
    claudeSession.simulateExit(first.sessionId, 0);
    const second = await service.spawn(entityAnchor(entityUrn('skill', 'foo')));
    expect(second.outputBuffer).toBe('before exit');
  });

  it('caps the outputBuffer, dropping the oldest data once the limit is exceeded', async () => {
    const { service, base, claudeSession } = setup({ maxBufferChars: 10 });
    await base.save({ entity: skill('foo'), isCreate: true });
    const session = await service.spawn(entityAnchor(entityUrn('skill', 'foo')));
    claudeSession.simulateData(session.sessionId, '01234567890123');
    expect(service.status(session.sessionId)?.outputBuffer).toBe('4567890123');
  });

  it('list() omits outputBuffer to keep the aggregate list lightweight', async () => {
    const { service, base, claudeSession } = setup();
    await base.save({ entity: skill('foo'), isCreate: true });
    const session = await service.spawn(entityAnchor(entityUrn('skill', 'foo')));
    claudeSession.simulateData(session.sessionId, 'hi');
    expect(service.list()[0]).not.toHaveProperty('outputBuffer');
  });
});
