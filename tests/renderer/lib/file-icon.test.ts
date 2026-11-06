import { describe, it, expect } from 'vitest';
import { fileIconFor } from '../../../src/renderer/lib/file-icon.js';

describe('fileIconFor', () => {
  it.each([
    ['App.tsx', 'azul'],
    ['package.json', 'ambar'],
    ['.env', 'ambar'],
    ['README.md', 'slate'],
    ['logo.PNG', 'verde'],
  ])('tones %s as %s', (name, tone) => {
    expect(fileIconFor(name).tone).toBe(tone);
  });

  it('gives unknown and extensionless files no tone, and never uses erro', () => {
    expect(fileIconFor('Makefile').tone).toBeUndefined();
    expect(fileIconFor('data.xyz').tone).toBeUndefined();
  });
});
