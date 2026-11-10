import { describe, expect, it } from 'vitest';
import { getDefaults, type Settings } from '../../src/shared/settings.js';

describe('getDefaults', () => {
  it('returns the canonical default Settings', () => {
    const defaults: Settings = getDefaults();

    expect(defaults).toEqual({
      adapters: {
        claude: { enabled: true },
        cursor: { enabled: false }, lmstudio: { enabled: false },
      },
      ui: { theme: 'system' },
      language: 'off',
    });
  });

  it('includes language defaulting to off', () => {
    const defaults = getDefaults();
    expect(defaults.language).toBe('off');
  });

  it('returns a fresh object on each call (no shared mutable state)', () => {
    const a = getDefaults();
    const b = getDefaults();

    expect(a).not.toBe(b);
    expect(a.adapters).not.toBe(b.adapters);
  });
});
