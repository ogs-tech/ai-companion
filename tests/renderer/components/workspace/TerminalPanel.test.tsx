import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { TerminalPanel } from '../../../../src/renderer/components/workspace/TerminalPanel.js';
import * as ipc from '../../../../src/renderer/lib/ipc.js';

const xterm = vi.hoisted(() => ({
  instances: [] as Array<{ write: ReturnType<typeof vi.fn>; emitData: (d: string) => void; dispose: ReturnType<typeof vi.fn> }>,
}));

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    write = vi.fn();
    open = vi.fn();
    dispose = vi.fn();
    focus = vi.fn();
    loadAddon = vi.fn();
    registerLinkProvider = vi.fn();
    private dataListener: ((d: string) => void) | null = null;
    onData = vi.fn((listener: (d: string) => void) => {
      this.dataListener = listener;
      return { dispose: vi.fn() };
    });
    emitData = (d: string): void => this.dataListener?.(d);
    constructor() {
      xterm.instances.push(this);
    }
  },
}));
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit = vi.fn();
    proposeDimensions = vi.fn(() => ({ cols: 100, rows: 30 }));
  },
}));
vi.mock('../../../../src/renderer/lib/ipc.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/renderer/lib/ipc.js')>()),
  callIpc: vi.fn(),
}));

type OutputListener = (chunk: string) => void;
let outputListener: OutputListener | null;
const unsubscribe = vi.fn();

beforeEach(() => {
  xterm.instances.length = 0;
  outputListener = null;
  unsubscribe.mockClear();
  (window as unknown as { api: unknown }).api = {
    terminal: {
      onOutput: vi.fn((_id: string, listener: OutputListener) => {
        outputListener = listener;
        return unsubscribe;
      }),
      onExit: vi.fn(() => () => {}),
      onAnyExit: vi.fn(() => () => {}),
    },
  };
  (ipc.callIpc as ReturnType<typeof vi.fn>).mockReset();
  (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string) =>
    method === 'terminal.status' ? { terminalId: 't1', outputBuffer: 'replayed ' } : undefined,
  );
});

describe('TerminalPanel', () => {
  it('replays the scrollback first, then streams live output', async () => {
    render(<TerminalPanel terminalId="t1" />);
    const term = xterm.instances[0]!;
    outputListener?.('dropped-before-replay');
    await waitFor(() => expect(term.write).toHaveBeenCalledWith('replayed '));
    outputListener?.('live');
    expect(term.write.mock.calls.map((c) => c[0])).toEqual(['replayed ', 'live']);
  });

  it('sends keystrokes to the terminal and reports the fitted size', async () => {
    render(<TerminalPanel terminalId="t1" />);
    xterm.instances[0]!.emitData('ls\r');
    expect(ipc.callIpc).toHaveBeenCalledWith('terminal.write', { terminalId: 't1', data: 'ls\r' });
    await waitFor(() => expect(ipc.callIpc).toHaveBeenCalledWith('terminal.resize', { terminalId: 't1', cols: 100, rows: 30 }));
  });

  it('does not resize while hidden', () => {
    render(<TerminalPanel terminalId="t1" visible={false} />);
    expect(ipc.callIpc).not.toHaveBeenCalledWith('terminal.resize', expect.anything());
  });

  it('unmounting disposes the view without touching the process', () => {
    const { unmount } = render(<TerminalPanel terminalId="t1" />);
    unmount();
    expect(xterm.instances[0]!.dispose).toHaveBeenCalled();
    expect(unsubscribe).toHaveBeenCalled();
    expect(ipc.callIpc).not.toHaveBeenCalledWith('terminal.kill', expect.anything());
  });
});
