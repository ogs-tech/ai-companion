import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SessionsTreeGroup } from '../../../../src/renderer/components/workspace/SessionsTreeGroup.js';
import {
  getBrowserTabsSnapshot,
  openSessionTab,
  resetBrowserTabsForTests,
} from '../../../../src/renderer/lib/browser-tabs-store.js';
import { mockApi, ok, fail, renderWithShell, type CallSpy } from '../../test-utils.js';
import { intersectionObservers } from '../../setup.js';
import type { SessionHistoryEntry, SessionHistoryPage } from '../../../../src/shared/session-history.js';

const SCOPE = { kind: 'project', projectId: 'p1' } as const;

const runningSession = {
  sessionId: 'workspace:w1',
  claudeSessionId: 'conv-running',
  anchor: { kind: 'workspace' as const, workspaceId: 'w1' },
  cwd: '/repos/ws',
  label: 'Acme',
  status: 'running' as const,
};

const exitedSession = {
  sessionId: 'entity:urn:skill:foo',
  claudeSessionId: 'conv-exited',
  anchor: { kind: 'entity' as const, urn: 'urn:skill:foo' },
  cwd: '/repos/ws',
  label: 'foo',
  status: 'exited' as const,
};

const entry = (overrides: Partial<SessionHistoryEntry> = {}): SessionHistoryEntry => ({
  claudeSessionId: 'conv-running',
  title: 'Título gerado',
  cwd: '/repos/ws',
  model: 'claude-opus-5',
  costUsd: 4.4,
  costSource: 'reported',
  inputTokens: 10,
  outputTokens: 20,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  startedAt: '2026-09-10T10:00:00.000Z',
  endedAt: '2026-09-10T10:05:00.000Z',
  durationMs: 300_000,
  ...overrides,
});

const page = (entries: SessionHistoryEntry[], nextCursor: string | null = null): SessionHistoryPage => ({
  entries,
  nextCursor,
  total: entries.length,
});

const stats = (overrides: Record<string, unknown> = {}) => ({
  totalCostUsd: 31.8,
  unpricedCount: 0,
  sessionCount: 41,
  perDay: [],
  models: ['claude-opus-5'],
  ...overrides,
});

let call: CallSpy;

/** Routes each IPC method to a canned answer; every test overrides only what it cares about. */
function route(overrides: Partial<Record<string, unknown>> = {}): void {
  call.mockImplementation(async (method: string) => {
    if (method in overrides) {
      const value = overrides[method];
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown)() : value;
    }
    if (method === 'session.list') return ok([]);
    if (method === 'sessionHistory.list') return ok(page([]));
    if (method === 'sessionHistory.stats') return ok(stats());
    return ok(undefined);
  });
}

beforeEach(() => {
  call = mockApi();
  route();
});

afterEach(() => {
  resetBrowserTabsForTests();
});

const render = (props: Partial<React.ComponentProps<typeof SessionsTreeGroup>> = {}) =>
  renderWithShell(<SessionsTreeGroup scope={SCOPE} onOpen={vi.fn()} {...props} />);

