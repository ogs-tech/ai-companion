import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SessionHistoryTab } from '../../../../src/renderer/screens/history/SessionHistoryTab.js';
import { mockApi, ok, renderWithShell, type CallSpy } from '../../test-utils.js';
import type { SessionHistoryEntry } from '../../../../src/shared/session-history.js';

const PROJECT_SCOPE = { kind: 'project', projectId: 'p1' } as const;

const entry = (overrides: Partial<SessionHistoryEntry> = {}): SessionHistoryEntry => ({
  claudeSessionId: 'c1',
  title: 'Uma sessão',
  cwd: '/repos/acme',
  model: 'claude-opus-5',
  costUsd: 4.4,
  costSource: 'reported',
  inputTokens: 100,
  outputTokens: 200,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  startedAt: '2026-09-10T10:00:00.000Z',
  endedAt: '2026-09-10T10:05:00.000Z',
  durationMs: 300_000,
  ...overrides,
});

const STATS = {
  totalCostUsd: 31.8,
  unpricedCount: 0,
  sessionCount: 41,
  perDay: [
    { date: '2026-09-10', costUsd: 10, sessionCount: 2 },
    { date: '2026-09-11', costUsd: 21.8, sessionCount: 3 },
  ],
  models: ['claude-opus-5', 'claude-haiku-4-5'],
};

let call: CallSpy;
let listParams: Record<string, unknown>[];
let statsParams: Record<string, unknown>[];

function route(entries: SessionHistoryEntry[] = [entry()], statsOverrides: Record<string, unknown> = {}): void {
  call.mockImplementation(async (method: string, params?: Record<string, unknown>) => {
    if (method === 'sessionHistory.list') {
      listParams.push(params ?? {});
      return ok({ entries, nextCursor: null, total: entries.length });
    }
    if (method === 'sessionHistory.stats') {
      statsParams.push(params ?? {});
      return ok({ ...STATS, ...statsOverrides });
    }
    if (method === 'sessionHistory.resume') return ok({ sessionId: 'c1', label: 'Uma sessão' });
    return ok(undefined);
  });
}

beforeEach(() => {
  call = mockApi();
  listParams = [];
  statsParams = [];
  route();
});

const render = (props: Partial<React.ComponentProps<typeof SessionHistoryTab>> = {}) =>
  renderWithShell(<SessionHistoryTab projectScope={PROJECT_SCOPE} onOpenSession={vi.fn()} {...props} />);

