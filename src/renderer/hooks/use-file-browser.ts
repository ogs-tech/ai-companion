import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { callIpc } from '../lib/ipc.js';
import type { FileBrowserEntry, FilePreview } from '../../shared/file-browser.js';

/**
 * The file browser reads straight through to disk — `FileBrowserService` holds
 * no cache of its own, so every `listDir`/`readFile` is a fresh `fs` call — and
 * an embedded `claude` session can rewrite that disk at any moment. These two
 * queries therefore opt out of the app-wide 30s `staleTime` and do refetch on
 * window focus, so coming back to the app shows what is actually on disk rather
 * than a snapshot from before the session ran. A refetch costs one local
 * readdir/readFile, not a network round trip.
 */
const DISK_BACKED_QUERY_OPTIONS = {
  staleTime: 0,
  refetchOnWindowFocus: true,
} as const;

export function useDirListing(path: string, options: { enabled?: boolean; projectId?: string } = {}) {
  const { enabled = true, projectId } = options;
  return useQuery<FileBrowserEntry[]>({
    queryKey: projectId
      ? (['project', 'listDir', projectId, path] as const)
      : (['workspace', 'listDir', path] as const),
    queryFn: () =>
      projectId
        ? callIpc<FileBrowserEntry[]>('project.listDir', { projectId, path })
        : callIpc<FileBrowserEntry[]>('workspace.listDir', { path }),
    enabled,
    ...DISK_BACKED_QUERY_OPTIONS,
  });
}

export function useFilePreview(path: string | null, options: { projectId?: string } = {}) {
  const { projectId } = options;
  return useQuery<FilePreview>({
    queryKey: projectId
      ? (['project', 'readFile', projectId, path] as const)
      : (['workspace', 'readFile', path] as const),
    queryFn: () =>
      projectId
        ? callIpc<FilePreview>('project.readFile', { projectId, path })
        : callIpc<FilePreview>('workspace.readFile', { path }),
    enabled: path !== null,
    ...DISK_BACKED_QUERY_OPTIONS,
  });
}

/**
 * Re-reads every file-browser query — directory listings and file contents, in
 * both the workspace and project scopes — so the Explorer tree and any open
 * editor tab pick up work done outside the app. Deliberately unscoped: the tree
 * mixes the two (a registered Project folder expands in place inside the
 * workspace listing), so refreshing one scope would leave the other stale. The
 * keys are one segment short of the ones `useDirListing`/`useFilePreview` build
 * — react-query matches by prefix, so each covers every path under it.
 */
const FILE_BROWSER_QUERY_PREFIXES = [
  ['workspace', 'listDir'],
  ['workspace', 'readFile'],
  ['project', 'listDir'],
  ['project', 'readFile'],
] as const;

export function useRefreshFiles(): () => Promise<void> {
  const queryClient = useQueryClient();
  return useCallback(async () => {
    await Promise.all(
      FILE_BROWSER_QUERY_PREFIXES.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
    );
  }, [queryClient]);
}

/** Overwrites an existing file in place; updates the matching `useFilePreview` query cache in place so the tab's next read reflects the save without a round trip. */
export function useWriteFile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: { path: string; content: string; projectId?: string }): Promise<void> => {
      const { path, content, projectId } = args;
      if (projectId) return callIpc<void>('project.writeFile', { projectId, path, content });
      return callIpc<void>('workspace.writeFile', { path, content });
    },
    onSuccess: (_data, { path, content, projectId }) => {
      const key = projectId ? (['project', 'readFile', projectId, path] as const) : (['workspace', 'readFile', path] as const);
      queryClient.setQueryData<FilePreview>(key, { previewable: true, kind: 'text', content, truncated: false });
    },
  });
}

export function useResolveAbsolutePath() {
  return useMutation({
    mutationFn: async (path: string): Promise<string> => {
      const { absolutePath } = await callIpc<{ absolutePath: string }>('workspace.resolvePath', { path });
      return absolutePath;
    },
  });
}
