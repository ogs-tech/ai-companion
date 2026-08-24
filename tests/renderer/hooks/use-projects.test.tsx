import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '../../../src/renderer/lib/query-client.js';
import * as ipc from '../../../src/renderer/lib/ipc.js';
import { useProjects, useFindOrCreateProjectByPath, useDeleteProject } from '../../../src/renderer/hooks/use-projects.js';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

const project = (id = 'p1') => ({ id, name: 'acme', path: '/repos/acme', createdAt: '' });

beforeEach(() => {
  queryClient.clear();
  vi.restoreAllMocks();
});

describe('use-projects', () => {
  it('useProjects fetches via project.list', async () => {
    vi.spyOn(ipc, 'callIpc').mockResolvedValue([project()]);
    const { result } = renderHook(() => useProjects(), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual([project()]));
    expect(ipc.callIpc).toHaveBeenCalledWith('project.list', {});
  });

  it('useFindOrCreateProjectByPath calls project.findOrCreateByPath and invalidates the list', async () => {
    const spy = vi.spyOn(ipc, 'callIpc').mockResolvedValue(project());
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useFindOrCreateProjectByPath(), { wrapper });
    await result.current.mutateAsync('/repos/acme');
    expect(spy).toHaveBeenCalledWith('project.findOrCreateByPath', { path: '/repos/acme' });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['project', 'list'] });
  });

  it('useDeleteProject calls project.delete and invalidates the list', async () => {
    const spy = vi.spyOn(ipc, 'callIpc').mockResolvedValue(undefined);
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useDeleteProject(), { wrapper });
    await result.current.mutateAsync('p1');
    expect(spy).toHaveBeenCalledWith('project.delete', { id: 'p1' });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['project', 'list'] });
  });
});
