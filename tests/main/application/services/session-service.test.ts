import { describe, it, expect, vi } from 'vitest';
import { SessionService } from '../../../../src/main/application/services/session-service.js';
import { EntityService } from '../../../../src/main/application/services/entity-service.js';
import { InMemoryEntityRepository } from '../../../../src/main/infrastructure/entity/in-memory-entity-repository.js';
import { FixedClock } from '../../../../src/main/infrastructure/clock/fixed-clock.js';
import type { AdapterManager } from '../../../../src/main/application/services/adapter-manager.js';
import { FakeClaudeSessionPort } from '../../../../src/main/application/services/__fixtures__/fake-claude-session-port.js';
import { FakeEmbeddedBrowserPort } from '../../../../src/main/application/services/__fixtures__/fake-embedded-browser-port.js';
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
  const embeddedBrowser = new FakeEmbeddedBrowserPort();
  const scopeDeps = {
    workspaceService: { get: async (id: string) => ({ id, name: 'W', rootPath: '/repos/ws', isDefault: false, createdAt: '' }) },
    projectService: {
      get: async (id: string) => ({ id, name: 'acme', path: '/repos/acme', createdAt: '' }),
      findOrCreateByPath: async (path: string) => ({ id: `project-for:${path}`, name: 'adopted', path, createdAt: '' }),
    },
  };
  const fs = { mkdir: vi.fn().mockResolvedValue(undefined), writeFile: vi.fn().mockResolvedValue(undefined) };
  const service = new SessionService(base, claudeSession, embeddedBrowser, WORKSPACE, scopeDeps, fs, options);
  return { service, base, claudeSession, embeddedBrowser, fs };
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
    await service.remove(session.sessionId);
    expect(claudeSession.killed).toEqual([session.sessionId]);
    expect(service.status(session.sessionId)).toBeUndefined();
    expect(service.list()).toEqual([]);
  });

  it('remove purges an already-exited session without calling the port again', async () => {
    const { service, base, claudeSession } = setup();
    await base.save({ entity: skill('foo'), isCreate: true });
    const session = await service.spawn(entityAnchor(entityUrn('skill', 'foo')));
    claudeSession.simulateExit(session.sessionId, 0);
    await service.remove(session.sessionId);
    expect(claudeSession.killed).toEqual([]);
    expect(service.list()).toEqual([]);
  });

  it('remove on an unknown sessionId is a no-op', async () => {
    const { service } = setup();
    await expect(service.remove('entity:urn:skill:missing')).resolves.not.toThrow();
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
    await service.remove(second.sessionId);
    const third = await service.spawn(anchor);
    expect(first.label).toBe('W');
    expect(third.label).toBe('W (3)');
  });

  it('spawn for a workspace/project anchor starts a brand-new conversation, never reattaching to a sibling sharing the cwd', async () => {
    const { service, claudeSession } = setup();
    await service.spawn({ kind: 'workspace', workspaceId: 'w1' });
    expect(claudeSession.spawnCalls[0]?.opts.conversation.mode).toBe('start');
  });

  it("spawn for an entity anchor's first-ever session also starts a conversation — there is none to reattach to yet", async () => {
    const { service, base, claudeSession } = setup();
    await base.save({ entity: skill('foo'), isCreate: true });
    await service.spawn(entityAnchor(entityUrn('skill', 'foo')));
    expect(claudeSession.spawnCalls[0]?.opts.conversation.mode).toBe('start');
  });

  it('hands the CLI a UUID it minted, and reports the same id on the snapshot, so a session and its transcript share a name', async () => {
    const { service, claudeSession } = setup();

    const session = await service.spawn({ kind: 'workspace', workspaceId: 'w1' });

    expect(session.claudeSessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(claudeSession.spawnCalls[0]?.opts.conversation.claudeSessionId).toBe(session.claudeSessionId);
  });

  it('gives two sessions of the same anchor different conversations, so neither can capture the other one', async () => {
    const { service } = setup();

    const first = await service.spawn({ kind: 'workspace', workspaceId: 'w1' });
    const second = await service.spawn({ kind: 'workspace', workspaceId: 'w1' });

    expect(second.claudeSessionId).not.toBe(first.claudeSessionId);
  });

  it('reopening an exited entity session resumes its original conversation instead of minting a second one', async () => {
    const { service, base, claudeSession } = setup();
    await base.save({ entity: skill('foo'), isCreate: true });
    const anchor = entityAnchor(entityUrn('skill', 'foo'));
    const first = await service.spawn(anchor);
    claudeSession.simulateExit(first.sessionId, 0);
    claudeSession.spawnCalls.length = 0;

    const reopened = await service.spawn(anchor);

    expect(reopened.claudeSessionId).toBe(first.claudeSessionId);
    expect(claudeSession.spawnCalls[0]?.opts.conversation).toEqual({
      mode: 'resume',
      claudeSessionId: first.claudeSessionId,
    });
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

  it('reattaches to the exact conversation it is relaunching, by id', async () => {
    const { service, claudeSession } = setup();
    const session = await service.spawn({ kind: 'workspace', workspaceId: 'w1' });
    claudeSession.simulateExit(session.sessionId, 0);
    claudeSession.spawnCalls.length = 0;

    await service.resume(session.sessionId);

    expect(claudeSession.spawnCalls[0]?.opts.conversation).toEqual({
      mode: 'resume',
      claudeSessionId: session.claudeSessionId,
    });
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
  describe('adoptConversation', () => {
    it('registers a conversation that only existed on disk as an ordinary live session', async () => {
      const { service, claudeSession } = setup();

      const adopted = await service.adoptConversation({
        claudeSessionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        cwd: '/repos/from-history',
        label: 'Sessões com dash e filtros',
      });

      expect(adopted.status).toBe('running');
      expect(adopted.label).toBe('Sessões com dash e filtros');
      expect(adopted.claudeSessionId).toBe('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
      expect(service.list().map((s) => s.sessionId)).toContain('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
      expect(claudeSession.spawnCalls[0]?.opts.conversation).toEqual({
        mode: 'resume',
        claudeSessionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      });
    });

    it('anchors it to the directory it actually ran in, registering that directory as a project if it is not one yet', async () => {
      const { service } = setup();

      const adopted = await service.adoptConversation({
        claudeSessionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        cwd: '/repos/from-history',
        label: 'x',
      });

      expect(adopted.anchor).toEqual({ kind: 'project', projectId: 'project-for:/repos/from-history' });
      expect(adopted.cwd).toBe('/repos/from-history');
    });

    it('reattaches to an already-running adoption instead of forking a second PTY onto the same conversation', async () => {
      const { service, claudeSession } = setup();
      const input = { claudeSessionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', cwd: '/repos/x', label: 'x' };
      await service.adoptConversation(input);

      await service.adoptConversation(input);

      expect(claudeSession.spawnCalls).toHaveLength(1);
    });

    it('is single-flight, so a double-click cannot start two PTYs under one id', async () => {
      const { service, claudeSession } = setup();
      const input = { claudeSessionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', cwd: '/repos/x', label: 'x' };

      await Promise.all([service.adoptConversation(input), service.adoptConversation(input)]);

      expect(claudeSession.spawnCalls).toHaveLength(1);
    });
  });
});

describe('SessionService browser toggle', () => {
  it('setBrowserEnabled rejects not_found for an unknown sessionId', async () => {
    const { service } = setup();
    const err = await service.setBrowserEnabled('entity:urn:skill:missing', true).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).kind).toBe('not_found');
  });

  it('enabling creates the embedded browser and flips the flag on the snapshot', async () => {
    const { service, base, embeddedBrowser } = setup();
    await base.save({ entity: skill('foo'), isCreate: true });
    const session = await service.spawn(entityAnchor(entityUrn('skill', 'foo')));
    expect(session.browserEnabled).toBe(false);

    const updated = await service.setBrowserEnabled(session.sessionId, true);

    expect(updated.browserEnabled).toBe(true);
    expect(embeddedBrowser.createCalls).toEqual([session.sessionId]);
    expect(service.status(session.sessionId)?.browserEnabled).toBe(true);
  });

  it('enabling twice is idempotent — only creates the view once', async () => {
    const { service, base, embeddedBrowser } = setup();
    await base.save({ entity: skill('foo'), isCreate: true });
    const session = await service.spawn(entityAnchor(entityUrn('skill', 'foo')));
    await service.setBrowserEnabled(session.sessionId, true);
    await service.setBrowserEnabled(session.sessionId, true);
    expect(embeddedBrowser.createCalls).toEqual([session.sessionId]);
  });

  it('disabling destroys the embedded browser and flips the flag off', async () => {
    const { service, base, embeddedBrowser } = setup();
    await base.save({ entity: skill('foo'), isCreate: true });
    const session = await service.spawn(entityAnchor(entityUrn('skill', 'foo')));
    await service.setBrowserEnabled(session.sessionId, true);

    const updated = await service.setBrowserEnabled(session.sessionId, false);

    expect(updated.browserEnabled).toBe(false);
    expect(embeddedBrowser.destroyCalls).toEqual([session.sessionId]);
  });

  it('disabling when already off is a no-op', async () => {
    const { service, base, embeddedBrowser } = setup();
    await base.save({ entity: skill('foo'), isCreate: true });
    const session = await service.spawn(entityAnchor(entityUrn('skill', 'foo')));
    await service.setBrowserEnabled(session.sessionId, false);
    expect(embeddedBrowser.destroyCalls).toEqual([]);
  });

  it('the next resume carries the ephemeral mcpConfigPath the embedded browser returned', async () => {
    const { service, base, claudeSession } = setup();
    await base.save({ entity: skill('foo'), isCreate: true });
    const session = await service.spawn(entityAnchor(entityUrn('skill', 'foo')));
    await service.setBrowserEnabled(session.sessionId, true);
    claudeSession.simulateExit(session.sessionId, 0);
    claudeSession.spawnCalls.length = 0;

    await service.resume(session.sessionId);

    expect(claudeSession.spawnCalls[0]?.opts.mcpConfigPath).toMatch(/config\.json$/);
  });

  it('a session whose browser was never enabled spawns with no mcpConfigPath', async () => {
    const { service, claudeSession } = setup();
    await service.spawn({ kind: 'workspace', workspaceId: 'w1' });
    expect(claudeSession.spawnCalls[0]?.opts.mcpConfigPath).toBeUndefined();
  });

  it('kill leaves the embedded browser and its config file alone — it is not a real teardown', async () => {
    const { service, base, embeddedBrowser } = setup();
    await base.save({ entity: skill('foo'), isCreate: true });
    const session = await service.spawn(entityAnchor(entityUrn('skill', 'foo')));
    await service.setBrowserEnabled(session.sessionId, true);

    service.kill(session.sessionId);

    expect(embeddedBrowser.destroyCalls).toEqual([]);
    expect(service.status(session.sessionId)?.browserEnabled).toBe(true);
  });

  it('resume after kill reuses the same mcpConfigPath rather than regenerating it', async () => {
    const { service, base, claudeSession, embeddedBrowser } = setup();
    await base.save({ entity: skill('foo'), isCreate: true });
    const session = await service.spawn(entityAnchor(entityUrn('skill', 'foo')));
    await service.setBrowserEnabled(session.sessionId, true);
    service.kill(session.sessionId);

    await service.resume(session.sessionId);

    expect(embeddedBrowser.createCalls).toEqual([session.sessionId]);
    const paths = claudeSession.spawnCalls.map((c) => c.opts.mcpConfigPath).filter(Boolean);
    expect(new Set(paths).size).toBe(1);
  });

  it('reopening an exited entity-anchor session (spawn, not resume) carries browserEnabled and its config path forward', async () => {
    const { service, base, claudeSession, embeddedBrowser } = setup();
    await base.save({ entity: skill('foo'), isCreate: true });
    const anchor = entityAnchor(entityUrn('skill', 'foo'));
    const first = await service.spawn(anchor);
    await service.setBrowserEnabled(first.sessionId, true);
    claudeSession.simulateExit(first.sessionId, 0);

    const reopened = await service.spawn(anchor);

    expect(reopened.browserEnabled).toBe(true);
    expect(embeddedBrowser.createCalls).toEqual([first.sessionId]);
    expect(claudeSession.spawnCalls.at(-1)?.opts.mcpConfigPath).toBeDefined();
  });

  it('remove tears down the embedded browser when it was enabled', async () => {
    const { service, base, embeddedBrowser } = setup();
    await base.save({ entity: skill('foo'), isCreate: true });
    const session = await service.spawn(entityAnchor(entityUrn('skill', 'foo')));
    await service.setBrowserEnabled(session.sessionId, true);

    await service.remove(session.sessionId);

    expect(embeddedBrowser.destroyCalls).toEqual([session.sessionId]);
  });

  it('remove does not touch the embedded browser when it was never enabled', async () => {
    const { service, base, embeddedBrowser } = setup();
    await base.save({ entity: skill('foo'), isCreate: true });
    const session = await service.spawn(entityAnchor(entityUrn('skill', 'foo')));

    await service.remove(session.sessionId);

    expect(embeddedBrowser.destroyCalls).toEqual([]);
  });
});

describe('SessionService.stageAttachment', () => {
  it('creates the workspace attachments dir and writes the decoded buffer under it', async () => {
    const { service, fs } = setup();
    const dataBase64 = Buffer.from('image bytes').toString('base64');

    const absolutePath = await service.stageAttachment('screenshot.png', dataBase64);

    expect(fs.mkdir).toHaveBeenCalledWith(`${WORKSPACE}/attachments`, { recursive: true });
    expect(absolutePath.startsWith(`${WORKSPACE}/attachments/`)).toBe(true);
    expect(absolutePath.endsWith('-screenshot.png')).toBe(true);
    expect(fs.writeFile).toHaveBeenCalledWith(absolutePath, Buffer.from('image bytes'));
  });

  it('strips any directory components from a supplied file name', async () => {
    const { service } = setup();
    const dataBase64 = Buffer.from('x').toString('base64');

    const absolutePath = await service.stageAttachment('../../etc/passwd', dataBase64);

    expect(absolutePath.endsWith('-passwd')).toBe(true);
    expect(absolutePath.includes('..')).toBe(false);
  });

  it('strips control characters and normalizes whitespace in a supplied file name', async () => {
    const { service } = setup();
    const dataBase64 = Buffer.from('x').toString('base64');

    const absolutePath = await service.stageAttachment('Screenshot 2026-09-19\r\nat 12.00.00.png', dataBase64);

    expect(absolutePath.includes('\r')).toBe(false);
    expect(absolutePath.includes('\n')).toBe(false);
    expect(absolutePath.endsWith('-Screenshot_2026-09-19_at_12.00.00.png')).toBe(true);
  });

  it('rejects a payload over the 5MB attachment limit', async () => {
    const { service } = setup();
    const dataBase64 = Buffer.alloc(5 * 1024 * 1024 + 1).toString('base64');

    await expect(service.stageAttachment('big.png', dataBase64)).rejects.toMatchObject({ kind: 'validation' });
  });

  it('rejects a dataBase64 string long enough to decode past the limit before ever decoding it', async () => {
    const { service, fs } = setup();
    const tooLong = 'A'.repeat(Math.ceil((5 * 1024 * 1024 + 1) * (4 / 3)) + 4);

    await expect(service.stageAttachment('big.png', tooLong)).rejects.toMatchObject({ kind: 'validation' });
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it('rejects a dataBase64 string that is not valid base64', async () => {
    const { service } = setup();

    await expect(service.stageAttachment('x.png', 'not-base64!!!')).rejects.toMatchObject({ kind: 'validation' });
  });
});
