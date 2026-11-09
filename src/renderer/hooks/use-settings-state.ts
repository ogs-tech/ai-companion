import { useQueryClient } from '@tanstack/react-query';
import { callIpc } from '../lib/ipc.js';
import { settingsQueryKey, useSettings } from './use-settings.js';
import type { Settings } from '../../shared/settings.js';

/**
 * The settings every Config page edits. Backed by the shared query, so two
 * Config tabs (one per scope can be open) and the status bar stay in step:
 * a page that saves publishes the result with `publish`, or `refetch`es.
 */
export function useSettingsState() {
  const queryClient = useQueryClient();
  const { data } = useSettings();
  return {
    settings: data ?? null,
    publish: (next: Settings): void => {
      queryClient.setQueryData(settingsQueryKey, next);
    },
    refetch: async (): Promise<void> => {
      const current = await callIpc<Settings | null>('settings.get', {});
      queryClient.setQueryData(settingsQueryKey, current);
    },
  };
}