describe('SessionsTreeGroup', () => {
  describe('merging live sessions with the transcripts on disk', () => {
    it('shows a running session once, not twice, when it also has a transcript', async () => {
      route({
        'session.list': ok([runningSession]),
        'sessionHistory.list': ok(page([entry({ claudeSessionId: 'conv-running' })])),
      });

      render();

      await screen.findByTestId('tree-session-workspace:w1');
      expect(screen.queryByTestId('tree-session-conv-running')).not.toBeInTheDocument();
    });

    it("keeps the app's own label for a live session rather than the CLI's generated title", async () => {
      route({
        'session.list': ok([runningSession]),
        'sessionHistory.list': ok(page([entry({ claudeSessionId: 'conv-running', title: 'Título gerado' })])),
      });

      render();

      const row = await screen.findByTestId('tree-session-workspace:w1');
      expect(within(row).getByText('Acme')).toBeInTheDocument();
      expect(within(row).queryByText('Título gerado')).not.toBeInTheDocument();
    });

    it('takes cost and model from the transcript for that same live session', async () => {
      route({
        'session.list': ok([runningSession]),
        'sessionHistory.list': ok(page([entry({ claudeSessionId: 'conv-running', costUsd: 4.4 })])),
      });

      render();

      const row = await screen.findByTestId('tree-session-workspace:w1');
      expect(within(row).getByTestId('tree-session-workspace:w1-cost')).toHaveTextContent('$4.40');
      expect(within(row).getByText('opus-5')).toBeInTheDocument();
    });

    it('shows a past conversation that is not in memory at all, titled by the CLI', async () => {
      route({ 'sessionHistory.list': ok(page([entry({ claudeSessionId: 'conv-old', title: 'Uma sessão antiga' })])) });

      render();

      const row = await screen.findByTestId('tree-session-conv-old');
      expect(within(row).getByText('Uma sessão antiga')).toBeInTheDocument();
    });

    it('waits on the cost instead of showing a wrong one for a session spawned seconds ago', async () => {
      route({ 'session.list': ok([runningSession]), 'sessionHistory.list': ok(page([])) });

      render();

      const row = await screen.findByTestId('tree-session-workspace:w1');
      expect(within(row).getByTestId('tree-session-workspace:w1-cost-pending')).toBeInTheDocument();
      expect(within(row).getByText('iniciando…')).toBeInTheDocument();
    });

    it('shows a dash, not a zero, for a conversation whose model has no published rate', async () => {
      route({ 'sessionHistory.list': ok(page([entry({ claudeSessionId: 'c1', costUsd: null, costSource: 'unknown' })])) });

      render();

      expect(await screen.findByTestId('tree-session-c1-cost')).toHaveTextContent('—');
    });
  });

  describe('ordering', () => {
    it('lists the most recent conversation first, not the alphabetically first', async () => {
      route({
        'sessionHistory.list': ok(
          page([
            entry({ claudeSessionId: 'a-oldest', title: 'AAA', endedAt: '2026-09-01T10:00:00.000Z' }),
            entry({ claudeSessionId: 'z-newest', title: 'ZZZ', endedAt: '2026-09-20T10:00:00.000Z' }),
          ]),
        ),
      });

      render();

      await screen.findByTestId('tree-session-z-newest');
      const rows = screen.getAllByTestId(/^tree-session-/);
      expect(rows[0]).toHaveAttribute('data-testid', 'tree-session-z-newest');
    });

    it('floats a just-spawned session with no transcript to the top', async () => {
      route({
        'session.list': ok([{ ...runningSession, claudeSessionId: 'brand-new' }]),
        'sessionHistory.list': ok(page([entry({ claudeSessionId: 'older', endedAt: '2026-09-20T10:00:00.000Z' })])),
      });

      render();

      await screen.findByTestId('tree-session-workspace:w1');
      const rows = screen.getAllByTestId(/^tree-session-/);
      expect(rows[0]).toHaveAttribute('data-testid', 'tree-session-workspace:w1');
    });
  });

  describe('opening a row', () => {
    it('opens a running session directly, without touching the CLI', async () => {
      const onOpen = vi.fn();
      route({ 'session.list': ok([runningSession]) });
      render({ onOpen });

      await userEvent.click(await screen.findByTestId('tree-session-workspace:w1'));

      expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'workspace:w1' }));
      expect(call).not.toHaveBeenCalledWith('session.resume', expect.anything());
    });

    it('resumes an exited session that is still in memory by its own id', async () => {
      route({ 'session.list': ok([exitedSession]), 'session.resume': ok({ ...exitedSession, status: 'running' }) });
      render();

      await userEvent.click(await screen.findByTestId('tree-session-entity:urn:skill:foo'));

      await waitFor(() =>
        expect(call).toHaveBeenCalledWith('session.resume', { sessionId: 'entity:urn:skill:foo' }),
      );
    });

    it('resumes a conversation that only exists on disk through the history, by its conversation id', async () => {
      route({
        'sessionHistory.list': ok(page([entry({ claudeSessionId: 'conv-old' })])),
        'sessionHistory.resume': ok({ ...runningSession, sessionId: 'conv-old' }),
      });
      const onOpen = vi.fn();
      render({ onOpen });

      await userEvent.click(await screen.findByTestId('tree-session-conv-old'));

      await waitFor(() =>
        expect(call).toHaveBeenCalledWith('sessionHistory.resume', { claudeSessionId: 'conv-old' }),
      );
      await waitFor(() => expect(onOpen).toHaveBeenCalled());
    });

    it('is a real button, so it is reachable and activatable by keyboard alone', async () => {
      const onOpen = vi.fn();
      route({ 'session.list': ok([runningSession]) });
      render({ onOpen });
      const row = await screen.findByTestId('tree-session-workspace:w1');

      expect(row.tagName).toBe('BUTTON');
      row.focus();
      await userEvent.keyboard('{Enter}');

      expect(onOpen).toHaveBeenCalled();
    });
  });

  describe('row actions', () => {
    it('offers Encerrar only for a session that is actually running', async () => {
      route({ 'session.list': ok([runningSession, exitedSession]) });

      render();

      await screen.findByTestId('tree-session-workspace:w1');
      expect(screen.getByTestId('tree-session-stop-workspace:w1')).toBeInTheDocument();
      expect(screen.queryByTestId('tree-session-stop-entity:urn:skill:foo')).not.toBeInTheDocument();
    });

    it('offers no destructive action on a row that is only a transcript — there is nothing in memory to remove', async () => {
      route({ 'sessionHistory.list': ok(page([entry({ claudeSessionId: 'conv-old' })])) });

      render();

      await screen.findByTestId('tree-session-conv-old');
      expect(screen.queryByTestId('tree-session-remove-conv-old')).not.toBeInTheDocument();
    });

    it('asks before apagando a session and reports it upward once done', async () => {
      const onRemoved = vi.fn();
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      route({ 'session.list': ok([runningSession]) });
      render({ onRemoved });

      await userEvent.click(await screen.findByTestId('tree-session-remove-workspace:w1'));

      await waitFor(() => expect(call).toHaveBeenCalledWith('session.remove', { sessionId: 'workspace:w1' }));
      await waitFor(() => expect(onRemoved).toHaveBeenCalledWith('workspace:w1'));
    });

    it('forgets the session’s global browser tab, if it had one open', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      route({ 'session.list': ok([runningSession]) });
      openSessionTab('workspace:w1');
      render();

      await userEvent.click(await screen.findByTestId('tree-session-remove-workspace:w1'));

      await waitFor(() => expect(call).toHaveBeenCalledWith('session.remove', { sessionId: 'workspace:w1' }));
      expect(getBrowserTabsSnapshot().tabs).toEqual([]);
    });
  });

  describe('paging', () => {
    it('asks for the next page when the sentinel below the last row scrolls into view', async () => {
      route({ 'sessionHistory.list': ok(page([entry({ claudeSessionId: 'c1' })], 'cursor-1')) });
      render();
      await screen.findByTestId('tree-session-c1');
      call.mockClear();

      intersectionObservers.at(-1)?.trigger();

      await waitFor(() =>
        expect(call).toHaveBeenCalledWith('sessionHistory.list', expect.objectContaining({ cursor: 'cursor-1' })),
      );
    });

    it('stops asking once the list has reached its end', async () => {
      route({ 'sessionHistory.list': ok(page([entry({ claudeSessionId: 'c1' })], null)) });
      render();
      await screen.findByTestId('tree-session-c1');
      call.mockClear();

      intersectionObservers.at(-1)?.trigger();

      await waitFor(() => expect(call).not.toHaveBeenCalledWith('sessionHistory.list', expect.anything()));
    });
  });

  describe('footer', () => {
    it("shows the scope's total and says plainly that it is an estimate", async () => {
      route({
        'sessionHistory.list': ok(page([entry({ claudeSessionId: 'c1' })])),
        'sessionHistory.stats': ok(stats({ totalCostUsd: 31.8 })),
      });

      render();

      await waitFor(() => expect(screen.getByTestId('sessions-total')).toHaveTextContent('$31.80'));
      expect(screen.getByTestId('sessions-footer')).toHaveTextContent('estimado');
    });

    it('says how many sessions it could not price, rather than folding them in as zero', async () => {
      route({
        'sessionHistory.list': ok(page([entry({ claudeSessionId: 'c1' })])),
        'sessionHistory.stats': ok(stats({ unpricedCount: 3 })),
      });

      render();

      await waitFor(() => expect(screen.getByTestId('sessions-footer')).toHaveTextContent('3 sem preço'));
    });

    it('offers a way through to the full history', async () => {
      const onSeeAll = vi.fn();
      route({
        'sessionHistory.list': ok(page([entry({ claudeSessionId: 'c1' })])),
        'sessionHistory.stats': ok(stats({ sessionCount: 41 })),
      });
      render({ onSeeAll });

      const link = await screen.findByTestId('sessions-see-all');
      expect(link).toHaveTextContent('Ver todas as 41');
      await userEvent.click(link);

      expect(onSeeAll).toHaveBeenCalled();
    });
  });

  describe('empty and error states', () => {
    it('shows no total footer at all when the scope has nothing in it, rather than a $0.00 nobody asked for', async () => {
      render();

      await screen.findByTestId('sessions-empty');
      expect(screen.queryByTestId('sessions-footer')).not.toBeInTheDocument();
    });

    it('names the gesture that fills an empty panel', async () => {
      render();

      expect(await screen.findByTestId('sessions-empty')).toHaveTextContent('Nenhuma sessão ainda');
    });

    it('says what failed and what still works when the history cannot be read', async () => {
      route({ 'sessionHistory.list': fail('io', 'ENOENT') });

      render();

      const error = await screen.findByTestId('sessions-history-error');
      expect(error).toHaveTextContent('~/.claude/projects');
      expect(error).toHaveTextContent('As sessões abertas agora continuam funcionando');
      expect(screen.getByTestId('sessions-history-retry')).toBeInTheDocument();
    });

    it('still lists the live sessions when the history read fails, rather than taking them down with it', async () => {
      route({ 'session.list': ok([runningSession]), 'sessionHistory.list': fail('io', 'ENOENT') });

      render();

      expect(await screen.findByTestId('tree-session-workspace:w1')).toBeInTheDocument();
    });
  });
});
