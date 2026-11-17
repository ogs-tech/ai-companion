import type { ChannelId } from '../../../../shared/channel.js';
import { isChannelId } from '../../../../shared/channel.js';
import { entityUrn } from '../../../../shared/entity.js';

/** The `channel` field of a check for an adapter id, or nothing when the adapter is not a known harness. */
export function channelOf(adapterId: string): { channel?: ChannelId } {
  return isChannelId(adapterId) ? { channel: adapterId } : {};
}

/**
 * The tree item an MCP check belongs to. Claude names a plugin's server `plugin:<pluginId>:<server>`; that
 * server is the plugin's, so its problem shows on the plugin row, not as a stray MCP under Integrações.
 */
export function mcpCheckUrn(name: string): string {
  const plugin = /^plugin:([^:]+):.+$/.exec(name);
  return plugin !== null ? `urn:plugin:${plugin[1] as string}` : entityUrn('mcp', name);
}
