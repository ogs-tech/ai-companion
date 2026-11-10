import { describe, expect, it } from 'vitest';
import {
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
    expect(CHANNELS.lmstudio.setup.install.kind).toBe('download');
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
