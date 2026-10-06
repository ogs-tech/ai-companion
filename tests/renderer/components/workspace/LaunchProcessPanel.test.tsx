import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { mockApi, ok, renderWithQuery, type CallSpy } from '../../test-utils.js';
import { LaunchProcessPanel } from '../../../../src/renderer/components/workspace/LaunchProcessPanel.js';

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    write = vi.fn();
    open = vi.fn();
    dispose = vi.fn();
    loadAddon = vi.fn();
  },
}));
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit = vi.fn();
  },
}));

let call: CallSpy;
beforeEach(() => {
  call = mockApi();
  call.mockImplementation(async (method: string) =>
    method === 'launchConfig.status'
      ? ok({ processId: 'proc-1', projectId: 'p1', configName: 'Run', status: 'running', exitCode: null, outputBuffer: 'hello\n' })
      : ok(undefined),
  );
});

describe('LaunchProcessPanel', () => {
  it('mounts a terminal container for the given processId and replays its output buffer', async () => {
    renderWithQuery(<LaunchProcessPanel processId="proc-1" />);
    expect(await screen.findByTestId('launch-process-panel-proc-1')).toBeInTheDocument();
    await waitFor(() => expect(call).toHaveBeenCalledWith('launchConfig.status', { processId: 'proc-1' }));
  });
});
