import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { callIpc } from '../lib/ipc.js';
import type { HookHandler } from '../lib/describe-hook-handler.js';
import { invalidateHealth } from './use-health-report.js';

export interface Hook {
  id: string;
  event: string;
  matcher?: string;
  description?: string;
  handler: HookHandler;
  /** Absent on plugin-provided and detected hooks, which are always active. */
  enabled?: boolean;
  source:
    | { kind: 'workspace' }
    | { kind: 'plugin'; pluginId: string }
    | { kind: 'detected'; detectedId: string; harness: 'claude' | 'cursor'; importable: boolean; reason?: string };
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
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: hooksQueryKey }), invalidateHealth(qc)]),
  });
}
