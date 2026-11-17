import { CHANNELS, type ChannelId } from '../../shared/channel.js';

/** `Claude · Cursor` */
export function channelNames(channels: readonly ChannelId[]): string {
  return channels.map((id) => CHANNELS[id].displayName).join(' · ');
}
