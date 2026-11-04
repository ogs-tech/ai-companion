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
  it('shows the harness as text next to the model, not as an icon', () => {
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
    expect(screen.getByText('cursor · gpt-5')).toBeInTheDocument();
    expect(screen.queryByTestId('harness-mark-cursor')).toBeNull();
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
    ['needs-input', '!', 'Precisa de você'],
    ['working', '✻', 'Trabalhando'],
    ['idle', '◌', 'Ociosa'],
    ['exited', '×', 'Encerrada'],
  ] as const)('shows a distinct glyph and accessible name for %s', (state, glyph, name) => {
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
    expect(indicator).toHaveTextContent(glyph);
    expect(indicator).toHaveAccessibleName(name);
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
    expect(screen.getByText('espera 4min')).toBeInTheDocument();
  });

  it('marks an idle row as ociosa and shows no reason pill', () => {
    renderWithTheme(
      <SessionRow
        label="api"
        harness="claude"
        state="idle"
        history={null}
        onOpen={() => undefined}
        testId="row"
      />,
    );
    expect(screen.getByText(/ociosa/)).toBeInTheDocument();
    expect(screen.queryByTestId('row-reason')).toBeNull();
  });
});
