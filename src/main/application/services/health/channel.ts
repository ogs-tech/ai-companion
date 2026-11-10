import type { ChannelId } from '../../../../shared/channel.js';
import { isChannelId } from '../../../../shared/channel.js';

/** The `channel` field of a check for an adapter id, or nothing when the adapter is not a known harness. */
export function channelOf(adapterId: string): { channel?: ChannelId } {
  return isChannelId(adapterId) ? { channel: adapterId } : {};
}
