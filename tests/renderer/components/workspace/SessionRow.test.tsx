import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { SessionRow } from '../../../../src/renderer/components/workspace/SessionRow.js';
import { renderWithTheme } from '../../test-utils.js';
import type { SessionHistoryEntry } from '../../../../src/shared/session-history.js';

const cursorEntry: SessionHistoryEntry = {
  harness: 'cursor',
  conversationId: 'chat-1',
  title: 'Criar Readme',
  cwd: '/r',
  model: null,
  costUsd: null,
  costSource: 'unknown',
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  startedAt: '2026-11-02T10:00:00.000Z',
  endedAt: '2026-11-02T10:05:00.000Z',
  durationMs: null,
};

describe('SessionRow', () => {
  it('draws the channel as a mark badged with the state, and keeps only the model as text', () => {
    renderWithTheme(
      <SessionRow
        label="api"
        harness="cursor"
        state="exited"
        history={{ ...cursorEntry, model: 'gpt-5' }}
        onOpen={() => undefined}
        testId="row"
      />,
    );
    expect(screen.getByText('gpt-5')).toBeInTheDocument();
    expect(screen.queryByText(/cursor/i)).toBeNull();
    const indicator = screen.getByTestId('row-indicator');
    expect(indicator).toHaveAttribute('data-state', 'exited');
    // The channel mark and the state badge are two svgs in one indicator, not two icons side by side.
    expect(indicator.querySelectorAll('svg').length).toBe(2);
  });

  it('shows a dash for a Cursor session’s cost, never $0', () => {
    renderWithTheme(
      <SessionRow
        label="api"
        harness="cursor"
        state="exited"
        history={cursorEntry}
        onOpen={() => undefined}
        testId="row"
      />,
    );
    expect(screen.getByTestId('row-cost')).toHaveTextContent('—');
  });

  it.each([
    ['needs-input', 'Pergunta'],
    ['working', 'Trabalhando'],
    ['idle', 'Ocioso'],
    ['exited', 'Fechado'],
  ] as const)('shows a distinct mark and accessible name for %s', (state, name) => {
    renderWithTheme(
      <SessionRow
        label="api"
        harness="claude"
        state={state}
        history={null}
        onOpen={() => undefined}
        testId="row"
      />,
    );
    const indicator = screen.getByTestId('row-indicator');
    expect(indicator).toHaveAttribute('data-state', state);
    expect(indicator.querySelector('svg')).not.toBeNull();
    expect(indicator).toHaveAccessibleName(name);
  });

  it('shows how long an idle row has been stopped, with no reason pill', () => {
    renderWithTheme(
      <SessionRow label="api" harness="claude" state="idle" idleSince={0} now={5 * 60_000} history={null} onOpen={() => undefined} testId="row" />,
    );
    expect(screen.queryByTestId('row-reason')).not.toBeInTheDocument();
    expect(screen.getByText('há 5min')).toBeInTheDocument();
  });

  it('shows the reason pill and how long a needs-input row has waited', () => {
    renderWithTheme(
      <SessionRow
        label="api"
        harness="claude"
        state="needs-input"
        attention={{ kind: 'permission', detail: 'Bash' }}
        waitingSince={0}
        now={4 * 60_000}
        history={cursorEntry}
        onOpen={() => undefined}
        testId="row"
      />,
    );
    expect(screen.getByTestId('row-reason')).toHaveTextContent('Permissão: Bash');
    expect(screen.getByText('precisa de você · 4min')).toBeInTheDocument();
  });
});
