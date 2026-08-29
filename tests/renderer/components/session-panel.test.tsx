import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SessionPanel } from '../../../src/renderer/components/SessionPanel.js';
import { mockApi, ok, fail, renderWithQuery, type CallSpy } from '../test-utils.js';

interface MockTerminal {
  write: ReturnType<typeof vi.fn>;
  open: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  loadAddon: ReturnType<typeof vi.fn>;
  onData: ReturnType<typeof vi.fn>;
  _onDataCb: ((data: string) => void) | undefined;
}

const mockTerminalInstances: MockTerminal[] = [];

vi.mock('@xterm/xterm', () => {
  class Terminal implements MockTerminal {
    write = vi.fn();
    open = vi.fn();
    dispose = vi.fn();
    loadAddon = vi.fn();
    _onDataCb: ((data: string) => void) | undefined;
    onData = vi.fn((cb: (data: string) => void) => {
      this._onDataCb = cb;
      return { dispose: vi.fn() };
    });
    constructor() {
      mockTerminalInstances.push(this);
    }
  }
  return { Terminal };
});

vi.mock('@xterm/addon-fit', () => {
  class FitAddon {
    fit = vi.fn();
    proposeDimensions = vi.fn(() => ({ cols: 80, rows: 24 }));
  }
  return { FitAddon };
});

let call: CallSpy;
let onOutput: ReturnType<typeof vi.fn>;
let onExit: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockTerminalInstances.length = 0;
  call = mockApi();
  onOutput = vi.mocked(window.api.session.onOutput);
  onExit = vi.mocked(window.api.session.onExit);
});

