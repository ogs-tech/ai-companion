import { describe, it, expect } from 'vitest';
import { basename } from '../../../src/renderer/lib/folder-identity.js';

describe('folder identity', () => {
  it('names a folder by its last segment', () => {
    expect(basename('/repos/acme')).toBe('acme');
    expect(basename('/repos/acme/')).toBe('acme');
  });
});
