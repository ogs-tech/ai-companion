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

const setup = () => {
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
  const service = new SessionService(base, claudeSession, WORKSPACE, scopeDeps);
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
    expect(session.sessionId).toBe('workspace:w1');
  });

  it('spawn resolves cwd directly for a project anchor (no entity lookup)', async () => {
    const { service } = setup();
    const session = await service.spawn({ kind: 'project', projectId: 'p1' });
    expect(session.cwd).toBe('/repos/acme');
    expect(session.sessionId).toBe('project:p1');
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
