import { useQuery, type QueryClient, type UseQueryResult } from '@tanstack/react-query';
import { callIpc } from '../lib/ipc.js';
import type { HealthReport } from '../../shared/health.js';

export type HealthScope = 'personal' | 'project';

export function healthQueryKey(scope: HealthScope = 'personal'): readonly unknown[] {
  return ['health', scope] as const;
}

/**
 * No timer: the report is read on app load/reload, on scope switch (every query is invalidated) and when an
 * entity changes; Diagnósticos refreshes it on demand.
 */
export function useHealthReport(scope: HealthScope = 'personal'): UseQueryResult<HealthReport> {
  return useQuery<HealthReport>({
    queryKey: healthQueryKey(scope),
    queryFn: () => callIpc<HealthReport>('health.getReport', { scope }),
  });
}

/** After a write that changes what is synced where: the report and the customization status under it refetch. */
export function invalidateHealth(qc: QueryClient): Promise<void> {
  return qc.invalidateQueries({ queryKey: healthQueryKey('personal') });
}
