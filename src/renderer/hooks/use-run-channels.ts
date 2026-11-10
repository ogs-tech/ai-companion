import { useQuery } from '@tanstack/react-query';
import { callIpc } from '../lib/ipc.js';
import { CHANNEL_IDS, channelSupports, type ChannelId } from '../../shared/channel.js';
import { useSettings } from './use-settings.js';

export interface RunHarnessOption {
  id: ChannelId;
  /** Whether the harness's CLI was found on this machine. */
  available: boolean;
}

/**
 * The harnesses a new session can be started in: those that support `run` and
 * are switched on in Settings, each flagged with whether its CLI is installed.
 * Availability is re-checked whenever the query is (re)fetched, so reopening
 * the new-session dialog picks up a CLI installed in the meantime.
 */
export function useRunChannels(): { options: RunHarnessOption[]; refresh: () => void } {
  const { data: settings } = useSettings();
  const { data: installed, refetch } = useQuery<ChannelId[]>({
    queryKey: ['session-available-harnesses'],
    queryFn: () => callIpc<ChannelId[]>('session.availableHarnesses', {}),
    staleTime: 0,
  });
  const options = CHANNEL_IDS.filter(
    (id) => channelSupports(id, 'run') && (settings?.adapters[id]?.enabled ?? id === 'claude'),
  ).map((id) => ({ id, available: installed?.includes(id) ?? id === 'claude' }));
  return { options, refresh: () => void refetch() };
}
