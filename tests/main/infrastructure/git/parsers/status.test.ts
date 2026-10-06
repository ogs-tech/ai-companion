import { describe, expect, it } from 'vitest';
import { parseStatus } from '../../../../../src/main/infrastructure/git/parsers/status.js';

const z = (...records: string[]): string => records.map((r) => `${r}\0`).join('');
const H = '0000000000000000000000000000000000000000';

describe('parseStatus (porcelain v2 -z)', () => {
  it('reads branch headers with upstream and ahead/behind', () => {
    const { head } = parseStatus(
      z(
        '# branch.oid 1234abcd',
        '# branch.head main',
        '# branch.upstream origin/main',
        '# branch.ab +2 -3',
      ),
    );
    expect(head).toEqual({
      name: 'main',
      oid: '1234abcd',
      upstream: 'origin/main',
      ahead: 2,
      behind: 3,
    });
  });

  it('reports an unborn branch (oid null) and a detached HEAD (name null)', () => {
    expect(parseStatus(z('# branch.oid (initial)', '# branch.head main')).head.oid).toBeNull();
    expect(parseStatus(z('# branch.oid abc', '# branch.head (detached)')).head.name).toBeNull();
  });

  it('parses ordinary changes into index (X) and worktree (Y) columns', () => {
    const { files } = parseStatus(
      z(
        `1 M. N... 100644 100644 100644 ${H} ${H} staged.ts`,
        `1 .D N... 100644 100644 000000 ${H} ${H} gone.ts`,
      ),
    );
    expect(files).toEqual([
      { path: 'staged.ts', index: 'modified', worktree: 'unmodified', conflicted: false },
      { path: 'gone.ts', index: 'unmodified', worktree: 'deleted', conflicted: false },
    ]);
  });

  it('keeps spaces and unicode in paths', () => {
    const { files } = parseStatus(
      z(`1 .M N... 100644 100644 100644 ${H} ${H} dir/my file ção.md`, '? new dir/a b.txt'),
    );
    expect(files.map((f) => f.path)).toEqual(['dir/my file ção.md', 'new dir/a b.txt']);
  });

  it('accepts newlines inside paths, which -z leaves unquoted', () => {
    const { files } = parseStatus(z('? weird\nname.txt'));
    expect(files[0]?.path).toBe('weird\nname.txt');
  });

  it('reads a rename record and its original path from the next NUL field', () => {
    const { files } = parseStatus(
      z(`2 R. N... 100644 100644 100644 ${H} ${H} R100 new name.ts`, 'old name.ts', '? after.txt'),
    );
    expect(files).toEqual([
      {
        path: 'new name.ts',
        origPath: 'old name.ts',
        index: 'renamed',
        worktree: 'unmodified',
        conflicted: false,
      },
      { path: 'after.txt', index: 'untracked', worktree: 'untracked', conflicted: false },
    ]);
  });

  it('flags unmerged records as conflicted', () => {
    const { files } = parseStatus(
      z(`u UU N... 100644 100644 100644 100644 ${H} ${H} ${H} both.ts`),
    );
    expect(files).toEqual([
      { path: 'both.ts', index: 'modified', worktree: 'modified', conflicted: true },
    ]);
  });

  it('returns no files for a clean tree', () => {
    expect(parseStatus(z('# branch.oid abc', '# branch.head main')).files).toEqual([]);
  });
});