describe('<SessionHistoryTab>', () => {
  describe('the headline number', () => {
    it('leads with the scope total, as the single loud element', async () => {
      render();

      await waitFor(() => expect(screen.getByTestId('history-total')).toHaveTextContent('$31.80'));
    });

    it('says it is an estimate and how many sessions it covers', async () => {
      render();

      await waitFor(() => expect(screen.getByText(/estimado · 41 sessões/)).toBeInTheDocument());
    });

    it('states plainly when some sessions are missing from the total instead of quietly under-reporting', async () => {
      route([entry()], { unpricedCount: 4 });

      render();

      await waitFor(() =>
        expect(screen.getByText(/4 sem preço publicado, fora do total/)).toBeInTheDocument(),
      );
    });
  });

  describe('scope', () => {
    it('opens scoped to the project in view', async () => {
      render();

      await waitFor(() => expect(statsParams[0]?.['scope']).toEqual(PROJECT_SCOPE));
    });

    it('widens to every conversation on the machine when the project filter is turned off', async () => {
      render();
      await screen.findByTestId('filter-project-only');

      await userEvent.click(screen.getByTestId('filter-project-only'));

      await waitFor(() => expect(statsParams.at(-1)?.['scope']).toEqual({ kind: 'all' }));
    });

    it('falls back to everything, with the project filter unavailable, when no project is in view', async () => {
      render({ projectScope: null });

      await waitFor(() => expect(statsParams[0]?.['scope']).toEqual({ kind: 'all' }));
      // MUI renders a disabled Chip as an aria-disabled div, not a disabled button.
      expect(screen.getByTestId('filter-project-only')).toHaveAttribute('aria-disabled', 'true');
    });
  });

  describe('the chart', () => {
    it('draws one bar per day with spend', async () => {
      render();

      expect(await screen.findByTestId('spend-bar-2026-09-10')).toBeInTheDocument();
      expect(screen.getByTestId('spend-bar-2026-09-11')).toBeInTheDocument();
    });

    it('isolates the table to a day when its bar is clicked', async () => {
      render();

      await userEvent.click(await screen.findByTestId('spend-bar-2026-09-10'));

      await waitFor(() =>
        expect(listParams.at(-1)?.['filters']).toMatchObject({
          from: '2026-09-10T00:00:00.000',
          to: '2026-09-10T23:59:59.999',
        }),
      );
      expect(screen.getByTestId('filter-day')).toBeInTheDocument();
    });

    it('releases the day again when the same bar is clicked twice', async () => {
      render();
      await userEvent.click(await screen.findByTestId('spend-bar-2026-09-10'));
      await screen.findByTestId('filter-day');

      await userEvent.click(screen.getByTestId('spend-bar-2026-09-10'));

      await waitFor(() => expect(screen.queryByTestId('filter-day')).not.toBeInTheDocument());
    });

    it('leaves the chart itself unfiltered by the day, so the period being charted never changes under the click', async () => {
      render();
      await screen.findByTestId('spend-bar-2026-09-10');
      const statsCallsBefore = statsParams.length;

      await userEvent.click(screen.getByTestId('spend-bar-2026-09-10'));

      await waitFor(() => expect(listParams.at(-1)?.['filters']).toBeDefined());
      expect(statsParams).toHaveLength(statsCallsBefore);
    });

    it('says so plainly when there was no spend at all, rather than drawing an empty axis', async () => {
      route([entry()], { perDay: [] });

      render();

      expect(await screen.findByTestId('spend-chart-empty')).toBeInTheDocument();
    });
  });

  describe('model filter', () => {
    it('offers a pill per model actually present in scope', async () => {
      render();

      expect(await screen.findByTestId('filter-model-claude-opus-5')).toBeInTheDocument();
      expect(screen.getByTestId('filter-model-claude-haiku-4-5')).toBeInTheDocument();
    });

    it('narrows both the table and the chart to the chosen model', async () => {
      render();

      await userEvent.click(await screen.findByTestId('filter-model-claude-opus-5'));

      await waitFor(() =>
        expect(listParams.at(-1)?.['filters']).toMatchObject({ models: ['claude-opus-5'] }),
      );
      expect(statsParams.at(-1)?.['filters']).toMatchObject({ models: ['claude-opus-5'] });
    });
  });

  describe('the table', () => {
    it('answers "what was expensive" first, sorting by cost descending', async () => {
      route([
        entry({ claudeSessionId: 'cheap', title: 'Barata', costUsd: 1 }),
        entry({ claudeSessionId: 'dear', title: 'Cara', costUsd: 88.28 }),
      ]);

      render();

      await screen.findByText('Cara');
      const rendered = screen.getAllByText(/^(Cara|Barata)$/).map((el) => el.textContent);
      expect(rendered[0]).toBe('Cara');
    });

    it('sorts an unpriced session below every priced one instead of treating its blank as free', async () => {
      route([
        entry({ claudeSessionId: 'unknown', title: 'Sem preço', costUsd: null, costSource: 'unknown' }),
        entry({ claudeSessionId: 'cheap', title: 'Barata', costUsd: 0.01 }),
      ]);

      render();

      await screen.findByText('Barata');
      const rendered = screen.getAllByText(/^(Barata|Sem preço)$/).map((el) => el.textContent);
      expect(rendered[0]).toBe('Barata');
    });

    it('falls back to a short conversation id for a session that never got a title', async () => {
      route([entry({ claudeSessionId: 'abcdefgh-1234', title: null })]);

      render();

      expect(await screen.findByText('abcdefgh')).toBeInTheDocument();
    });

    it('resumes the conversation when a row is clicked, and hands the live session back to the workbench', async () => {
      const onOpenSession = vi.fn();
      render({ onOpenSession });

      await userEvent.click(await screen.findByText('Uma sessão'));

      await waitFor(() => expect(call).toHaveBeenCalledWith('sessionHistory.resume', { claudeSessionId: 'c1' }));
      await waitFor(() => expect(onOpenSession).toHaveBeenCalled());
    });

    it('names the gesture that fills an empty history', async () => {
      route([]);

      render();

      expect(await screen.findByTestId('empty-state-session-history')).toBeInTheDocument();
    });
  });
});
