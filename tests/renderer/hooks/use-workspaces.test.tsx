import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '../../../src/renderer/lib/query-client.js';
import * as ipc from '../../../src/renderer/lib/ipc.js';
import {
  useWorkspaces,
  useActiveWorkspace,
  useCreateWorkspace,
  useSwitchWorkspace,
  useDeleteWorkspace,
} from '../../../src/renderer/hooks/use-workspaces.js';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

const workspace = (id = 'w1') => ({ id, name: 'Acme', rootPath: '/repos/acme', isDefault: false, createdAt: '' });

beforeEach(() => {
  queryClient.clear();
  vi.restoreAllMocks();
});

describe('use-workspaces', () => {
  it('useWorkspaces fetches via workspace.list', async () => {
    vi.spyOn(ipc, 'callIpc').mockResolvedValue([workspace()]);
    const { result } = renderHook(() => useWorkspaces(), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual([workspace()]));
    expect(ipc.callIpc).toHaveBeenCalledWith('workspace.list', {});
  });

  it('useActiveWorkspace fetches via workspace.getActive', async () => {
    vi.spyOn(ipc, 'callIpc').mockResolvedValue(workspace('default'));
    const { result } = renderHook(() => useActiveWorkspace(), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual(workspace('default')));
    expect(ipc.callIpc).toHaveBeenCalledWith('workspace.getActive', {});
  });

  it('useCreateWorkspace calls workspace.create and invalidates the list', async () => {
    const spy = vi.spyOn(ipc, 'callIpc').mockResolvedValue(workspace());
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useCreateWorkspace(), { wrapper });
    await result.current.mutateAsync({ name: 'Acme', rootPath: '/repos/acme' });
    expect(spy).toHaveBeenCalledWith('workspace.create', { name: 'Acme', rootPath: '/repos/acme' });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['workspace', 'list'] });
  });

  it('useSwitchWorkspace calls workspace.switchTo and invalidates every cached query', async () => {
    const spy = vi.spyOn(ipc, 'callIpc').mockResolvedValue(workspace());
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useSwitchWorkspace(), { wrapper });
    await result.current.mutateAsync('w1');
    expect(spy).toHaveBeenCalledWith('workspace.switchTo', { id: 'w1' });
    expect(invalidateSpy).toHaveBeenCalledWith();
  });

  it('a mounted useActiveWorkspace query refetches on its own after switching, with no remount needed', async () => {
    let current = workspace('default');
    vi.spyOn(ipc, 'callIpc').mockImplementation(async (method: string) => {
      if (method === 'workspace.getActive') return current;
      if (method === 'workspace.switchTo') {
        current = workspace('w1');
        return current;
      }
      return undefined;
    });
    const { result: activeResult } = renderHook(() => useActiveWorkspace(), { wrapper });
    await waitFor(() => expect(activeResult.current.data?.id).toBe('default'));

    const { result: switchResult } = renderHook(() => useSwitchWorkspace(), { wrapper });
    await switchResult.current.mutateAsync('w1');

    await waitFor(() => expect(activeResult.current.data?.id).toBe('w1'));
  });

  it('useDeleteWorkspace calls workspace.delete and invalidates the list', async () => {
    const spy = vi.spyOn(ipc, 'callIpc').mockResolvedValue(undefined);
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useDeleteWorkspace(), { wrapper });
    await result.current.mutateAsync('w1');
    expect(spy).toHaveBeenCalledWith('workspace.delete', { id: 'w1' });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['workspace', 'list'] });
  });
});
