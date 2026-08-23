import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SessionPanel } from '../../../src/renderer/components/SessionPanel.js';
import { mockApi, ok, fail, renderWithTheme, type CallSpy } from '../test-utils.js';

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
    renderWithTheme(<SessionPanel anchor={{ kind: 'entity', urn: 'urn:skill:foo' }} />);
    expect(screen.getByTestId('session-open')).toBeInTheDocument();
    expect(mockTerminalInstances).toHaveLength(1);
    expect(mockTerminalInstances[0]!.open).toHaveBeenCalled();
  });

  it('spawns a session and switches out of the idle state on click', async () => {
    const user = userEvent.setup();
    call.mockResolvedValue(ok({ sessionId: 'entity:urn:skill:foo', anchor: { kind: 'entity', urn: 'urn:skill:foo' }, cwd: '/workspace', status: 'running' }));

    renderWithTheme(<SessionPanel anchor={{ kind: 'entity', urn: 'urn:skill:foo' }} />);
    await user.click(screen.getByTestId('session-open'));

    await waitFor(() =>
      expect(call).toHaveBeenCalledWith('session.spawn', { anchor: { kind: 'entity', urn: 'urn:skill:foo' } }),
    );
    await waitFor(() => expect(screen.queryByTestId('session-open')).toBeNull());
  });

  it('subscribes to output/exit for the spawned sessionId and writes chunks into the terminal', async () => {
    const user = userEvent.setup();
    call.mockResolvedValue(ok({ sessionId: 'entity:urn:skill:foo', anchor: { kind: 'entity', urn: 'urn:skill:foo' }, cwd: '/workspace', status: 'running' }));

    renderWithTheme(<SessionPanel anchor={{ kind: 'entity', urn: 'urn:skill:foo' }} />);
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
    call.mockResolvedValue(ok({ sessionId: 'entity:urn:skill:foo', anchor: { kind: 'entity', urn: 'urn:skill:foo' }, cwd: '/workspace', status: 'running' }));

    renderWithTheme(<SessionPanel anchor={{ kind: 'entity', urn: 'urn:skill:foo' }} />);
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
    call.mockResolvedValue(ok({ sessionId: 'entity:urn:skill:foo', anchor: { kind: 'entity', urn: 'urn:skill:foo' }, cwd: '/workspace', status: 'running' }));

    renderWithTheme(<SessionPanel anchor={{ kind: 'entity', urn: 'urn:skill:foo' }} />);
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

    renderWithTheme(<SessionPanel anchor={{ kind: 'entity', urn: 'urn:skill:foo' }} />);
    await user.click(screen.getByTestId('session-open'));

    expect(await screen.findByTestId('session-error')).toHaveTextContent('claude CLI not found in PATH');
  });

  it('lets the user retry in place after session.spawn fails', async () => {
    const user = userEvent.setup();
    call.mockResolvedValue(fail('io', 'claude CLI not found in PATH'));

    renderWithTheme(<SessionPanel anchor={{ kind: 'entity', urn: 'urn:skill:foo' }} />);
    await user.click(screen.getByTestId('session-open'));
    await screen.findByTestId('session-error');

    const retryButton = screen.getByTestId('session-open');
    expect(retryButton).toBeInTheDocument();

    await user.click(retryButton);

    await waitFor(() => expect(call).toHaveBeenCalledTimes(2));
    expect(call).toHaveBeenNthCalledWith(2, 'session.spawn', { anchor: { kind: 'entity', urn: 'urn:skill:foo' } });
  });
});
