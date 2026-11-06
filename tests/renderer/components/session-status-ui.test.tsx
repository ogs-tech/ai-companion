import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ContextBar } from '../../../src/renderer/components/ContextBar.js';
import { InlinePermission } from '../../../src/renderer/components/workspace/InlinePermission.js';
import { SessionFileBadge } from '../../../src/renderer/components/workspace/SessionFileBadge.js';
import { ExternalConsentBanner, ExternalSessionRows } from '../../../src/renderer/components/workspace/ExternalSessionsBlock.js';
import { rateLimitText } from '../../../src/renderer/components/workspace/SessionRow.js';
import type { ExternalSession } from '../../../src/shared/external-session.js';
import type { SessionSnapshot } from '../../../src/shared/session.js';
import { mockApi, ok, renderWithQuery, renderWithTheme, type CallSpy } from '../test-utils.js';

let call: CallSpy;
beforeEach(() => {
  call = mockApi();
  call.mockResolvedValue(ok(null));
});

describe('ContextBar', () => {
  it('is hidden without a known window and flags amber / red levels', () => {
    const { rerender } = renderWithTheme(<ContextBar metrics={{ contextTokens: 10 }} testId="bar" />);
    expect(screen.queryByTestId('bar')).toBeNull();
    rerender(<ContextBar metrics={{ contextTokens: 150_000, contextWindow: 200_000 }} testId="bar" />);
    expect(screen.getByTestId('bar')).toHaveAttribute('data-level', 'warn');
    rerender(<ContextBar metrics={{ contextTokens: 190_000, contextWindow: 200_000 }} testId="bar" />);
    expect(screen.getByTestId('bar')).toHaveAttribute('data-level', 'danger');
  });
});

describe('rateLimitText', () => {
  it('shows the return time when known and plain text otherwise', () => {
    expect(rateLimitText({ message: 'x', resetsAt: 14 * 60_000 }, 0)).toBe('Limite de uso · volta em 14 min');
    expect(rateLimitText({ message: 'x' }, 0)).toBe('Limite de uso');
  });
});

describe('SessionFileBadge', () => {
  it('renders nothing for an unmarked file and distinguishes editing, changed and conflict', () => {
    const { rerender } = renderWithTheme(<SessionFileBadge mark={{ editing: [], changed: [] }} conflict={false} testId="m" />);
    expect(screen.queryByTestId('m')).toBeNull();
    rerender(<SessionFileBadge mark={{ editing: ['checkout'], changed: [] }} conflict={false} testId="m" />);
    expect(screen.getByTestId('m')).toHaveAttribute('data-mark', 'editing');
    rerender(<SessionFileBadge mark={{ editing: [], changed: ['checkout'] }} conflict={false} testId="m" />);
    expect(screen.getByTestId('m')).toHaveAttribute('data-mark', 'changed');
    rerender(<SessionFileBadge mark={{ editing: ['checkout'], changed: [] }} conflict testId="m" />);
    expect(screen.getByTestId('m')).toHaveAttribute('data-mark', 'conflict');
  });
});

const asking = (over: Partial<SessionSnapshot> = {}): SessionSnapshot =>
  ({
    sessionId: 's1',
    harness: 'claude',
    status: 'running',
    activity: 'needs-input',
    permissionRequest: { tool: 'Bash', command: 'rm -rf dist', cwd: '/w' },
    metrics: { lastAssistantText: 'Vou limpar o build.' },
    ...over,
  }) as SessionSnapshot;

describe('InlinePermission', () => {
  it('shows the full command, cwd and last assistant sentence, and offers only once / deny / open', () => {
    renderWithTheme(<InlinePermission session={asking()} onOpenSession={() => {}} />);
    expect(screen.getByTestId('inline-permission-command')).toHaveTextContent('rm -rf dist');
    expect(screen.getByText('em /w')).toBeInTheDocument();
    expect(screen.getByTestId('inline-permission-context')).toHaveTextContent('Vou limpar o build.');
    expect(screen.getByRole('button', { name: 'Permitir uma vez' })).toBeInTheDocument();
    expect(screen.queryByText(/sempre/i)).toBeNull();
  });

  it('sends the decision for that session', async () => {
    renderWithTheme(<InlinePermission session={asking()} onOpenSession={() => {}} />);
    await userEvent.click(screen.getByTestId('inline-permission-deny'));
    expect(call).toHaveBeenCalledWith('session.answerPermission', { sessionId: 's1', decision: 'deny' });
  });

  it('renders nothing when no hook raised the request', () => {
    renderWithTheme(<InlinePermission session={asking({ permissionRequest: undefined as never })} onOpenSession={() => {}} />);
    expect(screen.queryByTestId('inline-permission-s1')).toBeNull();
  });
});

const external = (over: Partial<ExternalSession> = {}): ExternalSession => ({
  id: 'e1', harness: 'claude', cwd: '/w/api', label: 'api', closed: false, precision: 'measured', lastEventAt: 1, activity: 'idle', activitySince: 1, terminal: 'iTerm2', ...over,
});

describe('external sessions UI', () => {
  it('labels the row "externa · terminal" and marks estimated ones', () => {
    renderWithQuery(<ExternalSessionRows sessions={[external({ precision: 'estimated' })]} filter={null} now={10} onAssumed={vi.fn()} onError={vi.fn()} />);
    const row = screen.getByTestId('tree-external-session-e1');
    expect(row).toHaveTextContent('externa · iTerm2 · estimado');
  });

  it('enables "Assumir aqui" only for an idle or closed session, and a closed one says the reason is unknown', () => {
    const { rerender } = renderWithQuery(<ExternalSessionRows sessions={[external({ activity: 'working' })]} filter={null} now={10} onAssumed={vi.fn()} onError={vi.fn()} />);
    expect(screen.getByTestId('external-assume-e1')).toBeDisabled();
    rerender(<ExternalSessionRows sessions={[external({ closed: true })]} filter={null} now={10} onAssumed={vi.fn()} onError={vi.fn()} />);
    expect(screen.getByTestId('external-assume-e1')).toBeEnabled();
    expect(screen.getByTestId('tree-external-session-e1')).toHaveTextContent('motivo desconhecido');
  });

  it('applies the state filter', () => {
    renderWithQuery(<ExternalSessionRows sessions={[external()]} filter="working" now={10} onAssumed={vi.fn()} onError={vi.fn()} />);
    expect(screen.queryByTestId('tree-external-session-e1')).toBeNull();
  });

  it('the consent banner sends the chosen mode', async () => {
    call.mockResolvedValue(ok({ consent: 'exact', hooksInstalled: { claude: true, cursor: false }, sessions: [] }));
    renderWithQuery(<ExternalConsentBanner />);
    await userEvent.click(screen.getByTestId('external-consent-estimated'));
    await waitFor(() => expect(call).toHaveBeenCalledWith('externalSession.setConsent', { mode: 'estimated' }));
  });
});
