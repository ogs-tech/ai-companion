import { describe, expect, it } from 'vitest';
import {
  coveringChannel,
  CHANNELS,
  CHANNEL_IDS,
  channelSupports,
  isChannelId,
  type ChannelId,
} from '../../src/shared/channel.js';

describe('channel registry', () => {
  it('keys every descriptor by its own id', () => {
    for (const [key, descriptor] of Object.entries(CHANNELS)) {
      expect(descriptor.id).toBe(key);
    }
  });

  it('lists every registered harness in CHANNEL_IDS', () => {
    expect([...CHANNEL_IDS].sort()).toEqual(Object.keys(CHANNELS).sort());
  });

  it('gives every channel at least one capability', () => {
    for (const id of CHANNEL_IDS) {
      expect(CHANNELS[id].capabilities.length).toBeGreaterThan(0);
    }
  });

  it('keeps manage on the channels that own a config surface, and LM Studio run-only', () => {
    expect(channelSupports('claude', 'manage')).toBe(true);
    expect(channelSupports('cursor', 'manage')).toBe(true);
    expect(channelSupports('lmstudio', 'manage')).toBe(false);
    expect(channelSupports('lmstudio', 'run')).toBe(true);
  });

  it('declares how to detect, install and (when it has accounts) sign in to every channel', () => {
    for (const id of CHANNEL_IDS) {
      const { setup } = CHANNELS[id];
      expect(setup.bin.length).toBeGreaterThan(0);
      expect(setup.versionArgs.length).toBeGreaterThan(0);
      if (setup.auth !== null) expect(setup.auth.statusArgs.length).toBeGreaterThan(0);
    }
    expect(CHANNELS.lmstudio.setup.auth).toBeNull();
    expect(CHANNELS.lmstudio.setup.install).toEqual({ kind: 'command', command: 'curl -fsSL https://lmstudio.ai/install.sh | bash' });
  });

  it('declares a non-empty display name per harness', () => {
    for (const id of CHANNEL_IDS) {
      expect(CHANNELS[id].displayName.length).toBeGreaterThan(0);
    }
  });
});

describe('channelSupports', () => {
  it('reports run for a harness that exposes its loop as a CLI', () => {
    // Claude Code (`claude`) and Cursor (`cursor-agent`) can both be spawned in a PTY.
    expect(channelSupports('claude', 'run')).toBe(true);
    expect(channelSupports('cursor', 'run')).toBe(true);
  });

  it('reports manage for both', () => {
    expect(channelSupports('claude', 'manage')).toBe(true);
    expect(channelSupports('cursor', 'manage')).toBe(true);
  });
});

describe('isChannelId', () => {
  it('accepts a registered id', () => {
    expect(isChannelId('claude')).toBe(true);
    expect(isChannelId('cursor')).toBe(true);
  });

  it('rejects an unregistered id, including one a legacy settings file may carry', () => {
    expect(isChannelId('copilot')).toBe(false);
    expect(isChannelId('')).toBe(false);
  });

  it('rejects an inherited Object property name', () => {
    // Guards the hasOwnProperty lookup: a plain `value in CHANNELS` would say
    // yes to 'toString' and let it through settings validation as an adapter key.
    expect(isChannelId('toString')).toBe(false);
    expect(isChannelId('constructor')).toBe(false);
  });

  it('narrows to ChannelId for the caller', () => {
    const candidate: string = 'claude';
    if (isChannelId(candidate)) {
      const id: ChannelId = candidate;
      expect(CHANNELS[id].displayName).toBe('Claude');
    }
  });
});

describe('coveringChannel', () => {
  type Adapters = Parameters<typeof coveringChannel>[0]['settings']['adapters'];
  const adapters = (over: Partial<Record<'claude' | 'cursor', { enabled: boolean; readsClaudeConfig?: boolean }>> = {}): Adapters => ({
    claude: { enabled: true },
    cursor: { enabled: true },
    lmstudio: { enabled: false },
    ...over,
  });
  const served = new Set(['claude', 'cursor'] as const);

  it('Cursor reads Claude skills, agents and hooks while Claude is on and served', () => {
    for (const kind of ['skill', 'agent', 'hook'] as const) {
      expect(coveringChannel({ covered: 'cursor', kind, settings: { adapters: adapters() }, served })).toBe('claude');
    }
  });

  it('is undefined when Claude is disabled', () => {
    expect(coveringChannel({ covered: 'cursor', kind: 'skill', settings: { adapters: adapters({ claude: { enabled: false } }) }, served })).toBeUndefined();
  });

  it('is undefined when Claude produced no destination for this entity', () => {
    expect(coveringChannel({ covered: 'cursor', kind: 'skill', settings: { adapters: adapters() }, served: new Set(['cursor'] as const) })).toBeUndefined();
  });

  it('honors readsClaudeConfig: false and treats absent as true', () => {
    const off = adapters({ cursor: { enabled: true, readsClaudeConfig: false } });
    expect(coveringChannel({ covered: 'cursor', kind: 'skill', settings: { adapters: off }, served })).toBeUndefined();
    const on = adapters({ cursor: { enabled: true } });
    expect(coveringChannel({ covered: 'cursor', kind: 'skill', settings: { adapters: on }, served })).toBe('claude');
  });

  it('never covers instructions or MCP, and nothing covers Claude', () => {
    expect(coveringChannel({ covered: 'cursor', kind: 'mcp', settings: { adapters: adapters() }, served })).toBeUndefined();
    expect(coveringChannel({ covered: 'cursor', kind: 'instruction', settings: { adapters: adapters() }, served })).toBeUndefined();
    expect(coveringChannel({ covered: 'claude', kind: 'skill', settings: { adapters: adapters() }, served })).toBeUndefined();
  });

  it('declares the coverage on the Cursor descriptor', () => {
    expect(CHANNELS.cursor.reads).toEqual({ skill: ['claude'], agent: ['claude'], hook: ['claude'] });
  });
});
