import { useQuery } from '@tanstack/react-query';
import { callIpc } from '../lib/ipc.js';
import { HARNESS_IDS, harnessSupports, type HarnessId } from '../../shared/harness.js';
import { useSettings } from './use-settings.js';

export interface RunHarnessOption {
  id: HarnessId;
  /** Whether the harness's CLI was found on this machine. */
  available: boolean;
}

/**
 * The harnesses a new session can be started in: those that support `run` and
 * are switched on in Settings, each flagged with whether its CLI is installed.
 * Availability is re-checked whenever the query is (re)fetched, so reopening
 * the new-session dialog picks up a CLI installed in the meantime.
 */
export function useRunHarnesses(): { options: RunHarnessOption[]; refresh: () => void } {
  const { data: settings } = useSettings();
  const { data: installed, refetch } = useQuery<HarnessId[]>({
    queryKey: ['session-available-harnesses'],
    queryFn: () => callIpc<HarnessId[]>('session.availableHarnesses', {}),
    staleTime: 0,
  });
  const options = HARNESS_IDS.filter(
    (id) => harnessSupports(id, 'run') && (settings?.adapters[id]?.enabled ?? id === 'claude'),
  ).map((id) => ({ id, available: installed?.includes(id) ?? id === 'claude' }));
  return { options, refresh: () => void refetch() };
}
