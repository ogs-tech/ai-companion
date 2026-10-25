import { describe, expect, it } from 'vitest';
import { buildGitDecorations, groupChanges } from '../../../../../src/renderer/components/workspace/git/git-decorations.js';
import type { GitFileChange } from '../../../../../src/shared/git.js';

const file = (path: string, index: GitFileChange['index'], worktree: GitFileChange['worktree'], conflicted = false): GitFileChange => ({
  path,
  index,
  worktree,
  conflicted,
});

describe('groupChanges', () => {
  it('puts a partially staged file in both groups and conflicts only under changes', () => {
    const both = file('both.ts', 'modified', 'modified');
    const conflict = file('c.ts', 'modified', 'modified', true);
    const untracked = file('n.ts', 'untracked', 'untracked');
    const staged = file('s.ts', 'added', 'unmodified');
    const groups = groupChanges([both, conflict, untracked, staged]);
    expect(groups.staged).toEqual([both, staged]);
    expect(groups.changes).toEqual([both, conflict, untracked]);
  });
});

describe('buildGitDecorations', () => {
  it('maps letters and colors per status', () => {
    const { byPath } = buildGitDecorations([
      file('a.ts', 'unmodified', 'modified'),
      file('b.ts', 'added', 'unmodified'),
      file('c.ts', 'untracked', 'untracked'),
      file('d.ts', 'unmodified', 'deleted'),
    ]);
    expect(byPath.get('a.ts')).toMatchObject({ letters: 'M', color: 'warning.main', unstaged: true, staged: false });
    expect(byPath.get('b.ts')).toMatchObject({ letters: 'A', color: 'success.main', staged: true, unstaged: false });
    expect(byPath.get('c.ts')).toMatchObject({ letters: 'U', color: 'success.main' });
    expect(byPath.get('d.ts')).toMatchObject({ letters: 'D', color: 'error.main' });
  });

  it('shows both letters for a file staged and unstaged at once', () => {
    const { byPath } = buildGitDecorations([file('a.ts', 'modified', 'modified')]);
    expect(byPath.get('a.ts')).toMatchObject({ letters: 'M·M', staged: true, unstaged: true });
  });

  it('marks conflicts with ! in the error color', () => {
    const { byPath } = buildGitDecorations([file('a.ts', 'modified', 'modified', true)]);
    expect(byPath.get('a.ts')).toMatchObject({ letters: '!', color: 'error.main', conflicted: true });
  });

  it('collects every ancestor directory, including paths with spaces', () => {
    const { dirtyDirs } = buildGitDecorations([file('src/my dir/deep/a.ts', 'unmodified', 'modified'), file('top.ts', 'unmodified', 'modified')]);
    expect([...dirtyDirs].sort()).toEqual(['src', 'src/my dir', 'src/my dir/deep']);
  });

  it('lists files deleted in the worktree or the index', () => {
    const wt = file('gone.ts', 'unmodified', 'deleted');
    const idx = file('staged-gone.ts', 'deleted', 'unmodified');
    const { deleted } = buildGitDecorations([wt, idx, file('ok.ts', 'unmodified', 'modified')]);
    expect(deleted).toEqual([wt, idx]);
  });
});

describe('buildGitDecorations dirState', () => {
  it('aggregates staged/unstaged sides over every ancestor folder', () => {
    const { dirState } = buildGitDecorations([
      file('src/a/x.ts', 'added', 'unmodified'),
      file('src/b.ts', 'unmodified', 'modified'),
      file('docs/c.md', 'unmodified', 'modified'),
    ]);
    expect(dirState.get('src')).toEqual({ staged: true, unstaged: true });
    expect(dirState.get('src/a')).toEqual({ staged: true, unstaged: false });
    expect(dirState.get('docs')).toEqual({ staged: false, unstaged: true });
    expect(dirState.has('other')).toBe(false);
  });
});
