import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SessionPanel, TERMINAL_NEWLINE_SEQUENCE } from '../../../src/renderer/components/SessionPanel.js';
import {
  closeBrowserTab,
  getBrowserTabsSnapshot,
  registerBrowserWorkbenchOpener,
  resetBrowserTabsForTests,
} from '../../../src/renderer/lib/browser-tabs-store.js';
import { mockApi, ok, fail, renderWithQuery, type CallSpy } from '../test-utils.js';

interface MockTerminal {
  write: ReturnType<typeof vi.fn>;
  open: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  loadAddon: ReturnType<typeof vi.fn>;
  onData: ReturnType<typeof vi.fn>;
  attachCustomKeyEventHandler: ReturnType<typeof vi.fn>;
  _onDataCb: ((data: string) => void) | undefined;
  _keyHandler: ((event: KeyboardEvent) => boolean) | undefined;
}

const mockTerminalInstances: MockTerminal[] = [];

vi.mock('@xterm/xterm', () => {
  class Terminal implements MockTerminal {
    write = vi.fn();
    open = vi.fn();
    dispose = vi.fn();
    loadAddon = vi.fn();
    _onDataCb: ((data: string) => void) | undefined;
    _keyHandler: ((event: KeyboardEvent) => boolean) | undefined;
    onData = vi.fn((cb: (data: string) => void) => {
      this._onDataCb = cb;
      return { dispose: vi.fn() };
    });
    attachCustomKeyEventHandler = vi.fn((handler: (event: KeyboardEvent) => boolean) => {
      this._keyHandler = handler;
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

class MockResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  callback: () => void;
  constructor(callback: () => void) {
    this.callback = callback;
    mockResizeObserverInstances.push(this);
  }
}

const mockResizeObserverInstances: MockResizeObserver[] = [];

let call: CallSpy;
let onOutput: ReturnType<typeof vi.fn>;
let onExit: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockTerminalInstances.length = 0;
  mockResizeObserverInstances.length = 0;
  vi.stubGlobal('ResizeObserver', MockResizeObserver);
  call = mockApi();
  onOutput = vi.mocked(window.api.session.onOutput);
  onExit = vi.mocked(window.api.session.onExit);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('<SessionPanel>', () => {
  it('lets the terminal grow to fill the tab instead of a fixed height, so it does not leave dead space below it', () => {
    renderWithQuery(<SessionPanel anchor={{ kind: 'entity', urn: 'urn:skill:foo' }} />);
    expect(screen.getByTestId('session-terminal')).toHaveStyle({ flexGrow: '1', minHeight: '0px' });
  });

  it('mounts the terminal directly into the padding-free session-terminal box, so FitAddon never sizes rows/cols against space eaten by padding', () => {
    renderWithQuery(<SessionPanel anchor={{ kind: 'entity', urn: 'urn:skill:foo' }} />);
    const terminalBox = screen.getByTestId('session-terminal');
    expect(terminalBox.style.padding).toBe('');
    expect(mockTerminalInstances[0]!.open).toHaveBeenCalledWith(terminalBox);
  });

  it('mounts the terminal and shows an "Abrir sessão" button before any session is started', () => {
    renderWithQuery(<SessionPanel anchor={{ kind: 'entity', urn: 'urn:skill:foo' }} />);
    expect(screen.getByTestId('session-open')).toBeInTheDocument();
    expect(mockTerminalInstances).toHaveLength(1);
    expect(mockTerminalInstances[0]!.open).toHaveBeenCalled();
  });

  it('shows the "Sessão" header with its status pill while idle, since that is where the "Abrir sessão" action lives', () => {
    renderWithQuery(<SessionPanel anchor={{ kind: 'entity', urn: 'urn:skill:foo' }} />);
    expect(screen.getByTestId('status-pill-session')).toBeInTheDocument();
  });

  it('drops the "Abrir sessão" action once the session is running, but keeps a thin header for the browser toggle', async () => {
    const user = userEvent.setup();
    call.mockImplementation(async (method: string) => {
      if (method === 'session.status') return ok(null);
      return ok({
        sessionId: 'entity:urn:skill:foo',
        anchor: { kind: 'entity', urn: 'urn:skill:foo' },
        cwd: '/workspace',
        status: 'running',
        browserEnabled: false,
      });
    });

    renderWithQuery(<SessionPanel anchor={{ kind: 'entity', urn: 'urn:skill:foo' }} />);
    await user.click(screen.getByTestId('session-open'));

    await waitFor(() => expect(screen.queryByTestId('session-open')).toBeNull());
    expect(screen.getByTestId('status-pill-session')).toBeInTheDocument();
    expect(screen.getByTestId('session-browser-toggle')).toBeInTheDocument();
    expect(screen.getByTestId('session-terminal')).toBeInTheDocument();
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

  describe('container resize', () => {
    it('refits and resizes when the terminal container itself changes size, not only on window resize', async () => {
      const user = userEvent.setup();
      call.mockImplementation(async (method: string) => {
        if (method === 'session.status') return ok(null);
        if (method === 'session.spawn') {
          return ok({ sessionId: 'entity:urn:skill:foo', anchor: { kind: 'entity', urn: 'urn:skill:foo' }, cwd: '/workspace', status: 'running' });
        }
        return ok(null);
      });

      renderWithQuery(<SessionPanel anchor={{ kind: 'entity', urn: 'urn:skill:foo' }} />);
      await user.click(screen.getByTestId('session-open'));
      await waitFor(() => expect(call).toHaveBeenCalledWith('session.spawn', expect.anything()));

      // The effect re-runs when sessionId changes from null to the spawned
      // id, tearing down the first observer and creating a fresh one — only
      // the latest instance is still connected.
      const observer = mockResizeObserverInstances.at(-1)!;
      expect(observer.observe).toHaveBeenCalledWith(screen.getByTestId('session-terminal'));

      call.mockClear();
      observer.callback();

      await waitFor(() =>
        expect(call).toHaveBeenCalledWith('session.resize', expect.objectContaining({ sessionId: 'entity:urn:skill:foo' })),
      );
    });

    it('disconnects the observer on unmount', () => {
      const { unmount } = renderWithQuery(<SessionPanel anchor={{ kind: 'entity', urn: 'urn:skill:foo' }} />);
      const observer = mockResizeObserverInstances[0]!;

      unmount();

      expect(observer.disconnect).toHaveBeenCalled();
    });
  });
  describe('Shift+Enter', () => {
    /** Spawns a running session and hands back the terminal's custom key handler. */
    async function attachedTerminal(): Promise<MockTerminal> {
      const user = userEvent.setup();
      call.mockImplementation(async (method: string) => {
        if (method === 'session.status') return ok(null);
        return ok({
          sessionId: 'entity:urn:skill:foo',
          anchor: { kind: 'entity', urn: 'urn:skill:foo' },
          cwd: '/workspace',
          status: 'running',
        });
      });
      renderWithQuery(<SessionPanel anchor={{ kind: 'entity', urn: 'urn:skill:foo' }} />);
      await user.click(screen.getByTestId('session-open'));
      await waitFor(() => expect(call).toHaveBeenCalledWith('session.spawn', expect.anything()));
      const terminal = mockTerminalInstances[0]!;
      await waitFor(() => expect(terminal._keyHandler).toBeDefined());
      call.mockClear();
      return terminal;
    }

    function keydown(init: Partial<KeyboardEvent> & { key: string }): KeyboardEvent {
      // `preventDefault` is not decoration: without it xterm lets the legacy keypress
      // through and re-emits a `\r`. See session-panel-key-events.test.tsx, which pins
      // that against the real terminal rather than this stand-in.
      return {
        type: 'keydown',
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        preventDefault: vi.fn(),
        ...init,
      } as KeyboardEvent;
    }

    it('writes ESC+CR instead of a carriage return, so the CLI inserts a newline rather than submitting', async () => {
      const terminal = await attachedTerminal();

      const event = keydown({ key: 'Enter', shiftKey: true });
      const propagate = terminal._keyHandler!(event);
      expect(event.preventDefault).toHaveBeenCalled();

      expect(propagate).toBe(false);
      await waitFor(() =>
        expect(call).toHaveBeenCalledWith('session.write', {
          sessionId: 'entity:urn:skill:foo',
          data: TERMINAL_NEWLINE_SEQUENCE,
        }),
      );
      expect(TERMINAL_NEWLINE_SEQUENCE).toBe('\x1b\r');
    });

    it('stops xterm from emitting its own \\r, so the newline is not immediately followed by a submit', async () => {
      const terminal = await attachedTerminal();

      terminal._keyHandler!(keydown({ key: 'Enter', shiftKey: true }));

      await waitFor(() => expect(call).toHaveBeenCalled());
      expect(call).not.toHaveBeenCalledWith('session.write', expect.objectContaining({ data: '\r' }));
    });

    it('leaves a plain Enter to xterm untouched, so submitting still works', async () => {
      const terminal = await attachedTerminal();

      expect(terminal._keyHandler!(keydown({ key: 'Enter' }))).toBe(true);

      expect(call).not.toHaveBeenCalledWith('session.write', expect.anything());
    });

    it.each([['altKey'], ['ctrlKey'], ['metaKey']])(
      'leaves Shift+Enter with %s held to the CLI, which binds those itself',
      async (modifier) => {
        const terminal = await attachedTerminal();

        expect(terminal._keyHandler!(keydown({ key: 'Enter', shiftKey: true, [modifier]: true }))).toBe(true);

        expect(call).not.toHaveBeenCalledWith('session.write', expect.anything());
      },
    );

    it('ignores the keyup half of the gesture, so one press writes one newline', async () => {
      const terminal = await attachedTerminal();

      expect(terminal._keyHandler!({ ...keydown({ key: 'Enter', shiftKey: true }), type: 'keyup' } as KeyboardEvent)).toBe(
        true,
      );

      expect(call).not.toHaveBeenCalledWith('session.write', expect.anything());
    });

    it('swallows the key without writing when no session is attached yet, rather than submitting into nothing', () => {
      call.mockImplementation(async () => ok(null));
      renderWithQuery(<SessionPanel anchor={{ kind: 'entity', urn: 'urn:skill:foo' }} />);
      const terminal = mockTerminalInstances[0]!;

      expect(terminal._keyHandler!(keydown({ key: 'Enter', shiftKey: true }))).toBe(false);

      expect(call).not.toHaveBeenCalledWith('session.write', expect.anything());
    });
  });

  describe('browser toggle', () => {
    afterEach(() => {
      resetBrowserTabsForTests();
    });

    it('does not render the toggle before a sessionId is known', () => {
      call.mockImplementation(async () => ok(null));
      renderWithQuery(<SessionPanel anchor={{ kind: 'entity', urn: 'urn:skill:foo' }} />);
      expect(screen.queryByTestId('session-browser-toggle')).toBeNull();
    });

    it('clicking the toggle calls browser.enable, registers the tab, and asks the Workbench opener to open it', async () => {
      const user = userEvent.setup();
      const opener = vi.fn();
      registerBrowserWorkbenchOpener(opener);
      call.mockImplementation(async (method: string) => {
        if (method === 'session.status') {
          return ok({
            sessionId: 'sess-1', anchor: { kind: 'workspace', workspaceId: 'w1' }, cwd: '/repos/ws',
            label: 'W', status: 'running', outputBuffer: '', browserEnabled: false,
          });
        }
        return ok(null);
      });

      renderWithQuery(<SessionPanel anchor={{ kind: 'workspace', workspaceId: 'w1' }} sessionId="sess-1" />);
      const toggle = await screen.findByTestId('session-browser-toggle');
      await user.click(toggle);

      await waitFor(() => expect(call).toHaveBeenCalledWith('browser.enable', { sessionId: 'sess-1' }));
      expect(getBrowserTabsSnapshot().tabs).toEqual([{ tabId: 'sess-1', sessionId: 'sess-1', url: '' }]);
      expect(opener).toHaveBeenCalledWith('sess-1');
      await waitFor(() => expect(toggle).toHaveAttribute('aria-label', 'Desativar navegador da sessão'));
    });

    it('disables the toggle while browser.enable is in flight, since it may be restarting the session', async () => {
      const user = userEvent.setup();
      let resolveEnable!: () => void;
      call.mockImplementation(async (method: string) => {
        if (method === 'session.status') {
          return ok({
            sessionId: 'sess-1', anchor: { kind: 'workspace', workspaceId: 'w1' }, cwd: '/repos/ws',
            label: 'W', status: 'running', outputBuffer: '', browserEnabled: false,
          });
        }
        if (method === 'browser.enable') {
          return new Promise((resolve) => {
            resolveEnable = () => resolve(ok(null));
          });
        }
        return ok(null);
      });

      renderWithQuery(<SessionPanel anchor={{ kind: 'workspace', workspaceId: 'w1' }} sessionId="sess-1" />);
      const toggle = await screen.findByTestId('session-browser-toggle');
      await user.click(toggle);

      expect(toggle).toBeDisabled();
      resolveEnable();
      await waitFor(() => expect(toggle).not.toBeDisabled());
    });

    it('clicking the toggle again calls browser.disable and forgets the tab', async () => {
      const user = userEvent.setup();
      call.mockImplementation(async (method: string) => {
        if (method === 'session.status') {
          return ok({
            sessionId: 'sess-1', anchor: { kind: 'workspace', workspaceId: 'w1' }, cwd: '/repos/ws',
            label: 'W', status: 'running', outputBuffer: '', browserEnabled: true,
          });
        }
        return ok(null);
      });

      renderWithQuery(<SessionPanel anchor={{ kind: 'workspace', workspaceId: 'w1' }} sessionId="sess-1" />);
      const toggle = await screen.findByTestId('session-browser-toggle');
      await waitFor(() => expect(getBrowserTabsSnapshot().tabs).toHaveLength(1));

      await user.click(toggle);

      await waitFor(() => expect(call).toHaveBeenCalledWith('browser.disable', { sessionId: 'sess-1' }));
      expect(getBrowserTabsSnapshot().tabs).toEqual([]);
    });

    it('a session attached with the browser already enabled registers its tab without stealing focus or opening the panel', async () => {
      call.mockImplementation(async (method: string) => {
        if (method === 'session.status') {
          return ok({
            sessionId: 'sess-1', anchor: { kind: 'workspace', workspaceId: 'w1' }, cwd: '/repos/ws',
            label: 'W', status: 'running', outputBuffer: '', browserEnabled: true,
          });
        }
        return ok(null);
      });

      renderWithQuery(<SessionPanel anchor={{ kind: 'workspace', workspaceId: 'w1' }} sessionId="sess-1" />);

      await waitFor(() =>
        expect(getBrowserTabsSnapshot().tabs).toEqual([{ tabId: 'sess-1', sessionId: 'sess-1', url: '' }]),
      );
      expect(await screen.findByTestId('session-browser-toggle')).toHaveAttribute(
        'aria-label',
        'Desativar navegador da sessão',
      );
    });

    it('reflects a browser tab closed elsewhere (its own Workbench tab’s close button) back onto the toggle', async () => {
      call.mockImplementation(async (method: string) => {
        if (method === 'session.status') {
          return ok({
            sessionId: 'sess-1', anchor: { kind: 'workspace', workspaceId: 'w1' }, cwd: '/repos/ws',
            label: 'W', status: 'running', outputBuffer: '', browserEnabled: true,
          });
        }
        return ok(null);
      });

      renderWithQuery(<SessionPanel anchor={{ kind: 'workspace', workspaceId: 'w1' }} sessionId="sess-1" />);
      const toggle = await screen.findByTestId('session-browser-toggle');
      await waitFor(() => expect(toggle).toHaveAttribute('aria-label', 'Desativar navegador da sessão'));

      await closeBrowserTab('sess-1');

      await waitFor(() => expect(toggle).toHaveAttribute('aria-label', 'Ativar navegador da sessão'));
    });
  });

  describe('attachments', () => {
    /** Spawns a running session and hands back the terminal container drop/paste target. */
    async function openRunningSession(): Promise<HTMLElement> {
      const user = userEvent.setup();
      call.mockImplementation(async (method: string) => {
        if (method === 'session.status') return ok(null);
        return ok({
          sessionId: 'entity:urn:skill:foo',
          anchor: { kind: 'entity', urn: 'urn:skill:foo' },
          cwd: '/workspace',
          status: 'running',
        });
      });
      renderWithQuery(<SessionPanel anchor={{ kind: 'entity', urn: 'urn:skill:foo' }} />);
      await user.click(screen.getByTestId('session-open'));
      await waitFor(() => expect(call).toHaveBeenCalledWith('session.spawn', expect.anything()));
      call.mockClear();
      return screen.getByTestId('session-terminal');
    }

    it('dropping a file writes an @path reference for its real filesystem path', async () => {
      const terminal = await openRunningSession();
      vi.mocked(window.api.getPathForFile).mockReturnValue('/Users/dev/notes.txt');
      const file = { name: 'notes.txt', type: 'text/plain', size: 10 };

      fireEvent.drop(terminal, { dataTransfer: { files: [file] } });

      await waitFor(() =>
        expect(call).toHaveBeenCalledWith('session.write', {
          sessionId: 'entity:urn:skill:foo',
          data: '@/Users/dev/notes.txt ',
        }),
      );
    });

    it('dropping multiple files writes one @path reference per file, space-separated', async () => {
      const terminal = await openRunningSession();
      vi.mocked(window.api.getPathForFile).mockImplementation((file: File) => `/Users/dev/${file.name}`);
      const files = [
        { name: 'a.txt', type: 'text/plain', size: 1 },
        { name: 'b.txt', type: 'text/plain', size: 1 },
      ];

      fireEvent.drop(terminal, { dataTransfer: { files } });

      await waitFor(() =>
        expect(call).toHaveBeenCalledWith('session.write', {
          sessionId: 'entity:urn:skill:foo',
          data: '@/Users/dev/a.txt @/Users/dev/b.txt ',
        }),
      );
    });

    it('dropping an oversized image shows an error toast instead of referencing it', async () => {
      const terminal = await openRunningSession();
      const file = { name: 'huge.png', type: 'image/png', size: 6 * 1024 * 1024 };

      fireEvent.drop(terminal, { dataTransfer: { files: [file] } });

      expect(await screen.findByTestId('toast')).toHaveTextContent('5MB');
      expect(call).not.toHaveBeenCalledWith('session.write', expect.anything());
    });

    it('dropping an unsupported image type shows an error toast', async () => {
      const terminal = await openRunningSession();
      const file = { name: 'shot.bmp', type: 'image/bmp', size: 100 };

      fireEvent.drop(terminal, { dataTransfer: { files: [file] } });

      expect(await screen.findByTestId('toast')).toHaveTextContent('image/bmp');
      expect(call).not.toHaveBeenCalledWith('session.write', expect.anything());
    });

    it('escapes a space in a dropped file path so it cannot be misread as the end of the reference', async () => {
      const terminal = await openRunningSession();
      vi.mocked(window.api.getPathForFile).mockReturnValue('/Users/dev/Desktop/Screenshot 2026-09-19 at 12.00.00.png');
      const file = { name: 'Screenshot 2026-09-19 at 12.00.00.png', type: 'image/png', size: 100 };

      fireEvent.drop(terminal, { dataTransfer: { files: [file] } });

      await waitFor(() =>
        expect(call).toHaveBeenCalledWith('session.write', {
          sessionId: 'entity:urn:skill:foo',
          data: '@/Users/dev/Desktop/Screenshot\\ 2026-09-19\\ at\\ 12.00.00.png ',
        }),
      );
    });

    it('rejects a dropped file whose resolved path contains a control character, instead of writing it to the PTY', async () => {
      const terminal = await openRunningSession();
      vi.mocked(window.api.getPathForFile).mockReturnValue('/Users/dev/notes.txt\rmalicious command');
      const file = { name: 'notes.txt', type: 'text/plain', size: 10 };

      fireEvent.drop(terminal, { dataTransfer: { files: [file] } });

      expect(await screen.findByTestId('toast')).toHaveTextContent('Nome de arquivo inválido');
      expect(call).not.toHaveBeenCalledWith('session.write', expect.anything());
    });

    it('shows an error and skips a file whose path cannot be resolved, without crashing the rest of the drop', async () => {
      const terminal = await openRunningSession();
      vi.mocked(window.api.getPathForFile).mockImplementation((file: File) => {
        if (file.name === 'bad.txt') throw new Error('not backed by a real file');
        return `/Users/dev/${file.name}`;
      });
      const files = [
        { name: 'bad.txt', type: 'text/plain', size: 1 },
        { name: 'good.txt', type: 'text/plain', size: 1 },
      ];

      fireEvent.drop(terminal, { dataTransfer: { files } });

      expect(await screen.findByTestId('toast')).toHaveTextContent('bad.txt');
      await waitFor(() =>
        expect(call).toHaveBeenCalledWith('session.write', {
          sessionId: 'entity:urn:skill:foo',
          data: '@/Users/dev/good.txt ',
        }),
      );
    });

    it('shows an error instead of writing a bare "@" when the resolved path is empty', async () => {
      const terminal = await openRunningSession();
      vi.mocked(window.api.getPathForFile).mockReturnValue('');
      const file = { name: 'ghost.txt', type: 'text/plain', size: 1 };

      fireEvent.drop(terminal, { dataTransfer: { files: [file] } });

      expect(await screen.findByTestId('toast')).toHaveTextContent('Nome de arquivo inválido');
      expect(call).not.toHaveBeenCalledWith('session.write', expect.anything());
    });

    it('drops on a never-opened session without writing anything', async () => {
      renderWithQuery(<SessionPanel anchor={{ kind: 'entity', urn: 'urn:skill:foo' }} />);
      const terminal = screen.getByTestId('session-terminal');
      const file = { name: 'notes.txt', type: 'text/plain', size: 10 };

      fireEvent.drop(terminal, { dataTransfer: { files: [file] } });

      expect(call).not.toHaveBeenCalledWith('session.write', expect.anything());
    });

    it('pasting an image from the clipboard stages it and writes an @path reference to the staged file', async () => {
      const terminal = await openRunningSession();
      call.mockImplementation(async (method: string) => {
        if (method === 'session.stageAttachment') {
          return ok({ absolutePath: '/workspace/.ai-companion/attachments/1-abcd-screenshot.png' });
        }
        return ok(undefined);
      });
      const file = new File([new Uint8Array([1, 2, 3])], 'screenshot.png', { type: 'image/png' });
      const item = { type: 'image/png', getAsFile: () => file };

      fireEvent.paste(terminal, { clipboardData: { items: [item] } });

      await waitFor(() =>
        expect(call).toHaveBeenCalledWith('session.stageAttachment', {
          fileName: 'screenshot.png',
          dataBase64: expect.any(String),
        }),
      );
      await waitFor(() =>
        expect(call).toHaveBeenCalledWith('session.write', {
          sessionId: 'entity:urn:skill:foo',
          data: '@/workspace/.ai-companion/attachments/1-abcd-screenshot.png ',
        }),
      );
    });

    it('pasting an oversized image shows an error toast and never calls stageAttachment', async () => {
      const terminal = await openRunningSession();
      const file = new File([new Uint8Array(6 * 1024 * 1024)], 'huge.png', { type: 'image/png' });
      const item = { type: 'image/png', getAsFile: () => file };

      fireEvent.paste(terminal, { clipboardData: { items: [item] } });

      expect(await screen.findByTestId('toast')).toHaveTextContent('5MB');
      expect(call).not.toHaveBeenCalledWith('session.stageAttachment', expect.anything());
    });

    it('pasting plain text (no image item on the clipboard) never touches session.stageAttachment or session.write', async () => {
      const terminal = await openRunningSession();
      const item = { type: 'text/plain', getAsFile: () => null };

      fireEvent.paste(terminal, { clipboardData: { items: [item] } });

      expect(call).not.toHaveBeenCalledWith('session.stageAttachment', expect.anything());
      expect(call).not.toHaveBeenCalledWith('session.write', expect.anything());
    });

    it('leaves a clipboard carrying both text and an image to xterm untouched, so the text is not silently dropped', async () => {
      const terminal = await openRunningSession();
      const textItem = { type: 'text/plain', getAsFile: () => null };
      const imageItem = { type: 'image/png', getAsFile: () => new File([new Uint8Array([1])], 'shot.png', { type: 'image/png' }) };

      fireEvent.paste(terminal, { clipboardData: { items: [textItem, imageItem] } });

      expect(call).not.toHaveBeenCalledWith('session.stageAttachment', expect.anything());
      expect(call).not.toHaveBeenCalledWith('session.write', expect.anything());
    });
  });
});
