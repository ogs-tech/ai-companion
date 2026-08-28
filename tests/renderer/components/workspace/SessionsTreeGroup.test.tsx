import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SessionsTreeGroup } from '../../../../src/renderer/components/workspace/SessionsTreeGroup.js';
import { mockApi, ok, renderWithShell, type CallSpy } from '../../test-utils.js';

const runningSession = {
  sessionId: 'workspace:w1',
  anchor: { kind: 'workspace' as const, workspaceId: 'w1' },
  cwd: '/repos/ws',
  label: 'Acme',
  status: 'running' as const,
};

const exitedSession = {
  sessionId: 'entity:urn:skill:foo',
  anchor: { kind: 'entity' as const, urn: 'urn:skill:foo' },
  cwd: '/repos/ws',
  label: 'foo',
  status: 'exited' as const,
};

let call: CallSpy;
beforeEach(() => {
  call = mockApi();
  call.mockImplementation(async (method: string) => {
    if (method === 'session.list') return ok([runningSession, exitedSession]);
    return ok(undefined);
  });
});

describe('SessionsTreeGroup', () => {
  it('shows only running sessions when finished sessions are hidden', async () => {
    const user = userEvent.setup();
    renderWithShell(<SessionsTreeGroup showFinished={false} onOpen={vi.fn()} />);
    await user.click(await screen.findByTestId('tree-group-session'));
    expect(await screen.findByTestId('tree-session-workspace:w1')).toBeInTheDocument();
    expect(screen.queryByTestId('tree-session-entity:urn:skill:foo')).not.toBeInTheDocument();
  });

  it('reveals exited sessions once showFinished is true', async () => {
    const user = userEvent.setup();
    renderWithShell(<SessionsTreeGroup showFinished onOpen={vi.fn()} />);
    await user.click(await screen.findByTestId('tree-group-session'));
    expect(await screen.findByTestId('tree-session-workspace:w1')).toBeInTheDocument();
    expect(await screen.findByTestId('tree-session-entity:urn:skill:foo')).toBeInTheDocument();
  });

  it('shows the anchor kind and status for each session', async () => {
    const user = userEvent.setup();
    renderWithShell(<SessionsTreeGroup showFinished onOpen={vi.fn()} />);
    await user.click(await screen.findByTestId('tree-group-session'));
    expect(await screen.findByTestId('status-pill-session-status-workspace:w1')).toHaveTextContent('Ativa');
    expect(await screen.findByTestId('status-pill-session-status-entity:urn:skill:foo')).toHaveTextContent('Encerrada');
  });

  it('calls onOpen with the anchor and label when a row is clicked', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    renderWithShell(<SessionsTreeGroup showFinished={false} onOpen={onOpen} />);
    await user.click(await screen.findByTestId('tree-group-session'));
    await user.click(await screen.findByTestId('tree-session-workspace:w1'));
    expect(onOpen).toHaveBeenCalledWith({ kind: 'workspace', workspaceId: 'w1' }, 'Acme');
  });

  it('shows nothing and the empty state when there are no sessions', async () => {
    const user = userEvent.setup();
    call.mockImplementation(async () => ok(undefined));
    renderWithShell(<SessionsTreeGroup showFinished onOpen={vi.fn()} />);
    await user.click(await screen.findByTestId('tree-group-session'));
    expect(await screen.findByTestId('tree-group-empty-session')).toBeInTheDocument();
  });
});
