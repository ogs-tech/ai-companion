import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { mockApi, ok, makeTestQueryClient, type CallSpy } from '../test-utils.js';
import { useLaunchConfigs } from '../../../src/renderer/hooks/use-launch-configs.js';
import type { WorkspaceLaunchConfigs } from '../../../src/shared/launch-config.js';

const wrapper = ({ children }: { children: React.ReactNode }) => {
  const client = makeTestQueryClient();
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

let call: CallSpy;
beforeEach(() => {
  call = mockApi();
});

describe('useLaunchConfigs', () => {
  it("returns the open workspace's launch configs", async () => {
    const entry: WorkspaceLaunchConfigs = {
      workspaceId: 'w1',
      configs: [{ name: 'Run', type: 'node', request: 'launch', program: 'index.js', args: [], supported: true }],
    };
    call.mockImplementation(async (method: string) => (method === 'launchConfig.list' ? ok(entry) : ok(undefined)));
    const { result } = renderHook(() => useLaunchConfigs(), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual(entry));
  });

  it('returns null at Início', async () => {
    call.mockImplementation(async (method: string) => (method === 'launchConfig.list' ? ok(null) : ok(undefined)));
    const { result } = renderHook(() => useLaunchConfigs(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });
});
