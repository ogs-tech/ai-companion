import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
