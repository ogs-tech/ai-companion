import { useQuery } from '@tanstack/react-query';
import { callIpc } from '../lib/ipc.js';
import type { Settings } from '../../shared/settings.js';

export const settingsQueryKey = ['settings'] as const;

/** Read-only view of the persisted settings — writers invalidate `settingsQueryKey` so readers (e.g. the status bar) follow. */
export function useSettings() {
  return useQuery<Settings | null>({
    queryKey: settingsQueryKey,
    queryFn: () => callIpc<Settings | null>('settings.get', {}),
  });
}
