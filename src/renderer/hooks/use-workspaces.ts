import { useMutation, useQuery } from '@tanstack/react-query';
import { callIpc } from '../lib/ipc.js';
import { queryClient } from '../lib/query-client.js';
import type { Workspace } from '../../shared/workspace.js';

const listKey = ['workspace', 'list'] as const;
const activeKey = ['workspace', 'active'] as const;

export function useWorkspaces() {
  return useQuery<Workspace[]>({
    queryKey: listKey,
    queryFn: () => callIpc<Workspace[]>('workspace.list', {}),
  });
}

export function useActiveWorkspace() {
  return useQuery<Workspace>({
    queryKey: activeKey,
    queryFn: () => callIpc<Workspace>('workspace.getActive', {}),
  });
}

export function useCreateWorkspace() {
  return useMutation({
    mutationFn: (input: { name: string; rootPath: string }) =>
      callIpc<Workspace>('workspace.create', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: listKey });
    },
  });
}

export function useSwitchWorkspace() {
  return useMutation({
    mutationFn: (id: string) => callIpc<Workspace>('workspace.switchTo', { id }),
    onSuccess: () => {
      queryClient.clear();
    },
  });
}

export function useDeleteWorkspace() {
  return useMutation({
    mutationFn: (id: string) => callIpc<void>('workspace.delete', { id }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: listKey });
    },
  });
}
