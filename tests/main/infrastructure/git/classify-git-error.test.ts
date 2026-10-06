import { describe, expect, it } from 'vitest';
import {
  classifyGitError,
  STDERR_LIMIT,
} from '../../../../src/main/infrastructure/git/classify-git-error.js';

describe('classifyGitError', () => {
  it.each([
    ['fatal: not a git repository (or any of the parent directories): .git', 'not_found'],
    ["fatal: Authentication failed for 'https://github.com/x/y.git/'", 'auth'],
    ['git@github.com: Permission denied (publickey).', 'auth'],
    ["fatal: could not read Username for 'https://github.com': terminal prompts disabled", 'auth'],
    ["fatal: Unable to create '/r/.git/index.lock': File exists.", 'conflict'],
    ['CONFLICT (content): Merge conflict in a.ts', 'conflict'],
    [' ! [rejected]        main -> main (non-fast-forward)', 'conflict'],
    ['error: something nobody anticipated', 'io'],
  ])('%s → %s', (stderr, kind) => {
    expect(classifyGitError(stderr, '/r').kind).toBe(kind);
  });

  it('carries the files git lists under a dirty-tree refusal', () => {
    const stderr = [
      'error: Your local changes to the following files would be overwritten by checkout:',
      '\ta.ts',
      '\tdir/b.ts',
      'Please commit your changes or stash them before you switch branches.',
    ].join('\n');
    const err = classifyGitError(stderr, '/r');
    expect(err.kind).toBe('conflict');
    expect(err.details?.['files']).toEqual(['a.ts', 'dir/b.ts']);
  });

  it('keeps unknown stderr in details, truncated', () => {
    const err = classifyGitError(`error: ${'x'.repeat(STDERR_LIMIT * 2)}`, '/r');
    expect(err.kind).toBe('io');
    expect((err.details?.['stderr'] as string).length).toBe(STDERR_LIMIT + 1);
  });
});