describe('<SessionPanel>', () => {
  it('mounts the terminal and shows an "Abrir sessão" button before any session is started', () => {
    renderWithQuery(<SessionPanel anchor={{ kind: 'entity', urn: 'urn:skill:foo' }} />);
    expect(screen.getByTestId('session-open')).toBeInTheDocument();
    expect(mockTerminalInstances).toHaveLength(1);
    expect(mockTerminalInstances[0]!.open).toHaveBeenCalled();
  });

  it('spawns a session and switches out of the idle state on click', async () => {
    const user = userEvent.setup();
    call.mockImplementation(async (method: string) => {
      if (method === 'session.status') return ok(null);
      return ok({ sessionId: 'entity:urn:skill:foo', anchor: { kind: 'entity', urn: 'urn:skill:foo' }, cwd: '/workspace', status: 'running' });
    });

    renderWithQuery(<SessionPanel anchor={{ kind: 'entity', urn: 'urn:skill:foo' }} />);
    await user.click(screen.getByTestId('session-open'));

    await waitFor(() =>
      expect(call).toHaveBeenCalledWith('session.spawn', { anchor: { kind: 'entity', urn: 'urn:skill:foo' } }),
    );
    await waitFor(() => expect(screen.queryByTestId('session-open')).toBeNull());
  });

  it('subscribes to output/exit for the spawned sessionId and writes chunks into the terminal', async () => {
    const user = userEvent.setup();
    call.mockImplementation(async (method: string) => {
      if (method === 'session.status') return ok(null);
      return ok({ sessionId: 'entity:urn:skill:foo', anchor: { kind: 'entity', urn: 'urn:skill:foo' }, cwd: '/workspace', status: 'running' });
    });

    renderWithQuery(<SessionPanel anchor={{ kind: 'entity', urn: 'urn:skill:foo' }} />);
    await user.click(screen.getByTestId('session-open'));
    await waitFor(() =>
      expect(onOutput).toHaveBeenCalledWith('entity:urn:skill:foo', expect.any(Function)),
    );

    const chunkListener = onOutput.mock.calls[0]?.[1] as (chunk: string) => void;
    chunkListener('hello');

    const terminal = mockTerminalInstances[0]!;
    expect(terminal.write).toHaveBeenCalledWith('hello');
  });

  it('forwards keystrokes typed into the terminal as session.write calls', async () => {
    const user = userEvent.setup();
    call.mockImplementation(async (method: string) => {
      if (method === 'session.status') return ok(null);
      return ok({ sessionId: 'entity:urn:skill:foo', anchor: { kind: 'entity', urn: 'urn:skill:foo' }, cwd: '/workspace', status: 'running' });
    });

    renderWithQuery(<SessionPanel anchor={{ kind: 'entity', urn: 'urn:skill:foo' }} />);
    await user.click(screen.getByTestId('session-open'));
    await waitFor(() => expect(call).toHaveBeenCalledWith('session.spawn', { anchor: { kind: 'entity', urn: 'urn:skill:foo' } }));

    const terminal = mockTerminalInstances[0]!;
    terminal._onDataCb?.('ls\r');

    await waitFor(() =>
      expect(call).toHaveBeenCalledWith('session.write', { sessionId: 'entity:urn:skill:foo', data: 'ls\r' }),
    );
  });

  it('shows the ended state and a resume action when the session exits', async () => {
    const user = userEvent.setup();
    call.mockImplementation(async (method: string) => {
      if (method === 'session.status') return ok(null);
      return ok({ sessionId: 'entity:urn:skill:foo', anchor: { kind: 'entity', urn: 'urn:skill:foo' }, cwd: '/workspace', status: 'running' });
    });

    renderWithQuery(<SessionPanel anchor={{ kind: 'entity', urn: 'urn:skill:foo' }} />);
    await user.click(screen.getByTestId('session-open'));
    await waitFor(() =>
      expect(onExit).toHaveBeenCalledWith('entity:urn:skill:foo', expect.any(Function)),
    );

    const exitListener = onExit.mock.calls[0]?.[1] as (exitCode: number) => void;
    exitListener(0);

    expect(await screen.findByTestId('session-resume')).toBeInTheDocument();
  });

  it('shows an inline error when session.spawn fails', async () => {
    const user = userEvent.setup();
    call.mockResolvedValue(fail('io', 'claude CLI not found in PATH'));

    renderWithQuery(<SessionPanel anchor={{ kind: 'entity', urn: 'urn:skill:foo' }} />);
    await user.click(screen.getByTestId('session-open'));

    expect(await screen.findByTestId('session-error')).toHaveTextContent('claude CLI not found in PATH');
  });

  it('lets the user retry in place after session.spawn fails', async () => {
    const user = userEvent.setup();
    call.mockResolvedValue(fail('io', 'claude CLI not found in PATH'));

    renderWithQuery(<SessionPanel anchor={{ kind: 'entity', urn: 'urn:skill:foo' }} />);
    await user.click(screen.getByTestId('session-open'));
    await screen.findByTestId('session-error');

    const retryButton = screen.getByTestId('session-open');
    expect(retryButton).toBeInTheDocument();

    await user.click(retryButton);

    const spawnCalls = () => call.mock.calls.filter(([method]) => method === 'session.spawn');
    await waitFor(() => expect(spawnCalls()).toHaveLength(2));
    expect(spawnCalls()[1]).toEqual(['session.spawn', { anchor: { kind: 'entity', urn: 'urn:skill:foo' } }]);
  });

  describe('reattaching on mount', () => {
    it('reattaches to an already-running session without requiring a click', async () => {
      call.mockImplementation(async (method: string) => {
        if (method === 'session.status') {
          return ok({ sessionId: 'entity:urn:skill:foo', anchor: { kind: 'entity', urn: 'urn:skill:foo' }, cwd: '/workspace', label: 'foo', status: 'running' });
        }
        return ok(null);
      });

      renderWithQuery(<SessionPanel anchor={{ kind: 'entity', urn: 'urn:skill:foo' }} />);

      await waitFor(() => expect(screen.queryByTestId('session-open')).toBeNull());
      await waitFor(() =>
        expect(onOutput).toHaveBeenCalledWith('entity:urn:skill:foo', expect.any(Function)),
      );
    });

    it('shows the ended state when reattaching to an already-exited session', async () => {
      call.mockImplementation(async (method: string) => {
        if (method === 'session.status') {
          return ok({ sessionId: 'entity:urn:skill:foo', anchor: { kind: 'entity', urn: 'urn:skill:foo' }, cwd: '/workspace', label: 'foo', status: 'exited' });
        }
        return ok(null);
      });

      renderWithQuery(<SessionPanel anchor={{ kind: 'entity', urn: 'urn:skill:foo' }} />);

      expect(await screen.findByTestId('session-resume')).toBeInTheDocument();
    });

    it('stays idle when no existing session is found for the anchor', async () => {
      call.mockImplementation(async (method: string) => {
        if (method === 'session.status') return ok(null);
        return ok(null);
      });

      renderWithQuery(<SessionPanel anchor={{ kind: 'entity', urn: 'urn:skill:foo' }} />);

      await waitFor(() =>
        expect(call).toHaveBeenCalledWith('session.status', { sessionId: 'entity:urn:skill:foo' }),
      );
      expect(screen.getByTestId('session-open')).toBeInTheDocument();
    });

    it('replays the buffered output into the terminal before subscribing to live output', async () => {
      call.mockImplementation(async (method: string) => {
        if (method === 'session.status') {
          return ok({
            sessionId: 'entity:urn:skill:foo',
            anchor: { kind: 'entity', urn: 'urn:skill:foo' },
            cwd: '/workspace',
            label: 'foo',
            status: 'running',
            outputBuffer: 'previous output\r\n',
          });
        }
        return ok(null);
      });

      renderWithQuery(<SessionPanel anchor={{ kind: 'entity', urn: 'urn:skill:foo' }} />);

      await waitFor(() => expect(mockTerminalInstances[0]!.write).toHaveBeenCalledWith('previous output\r\n'));
    });

    it('does not write anything when reattaching to a session with an empty buffer', async () => {
      call.mockImplementation(async (method: string) => {
        if (method === 'session.status') {
          return ok({
            sessionId: 'entity:urn:skill:foo',
            anchor: { kind: 'entity', urn: 'urn:skill:foo' },
            cwd: '/workspace',
            label: 'foo',
            status: 'running',
            outputBuffer: '',
          });
        }
        return ok(null);
      });

      renderWithQuery(<SessionPanel anchor={{ kind: 'entity', urn: 'urn:skill:foo' }} />);

      await waitFor(() => expect(call).toHaveBeenCalledWith('session.status', { sessionId: 'entity:urn:skill:foo' }));
      expect(mockTerminalInstances[0]!.write).not.toHaveBeenCalled();
    });
  });

  describe('sessionId prop (opened already-attached from the Workbench)', () => {
    it('never shows the idle "Abrir sessão" state, whatever session.status returns while resolving', () => {
      call.mockImplementation(async () => new Promise(() => {})); // never resolves
      renderWithQuery(<SessionPanel anchor={{ kind: 'workspace', workspaceId: 'w1' }} sessionId="sess-1" />);
      expect(screen.queryByTestId('session-open')).toBeNull();
    });

    it('attaches by the given sessionId directly, without deriving it from the anchor', async () => {
      call.mockImplementation(async (method: string) => {
        if (method === 'session.status') {
          return ok({ sessionId: 'sess-1', anchor: { kind: 'workspace', workspaceId: 'w1' }, cwd: '/repos/ws', label: 'W', status: 'running', outputBuffer: '' });
        }
        return ok(null);
      });

      renderWithQuery(<SessionPanel anchor={{ kind: 'workspace', workspaceId: 'w1' }} sessionId="sess-1" />);

      await waitFor(() => expect(call).toHaveBeenCalledWith('session.status', { sessionId: 'sess-1' }));
      await waitFor(() => expect(onOutput).toHaveBeenCalledWith('sess-1', expect.any(Function)));
    });

    it('replays the buffered output for the given sessionId', async () => {
      call.mockImplementation(async (method: string) => {
        if (method === 'session.status') {
          return ok({ sessionId: 'sess-1', anchor: { kind: 'workspace', workspaceId: 'w1' }, cwd: '/repos/ws', label: 'W', status: 'running', outputBuffer: 'hi there' });
        }
        return ok(null);
      });

      renderWithQuery(<SessionPanel anchor={{ kind: 'workspace', workspaceId: 'w1' }} sessionId="sess-1" />);

      await waitFor(() => expect(mockTerminalInstances[0]!.write).toHaveBeenCalledWith('hi there'));
    });

    it('shows the ended state with a Retomar action when the given session has already exited', async () => {
      call.mockImplementation(async (method: string) => {
        if (method === 'session.status') {
          return ok({ sessionId: 'sess-1', anchor: { kind: 'workspace', workspaceId: 'w1' }, cwd: '/repos/ws', label: 'W', status: 'exited', outputBuffer: '' });
        }
        return ok(null);
      });

      renderWithQuery(<SessionPanel anchor={{ kind: 'workspace', workspaceId: 'w1' }} sessionId="sess-1" />);

      expect(await screen.findByTestId('session-resume')).toBeInTheDocument();
    });

    it('clicking Retomar calls session.resume with the given sessionId, not session.spawn', async () => {
      const user = userEvent.setup();
      call.mockImplementation(async (method: string) => {
        if (method === 'session.status') {
          return ok({ sessionId: 'sess-1', anchor: { kind: 'workspace', workspaceId: 'w1' }, cwd: '/repos/ws', label: 'W', status: 'exited', outputBuffer: '' });
        }
        if (method === 'session.resume') {
          return ok({ sessionId: 'sess-1', anchor: { kind: 'workspace', workspaceId: 'w1' }, cwd: '/repos/ws', label: 'W', status: 'running', outputBuffer: '' });
        }
        return ok(null);
      });

      renderWithQuery(<SessionPanel anchor={{ kind: 'workspace', workspaceId: 'w1' }} sessionId="sess-1" />);
      await user.click(await screen.findByTestId('session-resume'));

      await waitFor(() => expect(call).toHaveBeenCalledWith('session.resume', { sessionId: 'sess-1' }));
      expect(call).not.toHaveBeenCalledWith('session.spawn', expect.anything());
      await waitFor(() => expect(screen.queryByTestId('session-resume')).toBeNull());
    });
  });

  describe('visible prop', () => {
    it('does not resize on window resize while hidden', async () => {
      const user = userEvent.setup();
      call.mockImplementation(async (method: string) => {
        if (method === 'session.status') return ok(null);
        if (method === 'session.spawn') {
          return ok({ sessionId: 'entity:urn:skill:foo', anchor: { kind: 'entity', urn: 'urn:skill:foo' }, cwd: '/workspace', status: 'running' });
        }
        return ok(null);
      });

      renderWithQuery(<SessionPanel anchor={{ kind: 'entity', urn: 'urn:skill:foo' }} visible={false} />);
      await user.click(screen.getByTestId('session-open'));
      await waitFor(() => expect(call).toHaveBeenCalledWith('session.spawn', expect.anything()));

      call.mockClear();
      window.dispatchEvent(new Event('resize'));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(call).not.toHaveBeenCalledWith('session.resize', expect.anything());
    });

    it('refits and resizes once a hidden panel becomes visible again', async () => {
      const user = userEvent.setup();
      call.mockImplementation(async (method: string) => {
        if (method === 'session.status') return ok(null);
        if (method === 'session.spawn') {
          return ok({ sessionId: 'entity:urn:skill:foo', anchor: { kind: 'entity', urn: 'urn:skill:foo' }, cwd: '/workspace', status: 'running' });
        }
        return ok(null);
      });

      const { rerender } = renderWithQuery(<SessionPanel anchor={{ kind: 'entity', urn: 'urn:skill:foo' }} visible />);
      await user.click(screen.getByTestId('session-open'));
      await waitFor(() => expect(call).toHaveBeenCalledWith('session.spawn', expect.anything()));

      call.mockClear();
      rerender(<SessionPanel anchor={{ kind: 'entity', urn: 'urn:skill:foo' }} visible={false} />);
      rerender(<SessionPanel anchor={{ kind: 'entity', urn: 'urn:skill:foo' }} visible />);

      await waitFor(() =>
        expect(call).toHaveBeenCalledWith('session.resize', expect.objectContaining({ sessionId: 'entity:urn:skill:foo' })),
      );
    });
  });
});
