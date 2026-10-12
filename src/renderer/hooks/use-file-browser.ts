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

export function useDirListing(path: string, options: { enabled?: boolean } = {}) {
  const { enabled = true } = options;
  return useQuery<FileBrowserEntry[]>({
    queryKey: ['workspace', 'listDir', path] as const,
    queryFn: () => callIpc<FileBrowserEntry[]>('workspace.listDir', { path }),
    enabled,
    ...DISK_BACKED_QUERY_OPTIONS,
  });
}

export function useFilePreview(path: string | null) {
  return useQuery<FilePreview>({
    queryKey: ['workspace', 'readFile', path] as const,
    queryFn: () => callIpc<FilePreview>('workspace.readFile', { path }),
    enabled: path !== null,
    ...DISK_BACKED_QUERY_OPTIONS,
  });
}

/**
 * Re-reads every file-browser query — directory listings and file contents —
 * so the Explorer tree and any open editor tab pick up work done outside the
 * app. The keys are one segment short of the ones `useDirListing`/
 * `useFilePreview` build — react-query matches by prefix, so each covers every
 * path under it.
 */
const FILE_BROWSER_QUERY_PREFIXES = [
  ['workspace', 'listDir'],
  ['workspace', 'readFile'],
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
    mutationFn: (args: { path: string; content: string }): Promise<void> =>
      callIpc<void>('workspace.writeFile', { path: args.path, content: args.content }),
    onSuccess: (_data, { path, content }) => {
      queryClient.setQueryData<FilePreview>(['workspace', 'readFile', path] as const, { previewable: true, kind: 'text', content, truncated: false });
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
