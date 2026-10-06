import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { mockApi, ok, makeTestQueryClient, type CallSpy } from '../test-utils.js';
import { resetLaunchProcessesForTests } from '../../../src/renderer/lib/launch-process-store.js';
import {
  useRunLaunchConfig,
  useKillLaunchProcess,
  useLaunchProcesses,
  useLaunchProcessOutput,
} from '../../../src/renderer/hooks/use-launch-process.js';

const wrapper = ({ children }: { children: React.ReactNode }) => {
  const client = makeTestQueryClient();
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

let call: CallSpy;
beforeEach(() => {
  call = mockApi();
});

afterEach(() => {
  resetLaunchProcessesForTests();
});

describe('useRunLaunchConfig', () => {
  it('calls launchConfig.run and records the result in the launch-process store', async () => {
    call.mockImplementation(async (method: string) =>
      method === 'launchConfig.run' ? ok({ processId: 'x', projectId: 'p1', configName: 'Run', status: 'running', exitCode: null }) : ok(undefined),
    );
    const { result } = renderHook(() => useRunLaunchConfig(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ projectId: 'p1', configName: 'Run' });
    });
    expect(call).toHaveBeenCalledWith('launchConfig.run', { projectId: 'p1', configName: 'Run' });
  });
});

describe('useKillLaunchProcess', () => {
  it('calls launchConfig.kill with the processId', async () => {
    call.mockImplementation(async () => ok(undefined));
    const { result } = renderHook(() => useKillLaunchProcess(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync('proc-1');
    });
    expect(call).toHaveBeenCalledWith('launchConfig.kill', { processId: 'proc-1' });
  });
});

describe('useLaunchProcesses', () => {
  it('reflects the store and updates when the exit push channel fires', async () => {
    const { result: runResult } = renderHook(() => useRunLaunchConfig(), { wrapper });
    call.mockImplementation(async (method: string) =>
      method === 'launchConfig.run' ? ok({ processId: 'proc-1', projectId: 'p1', configName: 'Run', status: 'running', exitCode: null }) : ok(undefined),
    );
    await act(async () => {
      await runResult.current.mutateAsync({ projectId: 'p1', configName: 'Run' });
    });

    const { result } = renderHook(() => useLaunchProcesses(), { wrapper });
    expect(result.current).toEqual([{ processId: 'proc-1', projectId: 'p1', configName: 'Run', status: 'running', exitCode: null }]);

    const onAnyExitListener = vi.mocked(window.api.launchConfig.onAnyExit).mock.calls[0]![0];
    act(() => onAnyExitListener('proc-1', 0, null));
    await waitFor(() => expect(result.current[0]?.status).toBe('exited'));
  });
});

describe('useLaunchProcessOutput', () => {
  it('replays the captured buffer, then appends streamed output', async () => {
    call.mockImplementation(async (method: string) =>
      method === 'launchConfig.status'
        ? ok({ processId: 'proc-1', projectId: 'p1', configName: 'Run', status: 'running', exitCode: null, outputBuffer: 'hello\n' })
        : ok(undefined),
    );
    const { result } = renderHook(() => useLaunchProcessOutput('proc-1'), { wrapper });
    await waitFor(() => expect(result.current.lines).toEqual([{ stream: 'stdout', chunk: 'hello\n' }]));
    expect(result.current.status).toBe('running');

    const onOutputListener = vi.mocked(window.api.launchConfig.onOutput).mock.calls[0]![1];
    act(() => onOutputListener('stderr', 'more'));
    await waitFor(() =>
      expect(result.current.lines).toEqual([
        { stream: 'stdout', chunk: 'hello\n' },
        { stream: 'stderr', chunk: 'more' },
      ]),
    );
  });

  it('marks the process exited once its own exit push channel fires', async () => {
    call.mockImplementation(async (method: string) =>
      method === 'launchConfig.status'
        ? ok({ processId: 'proc-1', projectId: 'p1', configName: 'Run', status: 'running', exitCode: null, outputBuffer: '' })
        : ok(undefined),
    );
    const { result } = renderHook(() => useLaunchProcessOutput('proc-1'), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('running'));

    const onExitListener = vi.mocked(window.api.launchConfig.onExit).mock.calls[0]![1];
    act(() => onExitListener(0, null));
    await waitFor(() => expect(result.current.status).toBe('exited'));
  });
});
