import { useQuery } from '@tanstack/react-query';
import { callIpc } from '../lib/ipc.js';
import { healthQueryKey } from './use-health-report.js';
import type { CustomizationStatusReport, ItemStatus } from '../../shared/customization-status.js';

/**
 * Under the personal health report's key: the status is derived from it, so every place that invalidates the
 * report — an entity save or file change, a sync, an MCP/hook/plugin/channel toggle — refreshes the status too.
 */
export const CUSTOMIZATION_STATUS_KEY = [...healthQueryKey('personal'), 'customization-status'] as const;
const NONE: Readonly<Record<string, ItemStatus>> = {};

/**
 * urn → status for the Customizações tree, computed in main. No timer: read on app load/reload (a fresh query
 * cache), on scope switch (every query is invalidated) and after any write that invalidates the health report.
 * Empty while it loads — silence, not a flash of warnings.
 */
export function useCustomizationStatus(): Readonly<Record<string, ItemStatus>> {
  const { data } = useQuery<CustomizationStatusReport>({
    queryKey: CUSTOMIZATION_STATUS_KEY,
    queryFn: () => callIpc<CustomizationStatusReport>('customization.status', {}),
    staleTime: Infinity,
  });
  return data?.items ?? NONE;
}
