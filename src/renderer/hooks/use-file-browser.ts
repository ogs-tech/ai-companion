import { useMutation, useQuery } from '@tanstack/react-query';
import { callIpc } from '../lib/ipc.js';
import type { FileBrowserEntry, FilePreview } from '../../shared/file-browser.js';

export function useDirListing(path: string, options: { enabled?: boolean } = {}) {
  return useQuery<FileBrowserEntry[]>({
    queryKey: ['workspace', 'listDir', path] as const,
    queryFn: () => callIpc<FileBrowserEntry[]>('workspace.listDir', { path }),
    enabled: options.enabled ?? true,
  });
}

export function useFilePreview(path: string | null) {
  return useQuery<FilePreview>({
    queryKey: ['workspace', 'readFile', path] as const,
    queryFn: () => callIpc<FilePreview>('workspace.readFile', { path }),
    enabled: path !== null,
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
