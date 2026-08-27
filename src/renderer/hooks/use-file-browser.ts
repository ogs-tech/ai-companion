import { useMutation, useQuery } from '@tanstack/react-query';
import { callIpc } from '../lib/ipc.js';
import type { FileBrowserEntry, FilePreview } from '../../shared/file-browser.js';

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
