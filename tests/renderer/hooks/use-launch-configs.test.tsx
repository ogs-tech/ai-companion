import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { mockApi, ok, makeTestQueryClient, type CallSpy } from '../test-utils.js';
import { useLaunchConfigs, useProjectLaunchConfigs } from '../../../src/renderer/hooks/use-launch-configs.js';
import type { ProjectLaunchConfigs } from '../../../src/shared/launch-config.js';

const wrapper = ({ children }: { children: React.ReactNode }) => {
  const client = makeTestQueryClient();
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

let call: CallSpy;
beforeEach(() => {
  call = mockApi();
});

describe('useLaunchConfigs', () => {
  it("lists every project's launch configs", async () => {
    const entries: ProjectLaunchConfigs[] = [{ projectId: 'p1', configs: [] }];
    call.mockImplementation(async (method: string) => (method === 'launchConfig.list' ? ok(entries) : ok(undefined)));
    const { result } = renderHook(() => useLaunchConfigs(), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual(entries));
  });
});

describe('useProjectLaunchConfigs', () => {
  it("returns the matching project's entry", async () => {
    const entries: ProjectLaunchConfigs[] = [
      { projectId: 'p1', configs: [] },
      { projectId: 'p2', configs: [{ name: 'Run', type: 'node', request: 'launch', program: 'index.js', args: [], supported: true }] },
    ];
    call.mockImplementation(async (method: string) => (method === 'launchConfig.list' ? ok(entries) : ok(undefined)));
    const { result } = renderHook(() => useProjectLaunchConfigs('p2'), { wrapper });
    await waitFor(() => expect(result.current).toEqual(entries[1]));
  });

  it('returns undefined for a project with no entry yet', async () => {
    call.mockImplementation(async (method: string) => (method === 'launchConfig.list' ? ok([]) : ok(undefined)));
    const { result } = renderHook(() => useProjectLaunchConfigs('missing'), { wrapper });
    await waitFor(() => expect(call).toHaveBeenCalledWith('launchConfig.list', {}));
    expect(result.current).toBeUndefined();
  });
});
