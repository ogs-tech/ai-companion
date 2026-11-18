import { describe, it, expect } from 'vitest';
import { isPluginMcp, mcpChannelTargets, mcpSignsIn, needsAuth, type McpServer } from '../../src/shared/mcp.js';

const base: McpServer = {
  id: 'abc',
  name: 'pencil',
  transport: 'stdio',
  def: { command: 'x' },
  scope: 'global',
  source: { kind: 'workspace' },
  enabled: true,
};

describe('shared/mcp', () => {
  it('isPluginMcp is true only for plugin source', () => {
    expect(isPluginMcp(base)).toBe(false);
    expect(
      isPluginMcp({
        ...base,
        scope: 'plugin',
        source: { kind: 'plugin', pluginId: 'serena', provenance: 'claude-code' },
      }),
    ).toBe(true);
  });

  it('needsAuth is true only when health state is needs-auth', () => {
    expect(needsAuth(base)).toBe(false);
    expect(needsAuth({ ...base, health: { state: 'error' } })).toBe(false);
    expect(needsAuth({ ...base, health: { state: 'needs-auth' } })).toBe(true);
  });
});

describe('mcpChannelTargets', () => {
  const both = ['claude', 'cursor'] as const;

  it('an own server lives in every enabled channel that can sign in to MCP, under its own name', () => {
    expect(mcpChannelTargets(base, both)).toEqual([
      { channelId: 'claude', loginName: 'pencil' },
      { channelId: 'cursor', loginName: 'pencil' },
    ]);
    expect(mcpChannelTargets(base, ['claude', 'lmstudio'])).toEqual([{ channelId: 'claude', loginName: 'pencil' }]);
  });

  it("a plugin's server lives only in Claude, under the runtime's `plugin:<id>:<server>` name", () => {
    const server: McpServer = { ...base, name: 'google calendar', scope: 'plugin', source: { kind: 'plugin', pluginId: 'support', provenance: 'claude-code' } };
    expect(mcpChannelTargets(server, both)).toEqual([{ channelId: 'claude', loginName: 'plugin:support:google calendar' }]);
    expect(mcpChannelTargets(server, ['cursor'])).toEqual([]);
  });

  it('a claude.ai connector signs in under its display name', () => {
    const server: McpServer = { ...base, name: 'claude-ai-Google-Drive', scope: 'detected', source: { kind: 'detected' } };
    expect(mcpChannelTargets(server, both)).toEqual([{ channelId: 'claude', loginName: 'claude.ai Google Drive' }]);
  });

  it('a detected server lives only in the harness it was found in', () => {
    const server: McpServer = { ...base, scope: 'detected', source: { kind: 'detected', harness: 'cursor' } };
    expect(mcpChannelTargets(server, both)).toEqual([{ channelId: 'cursor', loginName: 'pencil' }]);
  });
});

describe('mcpSignsIn', () => {
  it('remote servers and claude.ai connectors sign in; a local stdio server takes its credentials from env', () => {
    expect(mcpSignsIn({ ...base, transport: 'http' })).toBe(true);
    expect(mcpSignsIn({ ...base, transport: 'sse' })).toBe(true);
    expect(mcpSignsIn({ id: 'g', name: 'claude-ai-Gmail', def: {}, scope: 'detected', source: { kind: 'detected' }, enabled: false })).toBe(true);
    expect(mcpSignsIn(base)).toBe(false);
    expect(mcpSignsIn({ ...base, health: { state: 'needs-auth' } })).toBe(true);
  });
});
