import {
  useMutation, useQuery, useQueryClient,
  type QueryClient, type UseMutationResult, type UseQueryResult,
} from '@tanstack/react-query';
import { callIpc } from '../lib/ipc.js';
import type { PluginListItemIpc } from '../../shared/plugin-ipc-types.js';

export type PluginScope = 'personal' | 'project';

export function pluginsQueryKey(scope: PluginScope): readonly unknown[] {
  return ['plugins', scope] as const;
}

export function usePluginList(scope: PluginScope, enabled = true): UseQueryResult<PluginListItemIpc[]> {
  return useQuery<PluginListItemIpc[]>({
    queryKey: pluginsQueryKey(scope),
    enabled,
    queryFn: async () => {
      const list = await callIpc<PluginListItemIpc[]>('plugin.list', { scope });
      return Array.isArray(list) ? list : [];
    },
  });
}

// A mutation on one scope (e.g. toggling a personal plugin) can't affect
// items in the other scope, but PluginsTreeGroup may have both queries
// mounted at once (local + "Mostrar globais") — invalidate both so neither
// bucket goes stale.
function invalidatePluginLists(qc: QueryClient): Promise<void[]> {
  return Promise.all([
    qc.invalidateQueries({ queryKey: pluginsQueryKey('personal') }),
    qc.invalidateQueries({ queryKey: pluginsQueryKey('project') }),
  ]);
}

export function useTogglePlugin(): UseMutationResult<void, Error, { id: string; scope: PluginScope; enabled: boolean }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars) => callIpc('plugin.toggle', vars),
    onSettled: () => invalidatePluginLists(qc),
  });
}

export function useUpdatePlugin(): UseMutationResult<void, Error, { id: string; scope: PluginScope }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars) => callIpc('plugin.update', vars),
    onSettled: () => invalidatePluginLists(qc),
  });
}

export function useRemovePlugin(): UseMutationResult<void, Error, { id: string; scope: PluginScope }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars) => callIpc('plugin.remove', vars),
    onSettled: () => invalidatePluginLists(qc),
  });
}
