import { useEffect } from 'react';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { callIpc } from '../lib/ipc.js';
import type { SessionSnapshot } from '../../shared/session.js';

export const sessionsQueryKey = ['sessions'] as const;

/** Live list of every session in the active workspace's memory — reconciled whenever any session exits in the background. */
export function useSessions(): UseQueryResult<SessionSnapshot[]> {
  const queryClient = useQueryClient();

  useEffect(() => {
    return window.api.session.onAnyExit(() => {
      void queryClient.invalidateQueries({ queryKey: sessionsQueryKey });
    });
  }, [queryClient]);

  return useQuery<SessionSnapshot[]>({
    queryKey: sessionsQueryKey,
    queryFn: async () => {
      const list = await callIpc<SessionSnapshot[]>('session.list');
      return Array.isArray(list) ? list : [];
    },
  });
}
