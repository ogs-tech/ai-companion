import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { callIpc } from '../lib/ipc.js';
import type { ChannelId } from '../../shared/channel.js';
import type { ChannelStatus } from '../../shared/channel-setup.js';

export const channelStatusQueryKey = (channelId: ChannelId) => ['channel-status', channelId] as const;

/** Installed / signed-in state of a channel. Re-checked when the app regains focus, since install and login happen outside it. */
export function useChannelStatus(channelId: ChannelId): UseQueryResult<ChannelStatus> {
  return useQuery({
    queryKey: channelStatusQueryKey(channelId),
    queryFn: () => callIpc<ChannelStatus>('channelSetup.status', { channelId }),
    refetchOnWindowFocus: true,
    staleTime: 0,
  });
}
