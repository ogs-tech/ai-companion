import { useEffect, useRef } from 'react';

/** Case-insensitive substring match over the given fields; an empty query matches everything. */
export function matchesQuery(query: string, ...fields: ReadonlyArray<string | undefined>): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === '') return true;
  return fields.some((field) => field?.toLowerCase().includes(needle));
}

/**
 * Reports how many rows a flat list renders, so the Control Panel can derive
 * its empty state and auto-expand "Do Global" without lifting every data hook.
 * `onCount` may be an inline lambda — only a change of `count` re-reports.
 */
export function useReportCount(count: number, onCount: ((count: number) => void) | undefined): void {
  const latest = useRef(onCount);
  useEffect(() => {
    latest.current = onCount;
  });
  useEffect(() => {
    latest.current?.(count);
  }, [count]);
}
