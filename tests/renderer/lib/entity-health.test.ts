import { describe, expect, it } from 'vitest';
import { countProblems, rollUpToPlugins, type ChannelProblems } from '../../../src/renderer/lib/entity-health.js';

describe('rollUpToPlugins', () => {
  it('puts the failing channels of a plugin-provided item on the plugin urn', () => {
    const problems: ChannelProblems = new Map([['urn:mcp:context7', ['cursor'] as const]]);
    const rolled = rollUpToPlugins(problems, [{ urn: 'urn:mcp:context7', pluginId: 'context7' }]);
    expect(rolled.get('urn:plugin:context7')).toEqual(['cursor']);
  });

  it('unions channels from several children and the plugin own checks, in registry order', () => {
    const problems: ChannelProblems = new Map([
      ['urn:plugin:p', ['cursor'] as const],
      ['urn:hook:a', ['claude'] as const],
      ['urn:mcp:b', ['cursor'] as const],
    ]);
    const rolled = rollUpToPlugins(problems, [
      { urn: 'urn:hook:a', pluginId: 'p' },
      { urn: 'urn:mcp:b', pluginId: 'p' },
    ]);
    expect(rolled.get('urn:plugin:p')).toEqual(['claude', 'cursor']);
    expect(countProblems(rolled, ['urn:plugin:p', 'urn:plugin:q'])).toBe(1);
  });

  it('returns the same map when no child fails', () => {
    const problems: ChannelProblems = new Map();
    expect(rollUpToPlugins(problems, [{ urn: 'urn:hook:a', pluginId: 'p' }])).toBe(problems);
  });
});
