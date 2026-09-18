import { describe, it, expect, vi } from 'vitest';
import { buildSessionHistoryHandlers } from '../../../src/main/ipc/session-history-handlers.js';
import type { SessionHistoryService } from '../../../src/main/application/services/session-history-service.js';
import type { SessionService } from '../../../src/main/application/services/session-service.js';
import type { SessionHistoryEntry } from '../../../src/shared/session-history.js';

const entry = (overrides: Partial<SessionHistoryEntry> = {}): SessionHistoryEntry => ({
  claudeSessionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  title: 'Sessões com dash e filtros',
  cwd: '/repos/acme',
  model: 'claude-opus-5',
  costUsd: 4.4,
  costSource: 'reported',
  inputTokens: 1,
  outputTokens: 2,
  cacheCreationTokens: 3,
  cacheReadTokens: 4,
  startedAt: '2026-09-10T10:00:00.000Z',
  endedAt: '2026-09-10T10:05:00.000Z',
  durationMs: 300_000,
  ...overrides,
});

const setup = (overrides: Partial<Record<'list' | 'stats' | 'find', unknown>> = {}) => {
  const service = {
    list: vi.fn().mockResolvedValue({ entries: [], nextCursor: null, total: 0 }),
    stats: vi.fn().mockResolvedValue({ totalCostUsd: 0, unpricedCount: 0, sessionCount: 0, perDay: [], models: [] }),
    find: vi.fn().mockResolvedValue(entry()),
    ...overrides,
  } as unknown as SessionHistoryService;
  const sessionService = { adoptConversation: vi.fn().mockResolvedValue({ sessionId: 'x' }) };
  const handlers = buildSessionHistoryHandlers(
    service,
    sessionService as unknown as Pick<SessionService, 'adoptConversation'>,
  );
  return { service, sessionService, handlers };
};

describe('session-history handlers', () => {
  describe('sessionHistory.list', () => {
    it('forwards a validated scope', async () => {
      const { service, handlers } = setup();

      await handlers['sessionHistory.list']!({ scope: { kind: 'project', projectId: 'p1' } });

      expect(service.list).toHaveBeenCalledWith({ scope: { kind: 'project', projectId: 'p1' } });
    });

    it.each([
      [{ kind: 'all' }, { kind: 'all' }],
      [{ kind: 'workspace', workspaceId: 'w1' }, { kind: 'workspace', workspaceId: 'w1' }],
    ])('accepts the %o scope', async (input, expected) => {
      const { service, handlers } = setup();

      await handlers['sessionHistory.list']!({ scope: input });

      expect(service.list).toHaveBeenCalledWith({ scope: expected });
    });

    it('forwards cursor, limit and filters when given', async () => {
      const { service, handlers } = setup();

      await handlers['sessionHistory.list']!({
        scope: { kind: 'all' },
        cursor: 'abc',
        limit: 5,
        filters: { models: ['claude-opus-5'], from: '2026-09-01', to: '2026-09-30', search: 'x' },
      });

      expect(service.list).toHaveBeenCalledWith({
        scope: { kind: 'all' },
        cursor: 'abc',
        limit: 5,
        filters: { models: ['claude-opus-5'], from: '2026-09-01', to: '2026-09-30', search: 'x' },
      });
    });

    it.each([
      ['a scope of an unknown kind', { scope: { kind: 'galaxy' } }],
      ['a project scope with no id', { scope: { kind: 'project' } }],
      ['a workspace scope with no id', { scope: { kind: 'workspace' } }],
      ['no scope at all', {}],
      ['a scope that is not an object', { scope: 'all' }],
      ['a non-numeric limit', { scope: { kind: 'all' }, limit: 'ten' }],
      ['a zero limit', { scope: { kind: 'all' }, limit: 0 }],
      ['a models filter that is not an array of strings', { scope: { kind: 'all' }, filters: { models: [1] } }],
    ])('rejects %s as a validation error', async (_label, params) => {
      const { handlers } = setup();

      await expect(handlers['sessionHistory.list']!(params)).rejects.toMatchObject({ kind: 'validation' });
    });
  });

  describe('sessionHistory.stats', () => {
    it('forwards scope and filters', async () => {
      const { service, handlers } = setup();

      await handlers['sessionHistory.stats']!({ scope: { kind: 'all' }, filters: { search: 'q' } });

      expect(service.stats).toHaveBeenCalledWith({ scope: { kind: 'all' }, filters: { search: 'q' } });
    });

    it('rejects a malformed scope as a validation error', async () => {
      const { handlers } = setup();

      await expect(handlers['sessionHistory.stats']!({ scope: {} })).rejects.toMatchObject({ kind: 'validation' });
    });
  });

  describe('sessionHistory.resume', () => {
    it('adopts the conversation in the directory it actually ran in, under its own title', async () => {
      const { sessionService, handlers } = setup();

      await handlers['sessionHistory.resume']!({ claudeSessionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' });

      expect(sessionService.adoptConversation).toHaveBeenCalledWith({
        claudeSessionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        cwd: '/repos/acme',
        label: 'Sessões com dash e filtros',
      });
    });

    it('falls back to a short form of the id when the conversation never got a title', async () => {
      const { sessionService, handlers } = setup({ find: vi.fn().mockResolvedValue(entry({ title: null })) });

      await handlers['sessionHistory.resume']!({ claudeSessionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' });

      expect(sessionService.adoptConversation).toHaveBeenCalledWith(expect.objectContaining({ label: 'aaaaaaaa' }));
    });

    it('reports a missing transcript as not_found rather than spawning into nowhere', async () => {
      const { sessionService, handlers } = setup({ find: vi.fn().mockResolvedValue(undefined) });

      await expect(handlers['sessionHistory.resume']!({ claudeSessionId: 'gone' })).rejects.toMatchObject({
        kind: 'not_found',
      });
      expect(sessionService.adoptConversation).not.toHaveBeenCalled();
    });

    it('rejects a missing id as a validation error', async () => {
      const { handlers } = setup();

      await expect(handlers['sessionHistory.resume']!({})).rejects.toMatchObject({ kind: 'validation' });
    });
  });
});
