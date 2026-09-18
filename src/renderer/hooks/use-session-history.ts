import { useEffect, useRef } from 'react';
import { useInfiniteQuery, useQuery, type UseInfiniteQueryResult, type UseQueryResult } from '@tanstack/react-query';
import { callIpc } from '../lib/ipc.js';
import type {
  HistoryFilters,
  HistoryScope,
  SessionHistoryPage,
  SessionHistoryStats,
} from '../../shared/session-history.js';

/** How many conversations the `Histórico` tab loads at once. */
export const SESSION_HISTORY_TAB_LIMIT = 500;

export const sessionHistoryQueryKey = (scope: HistoryScope, filters?: HistoryFilters): unknown[] => [
  'session-history',
  scope,
  filters ?? null,
];

export const sessionHistoryStatsQueryKey = (scope: HistoryScope, filters?: HistoryFilters): unknown[] => [
  'session-history-stats',
  scope,
  filters ?? null,
];

/**
 * Past conversations for a scope, ten at a time.
 *
 * Paged by the cursor the main process hands back rather than by an offset,
 * so a live session writing to its transcript mid-scroll — which jumps it to
 * the top of the ordering — can't make a row be skipped or served twice.
 */
export function useSessionHistory(
  scope: HistoryScope,
  filters?: HistoryFilters,
  options?: { enabled?: boolean },
): UseInfiniteQueryResult<{ pages: SessionHistoryPage[] }> {
  return useInfiniteQuery({
    queryKey: sessionHistoryQueryKey(scope, filters),
    enabled: options?.enabled ?? true,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const page = await callIpc<SessionHistoryPage>('sessionHistory.list', {
        scope,
        ...(filters ? { filters } : {}),
        ...(pageParam ? { cursor: pageParam } : {}),
      });
      // A result that isn't the shape this expects must read as an empty page,
      // not crash the panel that a live session is also rendered into.
      return Array.isArray(page?.entries) ? page : { entries: [], nextCursor: null, total: 0 };
    },
    getNextPageParam: (lastPage: SessionHistoryPage | undefined) => lastPage?.nextCursor ?? null,
  });
}

/**
 * Every conversation in scope in one call, for the `Histórico` tab.
 *
 * The tab sorts by cost and charts spend per day, and both of those are
 * properties of the whole set rather than of a page — so this one deliberately
 * does not paginate. Capped, because "every conversation on this machine" has
 * no natural ceiling.
 */
export function useSessionHistoryAll(
  scope: HistoryScope,
  filters?: HistoryFilters,
  options?: { enabled?: boolean },
): UseQueryResult<SessionHistoryPage> {
  return useQuery({
    queryKey: ['session-history-all', scope, filters ?? null],
    enabled: options?.enabled ?? true,
    queryFn: () =>
      callIpc<SessionHistoryPage>('sessionHistory.list', {
        scope,
        limit: SESSION_HISTORY_TAB_LIMIT,
        ...(filters ? { filters } : {}),
      }).then((page) => (Array.isArray(page?.entries) ? page : { entries: [], nextCursor: null, total: 0 })),
  });
}

export function useSessionHistoryStats(
  scope: HistoryScope,
  filters?: HistoryFilters,
  options?: { enabled?: boolean },
): UseQueryResult<SessionHistoryStats> {
  return useQuery({
    queryKey: sessionHistoryStatsQueryKey(scope, filters),
    enabled: options?.enabled ?? true,
    queryFn: () =>
      callIpc<SessionHistoryStats>('sessionHistory.stats', { scope, ...(filters ? { filters } : {}) }),
  });
}

/**
 * Watches an empty element below the last row and fetches the next page when
 * it comes into view.
 *
 * Returns a ref to attach to that sentinel. `IntersectionObserver` rather
 * than a scroll handler so the browser does the work off the main thread, and
 * so a list that is short enough to show its own end simply never fires.
 */
export function useInfiniteScrollSentinel(
  onReach: () => void,
  enabled: boolean,
): React.RefObject<HTMLDivElement | null> {
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  // Kept in a ref so re-creating the callback each render doesn't tear down
  // and rebuild the observer, which would re-fire on the next paint. Synced in
  // its own effect rather than during render: a ref written during render is
  // lost if React discards that render, and the observer below reads it only
  // from a callback, which always runs after commit.
  const onReachRef = useRef(onReach);
  useEffect(() => {
    onReachRef.current = onReach;
  });

  useEffect(() => {
    const element = sentinelRef.current;
    if (!element || !enabled) return;
    if (typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) onReachRef.current();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [enabled]);

  return sentinelRef;
}
