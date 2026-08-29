import { useEffect } from 'react';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { callIpc } from '../lib/ipc.js';
import { sessionAnchorKey, type SessionAnchor, type SessionSnapshot, type SessionStatus } from '../../shared/session.js';

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

/**
 * This anchor's aggregate live/exited status, or `undefined` when it has no
 * known session — the lookup behind every `SessionStatusBadge`. `entity`
 * anchors have at most one matching session, so this is behaviorally
 * identical to an exact `sessionId` match; `workspace`/`project` anchors can
 * have several coexisting sessions, so any one of them running is enough to
 * report `running`.
 */
export function useSessionStatus(anchor: SessionAnchor): SessionStatus | undefined {
  const { data } = useSessions();
  const key = sessionAnchorKey(anchor);
  const matches = data?.filter((session) => sessionAnchorKey(session.anchor) === key) ?? [];
  if (matches.some((session) => session.status === 'running')) return 'running';
  return matches.length > 0 ? 'exited' : undefined;
}
