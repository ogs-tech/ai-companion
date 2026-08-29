import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
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
  it('lists every known session, running and exited alike, as a flat list', async () => {
    renderWithShell(<SessionsTreeGroup onOpen={vi.fn()} />);
    expect(await screen.findByTestId('tree-session-workspace:w1')).toBeInTheDocument();
    expect(await screen.findByTestId('tree-session-entity:urn:skill:foo')).toBeInTheDocument();
  });

  it('shows the anchor kind and status for each session', async () => {
    renderWithShell(<SessionsTreeGroup onOpen={vi.fn()} />);
    expect(await screen.findByTestId('status-pill-session-status-workspace:w1')).toHaveTextContent('Ativa');
    expect(await screen.findByTestId('status-pill-session-status-entity:urn:skill:foo')).toHaveTextContent('Encerrada');
  });

  it('shows the empty state when there are no sessions', async () => {
    call.mockImplementation(async () => ok(undefined));
    renderWithShell(<SessionsTreeGroup onOpen={vi.fn()} />);
    expect(await screen.findByTestId('sessions-empty')).toBeInTheDocument();
  });

  it('calls onOpen with the full session when a running row is clicked, with no IPC call', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    renderWithShell(<SessionsTreeGroup onOpen={onOpen} />);
    await user.click(await screen.findByTestId('tree-session-workspace:w1'));
    expect(onOpen).toHaveBeenCalledWith(runningSession);
    expect(call).not.toHaveBeenCalledWith('session.resume', expect.anything());
    expect(call).not.toHaveBeenCalledWith('session.spawn', expect.anything());
  });

  it('offers Encerrar (not Retomar) on a running session, and calls session.kill', async () => {
    const user = userEvent.setup();
    renderWithShell(<SessionsTreeGroup onOpen={vi.fn()} />);
    expect(await screen.findByTestId('tree-session-workspace:w1')).toBeInTheDocument();
    expect(screen.queryByTestId('tree-session-resume-workspace:w1')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('tree-session-stop-workspace:w1'));
    await waitFor(() => expect(call).toHaveBeenCalledWith('session.kill', { sessionId: 'workspace:w1' }));
  });

  it('clicking an exited row resumes it via session.resume and opens its tab with the resumed session — no dedicated Retomar icon', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const resumed = { ...exitedSession, status: 'running' as const };
    call.mockImplementation(async (method: string) => {
      if (method === 'session.list') return ok([runningSession, exitedSession]);
      if (method === 'session.resume') return ok(resumed);
      return ok(undefined);
    });
    renderWithShell(<SessionsTreeGroup onOpen={onOpen} />);
    expect(await screen.findByTestId('tree-session-entity:urn:skill:foo')).toBeInTheDocument();
    expect(screen.queryByTestId('tree-session-stop-entity:urn:skill:foo')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tree-session-resume-entity:urn:skill:foo')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('tree-session-entity:urn:skill:foo'));

    await waitFor(() =>
      expect(call).toHaveBeenCalledWith('session.resume', { sessionId: 'entity:urn:skill:foo' }),
    );
    expect(onOpen).toHaveBeenCalledWith(resumed);
  });

  it('apaga a session after confirmation, calling session.remove and onRemoved with the sessionId', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const onRemoved = vi.fn();
    renderWithShell(<SessionsTreeGroup onOpen={vi.fn()} onRemoved={onRemoved} />);
    await user.click(await screen.findByTestId('tree-session-remove-entity:urn:skill:foo'));
    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() =>
      expect(call).toHaveBeenCalledWith('session.remove', { sessionId: 'entity:urn:skill:foo' }),
    );
    expect(onRemoved).toHaveBeenCalledWith('entity:urn:skill:foo');
    confirmSpy.mockRestore();
  });

  it('does not call session.remove when the confirmation is declined', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderWithShell(<SessionsTreeGroup onOpen={vi.fn()} />);
    await user.click(await screen.findByTestId('tree-session-remove-entity:urn:skill:foo'));
    expect(confirmSpy).toHaveBeenCalled();
    expect(call).not.toHaveBeenCalledWith('session.remove', expect.anything());
    confirmSpy.mockRestore();
  });
});
