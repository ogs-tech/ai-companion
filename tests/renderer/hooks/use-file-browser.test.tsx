import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider, focusManager } from '@tanstack/react-query';
import { queryClient } from '../../../src/renderer/lib/query-client.js';
import * as ipc from '../../../src/renderer/lib/ipc.js';
import { useDirListing, useFilePreview, useRefreshFiles, useResolveAbsolutePath, useWriteFile } from '../../../src/renderer/hooks/use-file-browser.js';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

beforeEach(() => {
  queryClient.clear();
  vi.restoreAllMocks();
});

describe('use-file-browser', () => {
  it('useDirListing fetches via workspace.listDir with the given path', async () => {
    vi.spyOn(ipc, 'callIpc').mockResolvedValue([{ name: 'a.txt', kind: 'file' }]);
    const { result } = renderHook(() => useDirListing('sub'), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual([{ name: 'a.txt', kind: 'file' }]));
    expect(ipc.callIpc).toHaveBeenCalledWith('workspace.listDir', { path: 'sub' });
  });

  it('useDirListing does not fetch when enabled:false', () => {
    const spy = vi.spyOn(ipc, 'callIpc');
    const { result } = renderHook(() => useDirListing('sub', { enabled: false }), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(spy).not.toHaveBeenCalled();
  });

  it('useFilePreview is disabled when path is null', () => {
    const spy = vi.spyOn(ipc, 'callIpc');
    const { result } = renderHook(() => useFilePreview(null), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(spy).not.toHaveBeenCalled();
  });

  it('useFilePreview fetches via workspace.readFile when path is set', async () => {
    vi.spyOn(ipc, 'callIpc').mockResolvedValue({ previewable: true, kind: 'text', content: 'hi', truncated: false });
    const { result } = renderHook(() => useFilePreview('a.txt'), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual({ previewable: true, kind: 'text', content: 'hi', truncated: false }));
    expect(ipc.callIpc).toHaveBeenCalledWith('workspace.readFile', { path: 'a.txt' });
  });

  it('useResolveAbsolutePath calls workspace.resolvePath', async () => {
    const spy = vi.spyOn(ipc, 'callIpc').mockResolvedValue({ absolutePath: '/repos/acme/sub' });
    const { result } = renderHook(() => useResolveAbsolutePath(), { wrapper });
    const res = await result.current.mutateAsync('sub');
    expect(spy).toHaveBeenCalledWith('workspace.resolvePath', { path: 'sub' });
    expect(res).toBe('/repos/acme/sub');
  });

  it('useDirListing fetches via project.listDir when scoped to a projectId', async () => {
    vi.spyOn(ipc, 'callIpc').mockResolvedValue([{ name: 'a.txt', kind: 'file' }]);
    const { result } = renderHook(() => useDirListing('sub', { projectId: 'p1' }), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual([{ name: 'a.txt', kind: 'file' }]));
    expect(ipc.callIpc).toHaveBeenCalledWith('project.listDir', { projectId: 'p1', path: 'sub' });
  });

  it('useFilePreview fetches via project.readFile when scoped to a projectId', async () => {
    vi.spyOn(ipc, 'callIpc').mockResolvedValue({ previewable: true, kind: 'text', content: 'hi', truncated: false });
    const { result } = renderHook(() => useFilePreview('a.txt', { projectId: 'p1' }), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual({ previewable: true, kind: 'text', content: 'hi', truncated: false }));
    expect(ipc.callIpc).toHaveBeenCalledWith('project.readFile', { projectId: 'p1', path: 'a.txt' });
  });

  it('useWriteFile calls workspace.writeFile when no projectId is given', async () => {
    const spy = vi.spyOn(ipc, 'callIpc').mockResolvedValue(undefined);
    const { result } = renderHook(() => useWriteFile(), { wrapper });
    await result.current.mutateAsync({ path: 'a.txt', content: 'new content' });
    expect(spy).toHaveBeenCalledWith('workspace.writeFile', { path: 'a.txt', content: 'new content' });
  });

  it('useWriteFile calls project.writeFile when scoped to a projectId', async () => {
    const spy = vi.spyOn(ipc, 'callIpc').mockResolvedValue(undefined);
    const { result } = renderHook(() => useWriteFile(), { wrapper });
    await result.current.mutateAsync({ path: 'a.txt', content: 'new content', projectId: 'p1' });
    expect(spy).toHaveBeenCalledWith('project.writeFile', { projectId: 'p1', path: 'a.txt', content: 'new content' });
  });

  it('useWriteFile updates the matching readFile query cache on success', async () => {
    vi.spyOn(ipc, 'callIpc').mockResolvedValue(undefined);
    const { result: writeResult } = renderHook(() => useWriteFile(), { wrapper });
    await writeResult.current.mutateAsync({ path: 'a.txt', content: 'new content' });

    const { result: previewResult } = renderHook(() => useFilePreview('a.txt'), { wrapper });
    await waitFor(() => expect(previewResult.current.data).toEqual({ previewable: true, kind: 'text', content: 'new content', truncated: false }));
  });
});

describe('use-file-browser — staying in step with the disk', () => {
  afterEach(() => {
    // Hand focus tracking back to the real listener for the next test file.
    focusManager.setFocused(undefined);
  });

  it('re-reads a listing when the window regains focus, despite the app-wide default being off', async () => {
    const spy = vi.spyOn(ipc, 'callIpc').mockResolvedValue([]);
    const { result } = renderHook(() => useDirListing('sub'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(spy).toHaveBeenCalledTimes(1);

    act(() => focusManager.setFocused(false));
    act(() => focusManager.setFocused(true));

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
  });

  it('useRefreshFiles re-reads a cached workspace listing', async () => {
    const spy = vi.spyOn(ipc, 'callIpc').mockResolvedValue([]);
    const { result } = renderHook(
      () => ({ listing: useDirListing('sub'), refresh: useRefreshFiles() }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.listing.isSuccess).toBe(true));
    expect(spy).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.refresh();
    });

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
  });

  it('useRefreshFiles covers both scopes, since the tree mixes them', async () => {
    const spy = vi.spyOn(ipc, 'callIpc').mockResolvedValue([]);
    const { result } = renderHook(
      () => ({
        workspaceListing: useDirListing('sub'),
        projectListing: useDirListing('sub', { projectId: 'p1' }),
        refresh: useRefreshFiles(),
      }),
      { wrapper },
    );
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));

    await act(async () => {
      await result.current.refresh();
    });

    const callsTo = (method: string): number =>
      spy.mock.calls.filter(([m]) => m === method).length;
    await waitFor(() => expect(callsTo('project.listDir')).toBe(2));
    expect(callsTo('workspace.listDir')).toBe(2);
  });

  it('useRefreshFiles re-reads open file contents too, not just listings', async () => {
    const spy = vi.spyOn(ipc, 'callIpc').mockResolvedValue({
      previewable: true, kind: 'text', content: 'body', truncated: false,
    });
    const { result } = renderHook(
      () => ({ preview: useFilePreview('notes.md'), refresh: useRefreshFiles() }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.preview.isSuccess).toBe(true));
    expect(spy).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.refresh();
    });

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
  });
});
