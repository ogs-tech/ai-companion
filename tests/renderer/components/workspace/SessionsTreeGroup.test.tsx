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
import type {
  SessionHistoryEntry,
  SessionHistoryPage,
} from '../../../../src/shared/session-history.js';

const SCOPE = { kind: 'workspace', workspaceId: 'ws-1' } as const;

const runningSession = {
  sessionId: 'workspace:w1',
  harness: 'claude',
  conversationId: 'conv-running',
  anchor: { kind: 'workspace' as const, workspaceId: 'w1' },
  scopeId: 'ws-1',
  cwd: '/repos/ws',
  label: 'Acme',
  status: 'running' as const,
};

const exitedSession = {
  sessionId: 'entity:urn:skill:foo',
  conversationId: 'conv-exited',
  anchor: { kind: 'entity' as const, urn: 'urn:skill:foo' },
  scopeId: 'ws-1',
  cwd: '/repos/ws',
  label: 'foo',
  status: 'exited' as const,
};

const entry = (overrides: Partial<SessionHistoryEntry> = {}): SessionHistoryEntry => ({
  harness: 'claude',
  conversationId: 'conv-running',
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

const page = (
  entries: SessionHistoryEntry[],
  nextCursor: string | null = null,
): SessionHistoryPage => ({
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

/** Encerradas are not listed until their chip is chosen. */
const showExited = async (): Promise<void> => {
  await userEvent.click(await screen.findByTestId('sessions-filter-exited'));
};

const render = (props: Partial<React.ComponentProps<typeof SessionsTreeGroup>> = {}) =>
  renderWithShell(<SessionsTreeGroup scope={SCOPE} onOpen={vi.fn()} {...props} />);

describe('SessionsTreeGroup', () => {
  describe('merging live sessions with the transcripts on disk', () => {
    it('shows a running session once, not twice, when it also has a transcript', async () => {
      route({
        'session.list': ok([runningSession]),
        'sessionHistory.list': ok(page([entry({ conversationId: 'conv-running' })])),
      });

      render();

      await screen.findByTestId('tree-session-workspace:w1');
      expect(screen.queryByTestId('tree-session-conv-running')).not.toBeInTheDocument();
    });

    it("keeps the app's own label for a live session rather than the CLI's generated title", async () => {
      route({
        'session.list': ok([runningSession]),
        'sessionHistory.list': ok(
          page([entry({ conversationId: 'conv-running', title: 'Título gerado' })]),
        ),
      });

      render();

      const row = await screen.findByTestId('tree-session-workspace:w1');
      expect(within(row).getByText('Acme')).toBeInTheDocument();
      expect(within(row).queryByText('Título gerado')).not.toBeInTheDocument();
    });

    it('takes cost and model from the transcript for that same live session', async () => {
      route({
        'session.list': ok([runningSession]),
        'sessionHistory.list': ok(page([entry({ conversationId: 'conv-running', costUsd: 4.4 })])),
      });

      render();

      const row = await screen.findByTestId('tree-session-workspace:w1');
      expect(within(row).getByTestId('tree-session-workspace:w1-cost')).toHaveTextContent('$4.40');
      expect(within(row).getByText('claude · opus-5')).toBeInTheDocument();
    });

    it('shows a past conversation that is not in memory at all, titled by the CLI', async () => {
      route({
        'sessionHistory.list': ok(
          page([entry({ conversationId: 'conv-old', title: 'Uma sessão antiga' })]),
        ),
      });

      render();

      await showExited();
      const row = await screen.findByTestId('tree-session-conv-old');
      expect(within(row).getByText('Uma sessão antiga')).toBeInTheDocument();
    });

    it('waits on the cost instead of showing a wrong one for a session spawned seconds ago', async () => {
      route({ 'session.list': ok([runningSession]), 'sessionHistory.list': ok(page([])) });

      render();

      const row = await screen.findByTestId('tree-session-workspace:w1');
      expect(within(row).getByTestId('tree-session-workspace:w1-cost-pending')).toBeInTheDocument();
      expect(within(row).getByText('claude · iniciando…')).toBeInTheDocument();
    });

    it('shows a dash, not a zero, for a conversation whose model has no published rate', async () => {
      route({
        'sessionHistory.list': ok(
          page([entry({ conversationId: 'c1', costUsd: null, costSource: 'unknown' })]),
        ),
      });

      render();

      await showExited();
      expect(await screen.findByTestId('tree-session-c1-cost')).toHaveTextContent('—');
    });
  });

  describe('ordering', () => {
    it('lists the most recent conversation first, not the alphabetically first', async () => {
      route({
        'sessionHistory.list': ok(
          page([
            entry({
              conversationId: 'a-oldest',
              title: 'AAA',
              endedAt: '2026-09-01T10:00:00.000Z',
            }),
            entry({
              conversationId: 'z-newest',
              title: 'ZZZ',
              endedAt: '2026-09-20T10:00:00.000Z',
            }),
          ]),
        ),
      });

      render();

      await showExited();
      await screen.findByTestId('tree-session-z-newest');
      const rows = screen.getAllByTestId(/^tree-session-/);
      expect(rows[0]).toHaveAttribute('data-testid', 'tree-session-z-newest');
    });

    it('floats a just-spawned session with no transcript to the top', async () => {
      route({
        'session.list': ok([{ ...runningSession, conversationId: 'brand-new' }]),
        'sessionHistory.list': ok(
          page([entry({ conversationId: 'older', endedAt: '2026-09-20T10:00:00.000Z' })]),
        ),
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
      route({
        'session.list': ok([exitedSession]),
        'session.resume': ok({ ...exitedSession, status: 'running' }),
      });
      render();
      await showExited();

      await userEvent.click(await screen.findByTestId('tree-session-entity:urn:skill:foo'));

      await waitFor(() =>
        expect(call).toHaveBeenCalledWith('session.resume', { sessionId: 'entity:urn:skill:foo' }),
      );
    });

    it('resumes a conversation that only exists on disk through the history, by its conversation id', async () => {
      route({
        'sessionHistory.list': ok(page([entry({ conversationId: 'conv-old' })])),
        'sessionHistory.resume': ok({ ...runningSession, sessionId: 'conv-old' }),
      });
      const onOpen = vi.fn();
      render({ onOpen });
      await showExited();

      await userEvent.click(await screen.findByTestId('tree-session-conv-old'));

      await waitFor(() =>
        expect(call).toHaveBeenCalledWith('sessionHistory.resume', { conversationId: 'conv-old' }),
      );
      await waitFor(() => expect(onOpen).toHaveBeenCalled());
    });

    it('turns an exited row into a live one as soon as it is reopened', async () => {
      let resumed = false;
      route({
        'session.list': () => ok(resumed ? [{ ...exitedSession, status: 'running', activity: 'idle' }] : [exitedSession]),
        'session.resume': () => {
          resumed = true;
          return ok({ ...exitedSession, status: 'running', activity: 'idle' });
        },
      });
      render();
      const row = await screen.findByTestId('tree-session-entity:urn:skill:foo');
      expect(screen.getByTestId('tree-session-entity:urn:skill:foo-indicator')).toHaveAttribute('data-state', 'exited');

      await userEvent.click(row);

      await waitFor(() =>
        expect(screen.getByTestId('tree-session-entity:urn:skill:foo-indicator')).toHaveAttribute('data-state', 'idle'),
      );
    });

    it('drops the × filter when reopening an exited row, so the row stays in view', async () => {
      let resumed = false;
      route({
        'session.list': () => ok(resumed ? [{ ...exitedSession, status: 'running', activity: 'idle' }] : [exitedSession]),
        'session.resume': () => {
          resumed = true;
          return ok({ ...exitedSession, status: 'running', activity: 'idle' });
        },
      });
      render();
      await showExited();

      await userEvent.click(await screen.findByTestId('tree-session-entity:urn:skill:foo'));

      await waitFor(() => expect(screen.getByTestId('sessions-filter-exited')).toHaveAttribute('aria-pressed', 'false'));
      expect(screen.getByTestId('tree-session-entity:urn:skill:foo-indicator')).toHaveAttribute('data-state', 'idle');
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
    it('offers no destructive action on a row that is only a transcript — there is nothing in memory to remove', async () => {
      route({ 'sessionHistory.list': ok(page([entry({ conversationId: 'conv-old' })])) });

      render();
      await showExited();

      await screen.findByTestId('tree-session-conv-old');
      expect(screen.queryByTestId('tree-session-remove-conv-old')).not.toBeInTheDocument();
    });

    it('offers one action per state: stop while running, delete once ended', async () => {
      route({ 'session.list': ok([runningSession, exitedSession]) });
      render();
      await screen.findByTestId('tree-session-workspace:w1');
      expect(screen.getByTestId('tree-session-stop-workspace:w1')).toBeInTheDocument();
      expect(screen.queryByTestId('tree-session-remove-workspace:w1')).not.toBeInTheDocument();

      await showExited();
      expect(await screen.findByTestId('tree-session-remove-entity:urn:skill:foo')).toBeInTheDocument();
      expect(screen.queryByTestId('tree-session-stop-entity:urn:skill:foo')).not.toBeInTheDocument();
    });

    it('hides an apagada session at once, and removes it only after the undo window', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        const onRemoved = vi.fn();
        route({ 'session.list': ok([exitedSession]) });
        openSessionTab('entity:urn:skill:foo');
        render({ onRemoved });
        await showExited();

        await userEvent.click(await screen.findByTestId('tree-session-remove-entity:urn:skill:foo'));

        expect(screen.queryByTestId('tree-session-entity:urn:skill:foo')).not.toBeInTheDocument();
        expect(await screen.findByText('Sessão apagada')).toBeInTheDocument();
        expect(call).not.toHaveBeenCalledWith('session.remove', expect.anything());

        await vi.advanceTimersByTimeAsync(6100);
        await waitFor(() =>
          expect(call).toHaveBeenCalledWith('session.remove', { sessionId: 'entity:urn:skill:foo' }),
        );
        await waitFor(() => expect(onRemoved).toHaveBeenCalledWith('entity:urn:skill:foo'));
        expect(getBrowserTabsSnapshot().tabs).toEqual([]);
      } finally {
        vi.useRealTimers();
      }
    });

    it('brings the session back, and never removes it, when Desfazer is chosen', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        route({ 'session.list': ok([exitedSession]) });
        render();
        await showExited();
        await userEvent.click(await screen.findByTestId('tree-session-remove-entity:urn:skill:foo'));

        await userEvent.click(await screen.findByTestId('toast-action'));
        expect(await screen.findByTestId('tree-session-entity:urn:skill:foo')).toBeInTheDocument();

        await vi.advanceTimersByTimeAsync(7000);
        expect(call).not.toHaveBeenCalledWith('session.remove', expect.anything());
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('paging', () => {
    it('asks for the next page when the sentinel below the last row scrolls into view', async () => {
      route({ 'sessionHistory.list': ok(page([entry({ conversationId: 'c1' })], 'cursor-1')) });
      render();
      await showExited();
      await screen.findByTestId('tree-session-c1');
      call.mockClear();

      intersectionObservers.at(-1)?.trigger();

      await waitFor(() =>
        expect(call).toHaveBeenCalledWith(
          'sessionHistory.list',
          expect.objectContaining({ cursor: 'cursor-1' }),
        ),
      );
    });

    it('stops asking once the list has reached its end', async () => {
      route({ 'sessionHistory.list': ok(page([entry({ conversationId: 'c1' })], null)) });
      render();
      await showExited();
      await screen.findByTestId('tree-session-c1');
      call.mockClear();

      intersectionObservers.at(-1)?.trigger();

      await waitFor(() =>
        expect(call).not.toHaveBeenCalledWith('sessionHistory.list', expect.anything()),
      );
    });
  });

  describe('footer', () => {
    it("shows the scope's total and says plainly that it is an estimate", async () => {
      route({
        'sessionHistory.list': ok(page([entry({ conversationId: 'c1' })])),
        'sessionHistory.stats': ok(stats({ totalCostUsd: 31.8 })),
      });

      render();

      await waitFor(() => expect(screen.getByTestId('sessions-total')).toHaveTextContent('$31.80'));
      expect(screen.getByTestId('sessions-footer')).toHaveTextContent('estimado');
    });

    it('says how many sessions it could not price, rather than folding them in as zero', async () => {
      route({
        'sessionHistory.list': ok(page([entry({ conversationId: 'c1' })])),
        'sessionHistory.stats': ok(stats({ unpricedCount: 3 })),
      });

      render();

      await waitFor(() =>
        expect(screen.getByTestId('sessions-footer')).toHaveTextContent('3 sem preço'),
      );
    });

    it('offers a way through to the full history', async () => {
      const onSeeAll = vi.fn();
      route({
        'sessionHistory.list': ok(page([entry({ conversationId: 'c1' })])),
        'sessionHistory.stats': ok(stats({ sessionCount: 41 })),
      });
      render({ onSeeAll });

      const link = await screen.findByTestId('sessions-see-all');
      expect(link).toHaveTextContent('Ver as 41 sessões');
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

  describe('sessions of other scopes', () => {
    const elsewhere = { ...runningSession, sessionId: 'workspace:other', conversationId: 'conv-other', scopeId: 'ws-2', label: 'Beta' };
    const home = { ...runningSession, sessionId: 'personal', conversationId: 'conv-home', anchor: { kind: 'personal' as const }, scopeId: null, label: 'Início' };

    it('lists a running session from another workspace and from Início, naming where it runs', async () => {
      route({
        'session.list': ok([runningSession, elsewhere, home]),
        'workspace.list': ok([{ id: 'ws-2', name: 'Beta', rootPath: '/repos/beta', createdAt: '' }]),
      });
      render();
      expect(await screen.findByTestId('tree-session-workspace:other')).toHaveTextContent('Beta · claude');
      expect(screen.getByTestId('tree-session-personal')).toHaveTextContent('Início · claude');
      // Its own scope's row carries no tag.
      expect(screen.getByTestId('tree-session-workspace:w1')).not.toHaveTextContent('Início');
    });

    it('does not list an exited session that belongs to another scope', async () => {
      route({ 'session.list': ok([runningSession, exitedSession, { ...elsewhere, status: 'exited' }]) });
      render();
      await showExited();
      await screen.findByTestId('tree-session-entity:urn:skill:foo');
      expect(screen.queryByTestId('tree-session-workspace:other')).toBeNull();
    });
  });

  describe('attention states', () => {
    const live = (
      id: string,
      activity: 'needs-input' | 'working' | 'idle' | undefined,
      extra: Record<string, unknown> = {},
    ) => ({
      ...runningSession,
      sessionId: `workspace:${id}`,
      conversationId: `conv-${id}`,
      label: id,
      ...(activity ? { activity, activitySince: Date.now() - 4 * 60_000 } : {}),
      ...extra,
    });
    const order = (): string[] =>
      screen
        .getAllByTestId(/^tree-session-workspace:[a-z]+$/)
        .map((el) => el.getAttribute('data-testid')!.replace('tree-session-workspace:', ''));

    it('orders the flat list needs-input, working, idle, exited and counts per chip', async () => {
      route({
        'sessionHistory.stats': ok(stats({ sessionCount: 0 })),
        'session.list': ok([
          live('idle', 'idle'),
          live('work', 'working'),
          live('need', 'needs-input', { attention: { kind: 'permission', detail: 'Bash' } }),
          live('gone', undefined, { status: 'exited' }),
        ]),
      });
      render();

      await screen.findByTestId('tree-session-workspace:need');
      expect(order()).toEqual(['need', 'work', 'idle', 'gone']);
      expect(screen.getByTestId('sessions-filter-needs-input')).toHaveAccessibleName('Pergunta: 1');
      expect(screen.getByTestId('sessions-filter-working')).toHaveAccessibleName('Trabalhando: 1');
      expect(screen.getByTestId('sessions-filter-idle')).toHaveAccessibleName('Ocioso: 1');
      expect(screen.getByTestId('sessions-filter-exited')).toHaveAccessibleName('Fechado: 1');
      expect(screen.getByTestId('tree-session-workspace:need-reason')).toHaveTextContent(
        'Permissão: Bash',
      );
    });

    it('filters in place by chip and clears when the chip is clicked again', async () => {
      route({
        'session.list': ok([
          live('need', 'needs-input'),
          live('work', 'working'),
          live('idle', 'idle'),
        ]),
      });
      render();
      await screen.findByTestId('tree-session-workspace:need');

      await userEvent.click(screen.getByTestId('sessions-filter-needs-input'));
      expect(order()).toEqual(['need']);
      expect(screen.getByTestId('sessions-filter-needs-input')).toHaveAttribute(
        'aria-pressed',
        'true',
      );

      await userEvent.click(screen.getByTestId('sessions-filter-needs-input'));
      expect(order()).toEqual(['need', 'work', 'idle']);
    });

    it('shows a live session with no signal yet as idle, never working or needing you', async () => {
      route({ 'session.list': ok([live('open', undefined)]) });
      render();
      await screen.findByTestId('tree-session-workspace:open');
      expect(screen.getByTestId('tree-session-workspace:open-indicator')).toHaveAttribute(
        'data-state',
        'idle',
      );
      expect(screen.getByTestId('sessions-filter-working')).toHaveAccessibleName('Trabalhando: 0');
      expect(screen.getByTestId('sessions-filter-needs-input')).toHaveAccessibleName('Pergunta: 0');
      expect(screen.getByTestId('sessions-filter-idle')).toHaveAccessibleName('Ocioso: 1');
    });

    it('keeps the Encerradas count steady while history pages load', async () => {
      route({
        'sessionHistory.stats': ok(stats({ sessionCount: 30 })),
        'sessionHistory.list': ok(
          page([entry({ conversationId: 'conv-old' })], 'next'),
        ),
        'session.list': ok([live('work', 'working')]),
      });
      render();
      await screen.findByTestId('tree-session-workspace:work');
      await waitFor(() =>
        expect(screen.getByTestId('sessions-filter-exited')).toHaveAccessibleName('Fechado: 30'),
      );
      expect(screen.getByTestId('sessions-filter-working')).toHaveAccessibleName('Trabalhando: 1');
    });
  });
});
