import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { callIpc } from '../lib/ipc.js';
import { mostUrgentState, rowStateOf, type SessionRowState } from '../lib/session-attention.js';
import { buildFileMarks, sessionsUsing, type FileMark, type UsingSession } from '../lib/session-usage.js';
import { sessionAnchorKey, type SessionAnchor, type SessionSnapshot, type SessionUsage } from '../../shared/session.js';

export const sessionsQueryKey = ['sessions'] as const;

/** Live list of every session in the active workspace's memory — reconciled whenever any session exits in the background. */
export function useSessions(): UseQueryResult<SessionSnapshot[]> {
  const queryClient = useQueryClient();

  useEffect(() => {
    const refresh = (): void => void queryClient.invalidateQueries({ queryKey: sessionsQueryKey });
    const offExit = window.api.session.onAnyExit(refresh);
    const offActivity = window.api.session.onAnyActivity(refresh);
    return () => {
      offExit();
      offActivity();
    };
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
 * This anchor's most urgent session state (needs-input > working > idle >
 * exited), or `undefined` when it has no known session — the lookup behind
 * every `SessionStatusBadge`. `entity` anchors have at most one matching
 * session; `workspace`/`project` anchors can have several, and the row shows
 * the one that most needs the user.
 */
export function useSessionStatus(anchor: SessionAnchor): SessionRowState | undefined {
  const { data } = useSessions();
  const key = sessionAnchorKey(anchor);
  return mostUrgentState((data ?? []).filter((session) => sessionAnchorKey(session.anchor) === key).map((session) => rowStateOf(session)));
}

/**
 * One session's live snapshot, read from the shared sessions store — the
 * subscription that replaces a one-shot `session.status` lookup, so a pill
 * can never stick on its first value. `undefined` until the session is listed.
 */
export function useSessionSnapshot(sessionId: string | null): SessionSnapshot | undefined {
  const { data } = useSessions();
  if (!sessionId) return undefined;
  return data?.find((session) => session.sessionId === sessionId);
}

/** File → sessions map for the explorer's marks; recomputed only when the sessions list changes. */
export function useFileMarks(): Map<string, FileMark> {
  const { data } = useSessions();
  return useMemo(() => buildFileMarks(data ?? []), [data]);
}

/** Sessions currently using one skill / agent / MCP server (hook-reported, 10-minute window). */
export function useSessionsUsing(usage: SessionUsage): UsingSession[] {
  const { data } = useSessions();
  // A stale `now` only delays an entry leaving the 10-minute window; a fresh use is always inside it.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  return sessionsUsing(data ?? [], usage, now);
}
