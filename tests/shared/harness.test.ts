import { describe, expect, it } from 'vitest';
import {
  HARNESSES,
  HARNESS_IDS,
  harnessSupports,
  isHarnessId,
  type HarnessId,
} from '../../src/shared/harness.js';

describe('harness registry', () => {
  it('keys every descriptor by its own id', () => {
    for (const [key, descriptor] of Object.entries(HARNESSES)) {
      expect(descriptor.id).toBe(key);
    }
  });

  it('lists every registered harness in HARNESS_IDS', () => {
    expect([...HARNESS_IDS].sort()).toEqual(Object.keys(HARNESSES).sort());
  });

  it('gives every harness the manage capability', () => {
    // `manage` is the reason a harness is in the registry at all: this app owns
    // its customization files. A harness that cannot be managed does not belong.
    for (const id of HARNESS_IDS) {
      expect(HARNESSES[id].capabilities).toContain('manage');
    }
  });

  it('declares a non-empty display name per harness', () => {
    for (const id of HARNESS_IDS) {
      expect(HARNESSES[id].displayName.length).toBeGreaterThan(0);
    }
  });
});

describe('harnessSupports', () => {
  it('reports run only for a harness that exposes its loop as a CLI', () => {
    // Claude Code can be spawned in a PTY; Cursor runs its loop inside its own
    // GUI process, out of reach. This asymmetry is the domain, not a gap.
    expect(harnessSupports('claude', 'run')).toBe(true);
    expect(harnessSupports('cursor', 'run')).toBe(false);
  });

  it('reports manage for both', () => {
    expect(harnessSupports('claude', 'manage')).toBe(true);
    expect(harnessSupports('cursor', 'manage')).toBe(true);
  });
});

describe('isHarnessId', () => {
  it('accepts a registered id', () => {
    expect(isHarnessId('claude')).toBe(true);
    expect(isHarnessId('cursor')).toBe(true);
  });

  it('rejects an unregistered id, including one a legacy settings file may carry', () => {
    expect(isHarnessId('copilot')).toBe(false);
    expect(isHarnessId('')).toBe(false);
  });

  it('rejects an inherited Object property name', () => {
    // Guards the hasOwnProperty lookup: a plain `value in HARNESSES` would say
    // yes to 'toString' and let it through settings validation as an adapter key.
    expect(isHarnessId('toString')).toBe(false);
    expect(isHarnessId('constructor')).toBe(false);
  });

  it('narrows to HarnessId for the caller', () => {
    const candidate: string = 'claude';
    if (isHarnessId(candidate)) {
      const id: HarnessId = candidate;
      expect(HARNESSES[id].displayName).toBe('Claude');
    }
  });
});
