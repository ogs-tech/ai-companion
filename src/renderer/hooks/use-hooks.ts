import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { callIpc } from '../lib/ipc.js';
import type { HookHandler } from '../lib/describe-hook-handler.js';

export interface Hook {
  id: string;
  event: string;
  matcher?: string;
  description?: string;
  handler: HookHandler;
  source: { kind: 'workspace' } | { kind: 'plugin'; pluginId: string };
}

export const hooksQueryKey = ['hooks', 'personal'] as const;

export function useHooks() {
  return useQuery<Hook[]>({
    queryKey: hooksQueryKey,
    queryFn: async () => {
      const list = await callIpc<Hook[]>('hook.list', { scope: 'personal' });
      return Array.isArray(list) ? list : [];
    },
  });
}

export function useDeleteHook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (hook: Hook) => callIpc('hook.delete', { id: hook.id, scope: 'personal' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: hooksQueryKey }),
  });
}
