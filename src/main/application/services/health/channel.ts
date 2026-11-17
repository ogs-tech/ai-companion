import type { ChannelId } from '../../../../shared/channel.js';
import { isChannelId } from '../../../../shared/channel.js';
import { entityUrn } from '../../../../shared/entity.js';

/** The `channel` field of a check for an adapter id, or nothing when the adapter is not a known harness. */
export function channelOf(adapterId: string): { channel?: ChannelId } {
  return isChannelId(adapterId) ? { channel: adapterId } : {};
}

/**
 * The tree item an MCP check belongs to. Claude names a plugin's server `plugin:<pluginId>:<server>`; the check
 * goes on that server's own row (listed under its plugin), and `CustomizationStatusService` rolls it up to the
 * plugin row — so the error shows on both, and the plugin's ⚠ still reaches it in Diagnósticos.
 */
export function mcpCheckUrn(name: string): string {
  const plugin = /^plugin:[^:]+:(.+)$/.exec(name);
  return entityUrn('mcp', plugin !== null ? (plugin[1] as string) : name);
}
