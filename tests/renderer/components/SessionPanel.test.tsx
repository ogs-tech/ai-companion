import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SessionPanel } from '../../../src/renderer/components/SessionPanel.js';
import { mockApi, ok, renderWithTheme, type CallSpy } from '../test-utils.js';

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

beforeEach(() => {
  mockTerminalInstances.length = 0;
  call = mockApi();
});

describe('SessionPanel', () => {
  it('calls session.spawn with the given anchor when opened', async () => {
    const user = userEvent.setup();
    call.mockResolvedValue(ok({ sessionId: 'workspace:w1', anchor: { kind: 'workspace', workspaceId: 'w1' }, cwd: '/repos/ws', status: 'running' }));
    renderWithTheme(<SessionPanel anchor={{ kind: 'workspace', workspaceId: 'w1' }} />);
    await user.click(screen.getByTestId('session-open'));
    await waitFor(() =>
      expect(call).toHaveBeenCalledWith('session.spawn', { anchor: { kind: 'workspace', workspaceId: 'w1' } }),
    );
  });
});
