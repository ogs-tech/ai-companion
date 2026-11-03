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
  it('marks the session with its harness before the model', () => {
    renderWithTheme(<SessionRow label="api" harness="cursor" status="exited" history={cursorEntry} onOpen={() => undefined} testId="row" />);
    expect(screen.getByTestId('harness-mark-cursor')).toBeInTheDocument();
    expect(screen.queryByTestId('harness-mark-claude')).toBeNull();
  });

  it('shows a dash for a Cursor session’s cost, never $0', () => {
    renderWithTheme(<SessionRow label="api" harness="cursor" status="exited" history={cursorEntry} onOpen={() => undefined} testId="row" />);
    expect(screen.getByTestId('row-cost')).toHaveTextContent('—');
  });

  it('marks a Claude session with the Claude mark', () => {
    renderWithTheme(<SessionRow label="api" harness="claude" status="running" history={null} onOpen={() => undefined} testId="row" />);
    expect(screen.getByTestId('harness-mark-claude')).toBeInTheDocument();
  });
});
