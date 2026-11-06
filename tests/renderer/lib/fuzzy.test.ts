import { describe, it, expect } from 'vitest';
import { fuzzyFilter, fuzzyMatch } from '../../../src/renderer/lib/fuzzy.js';

describe('fuzzyMatch', () => {
  it('matches a subsequence case-insensitively and reports the matched indices', () => {
    const match = fuzzyMatch('fdt', 'src/FolderTree.tsx');
    expect(match).not.toBeNull();
    expect(match?.indices).toHaveLength(3);
  });

  it('returns null when the query is not a subsequence', () => {
    expect(fuzzyMatch('zzz', 'src/index.ts')).toBeNull();
  });

  it('ranks a base-name match above a directory-only match', () => {
    const ranked = fuzzyFilter('tree', ['tree/readme.md', 'src/FolderTree.tsx'], (p) => p);
    expect(ranked[0]?.item).toBe('src/FolderTree.tsx');
  });

  it('matches everything with an empty query', () => {
    expect(fuzzyMatch('', 'a.ts')).toEqual({ score: 0, indices: [] });
  });
});
