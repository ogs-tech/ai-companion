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

/** The open workspace — `null` at Início (Global). */
export function useActiveWorkspace() {
  return useQuery<Workspace | null>({
    queryKey: activeKey,
    queryFn: async () => (await callIpc<Workspace | null>('workspace.getActive', {})) ?? null,
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

/**
 * Every query is scoped to the open workspace (skills, agents, folder tree,
 * ...) — after any activation, invalidate everything so mounted screens
 * refresh in place. `clear()` used to be called here, but it destroys queries
 * without telling their still-mounted observers to refetch, leaving stale data
 * on screen until the component happened to remount.
 */
const refreshEverything = (): void => {
  void queryClient.invalidateQueries();
};

export function useSwitchWorkspace() {
  return useMutation({
    mutationFn: (id: string) => callIpc<Workspace>('workspace.switchTo', { id }),
    onSuccess: refreshEverything,
  });
}

/** Opens a folder as a workspace — the existing one for that folder, or a new one. */
export function useOpenWorkspace() {
  return useMutation({
    mutationFn: (path: string) => callIpc<Workspace>('workspace.open', { path }),
    onSuccess: refreshEverything,
  });
}

/** Back to Início (Global): no workspace open. */
export function useGoHome() {
  return useMutation({
    mutationFn: () => callIpc<void>('workspace.goHome', {}),
    onSuccess: refreshEverything,
  });
}

/** Deleting the open workspace goes home first, so this refreshes everything too. */
export function useDeleteWorkspace() {
  return useMutation({
    mutationFn: (id: string) => callIpc<void>('workspace.delete', { id }),
    onSuccess: refreshEverything,
  });
}
