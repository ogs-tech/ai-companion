import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { simpleGit } from 'simple-git';
import { SimpleGitRepoClient } from '../../../../src/main/infrastructure/git/simple-git-repo-client.js';
import type { GitStatus } from '../../../../src/shared/git.js';

const client = new SimpleGitRepoClient();
const tmpDirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'sde-repo-git-test-'));
  tmpDirs.push(dir);
  return dir;
}

async function newRepo(): Promise<string> {
  const dir = await tempDir();
  await client.init(dir);
  await simpleGit(dir).addConfig('user.email', 'test@example.com').addConfig('user.name', 'Test');
  return dir;
}

async function commitFile(dir: string, file: string, content: string): Promise<void> {
  await writeFile(path.join(dir, file), content);
  await client.stage(dir, [file]);
  await client.commit(dir, `add ${file}`, false);
}

function filesOf(status: GitStatus) {
  if (!status.isRepo) throw new Error('expected a repo');
  return status.files;
}

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe('SimpleGitRepoClient', () => {
  let repo: string;
  beforeEach(async () => {
    repo = await newRepo();
  });

  it('reports a non-repo, a missing folder and a repo subfolder as isRepo: false', async () => {
    expect(await client.status(await tempDir())).toEqual({ isRepo: false });
    expect(await client.status(path.join(repo, 'missing'))).toEqual({ isRepo: false });
    await mkdir(path.join(repo, 'sub'));
    expect(await client.status(path.join(repo, 'sub'))).toEqual({ isRepo: false });
  });

  it('reports an unborn branch with untracked files', async () => {
    await writeFile(path.join(repo, 'a b.txt'), 'x');
    const status = await client.status(repo);
    expect(status).toMatchObject({
      isRepo: true,
      state: 'clean',
      truncated: false,
      head: { oid: null },
    });
    expect(filesOf(status)).toEqual([
      { path: 'a b.txt', index: 'untracked', worktree: 'untracked', conflicted: false },
    ]);
  });

  it('stages, commits and returns the new HEAD sha', async () => {
    await writeFile(path.join(repo, 'a.txt'), 'one\n');
    await client.stage(repo, ['a.txt']);
    expect(filesOf(await client.status(repo))[0]).toMatchObject({
      index: 'added',
      worktree: 'unmodified',
    });

    const { sha } = await client.commit(repo, 'first\n\nbody', false);
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    expect(filesOf(await client.status(repo))).toEqual([]);
    expect((await simpleGit(repo).log()).latest?.message).toBe('first');
  });

  it('unstages on an unborn branch without touching the file', async () => {
    await writeFile(path.join(repo, 'a.txt'), 'one\n');
    await client.stage(repo, ['a.txt']);
    await client.unstage(repo, ['a.txt']);
    expect(filesOf(await client.status(repo))[0]).toMatchObject({ index: 'untracked' });
    expect(existsSync(path.join(repo, 'a.txt'))).toBe(true);
  });

  it('unstages back to HEAD once a commit exists', async () => {
    await commitFile(repo, 'a.txt', 'one\n');
    await writeFile(path.join(repo, 'a.txt'), 'two\n');
    await client.stage(repo, ['a.txt']);
    await client.unstage(repo, ['a.txt']);
    expect(filesOf(await client.status(repo))[0]).toMatchObject({
      index: 'unmodified',
      worktree: 'modified',
    });
  });

  it('diffs the worktree and the index separately', async () => {
    await commitFile(repo, 'a.txt', 'one\n');
    await writeFile(path.join(repo, 'a.txt'), 'two\n');
    await client.stage(repo, ['a.txt']);
    await writeFile(path.join(repo, 'a.txt'), 'three\n');

    const index = await client.diff(repo, 'a.txt', 'index');
    const worktree = await client.diff(repo, 'a.txt', 'worktree');
    if (index.kind !== 'text' || worktree.kind !== 'text') throw new Error('expected text diffs');
    expect(index.hunks[0]?.lines.map((l) => `${l.kind}:${l.text}`)).toEqual(['del:one', 'add:two']);
    expect(worktree.hunks[0]?.lines.map((l) => `${l.kind}:${l.text}`)).toEqual([
      'del:two',
      'add:three',
    ]);
  });

  it('diffs an untracked file as all-added', async () => {
    await writeFile(path.join(repo, 'n.txt'), 'a\nb\n');
    const diff = await client.diff(repo, 'n.txt', 'worktree');
    if (diff.kind !== 'text') throw new Error('expected text');
    expect(diff.hunks[0]?.lines.map((l) => l.kind)).toEqual(['add', 'add']);
  });

  it('discards tracked edits back to the index and removes untracked files', async () => {
    await commitFile(repo, 'a.txt', 'one\n');
    await writeFile(path.join(repo, 'a.txt'), 'two\n');
    await writeFile(path.join(repo, 'new.txt'), 'x');

    await client.discard(repo, ['a.txt', 'new.txt']);

    expect(await readFile(path.join(repo, 'a.txt'), 'utf8')).toBe('one\n');
    expect(existsSync(path.join(repo, 'new.txt'))).toBe(false);
    expect(filesOf(await client.status(repo))).toEqual([]);
  });

  it('keeps staged content when discarding worktree edits', async () => {
    await commitFile(repo, 'a.txt', 'one\n');
    await writeFile(path.join(repo, 'a.txt'), 'two\n');
    await client.stage(repo, ['a.txt']);
    await writeFile(path.join(repo, 'a.txt'), 'three\n');

    await client.discard(repo, ['a.txt']);

    expect(await readFile(path.join(repo, 'a.txt'), 'utf8')).toBe('two\n');
    expect(filesOf(await client.status(repo))[0]).toMatchObject({
      index: 'modified',
      worktree: 'unmodified',
    });
  });

  it('amends the last commit', async () => {
    await commitFile(repo, 'a.txt', 'one\n');
    await client.commit(repo, 'reworded', true);
    const log = await simpleGit(repo).log();
    expect(log.total).toBe(1);
    expect(log.latest?.message).toBe('reworded');
  });

  it('surfaces a failing commit hook as an io error with its output', async () => {
    await mkdir(path.join(repo, '.git', 'hooks'), { recursive: true });
    const hook = path.join(repo, '.git', 'hooks', 'pre-commit');
    await writeFile(hook, '#!/bin/sh\necho "lint failed on stdout"\nexit 1\n', { mode: 0o755 });
    await writeFile(path.join(repo, 'a.txt'), 'one\n');
    await client.stage(repo, ['a.txt']);

    await expect(client.commit(repo, 'msg', false)).rejects.toMatchObject({
      kind: 'io',
      details: { stderr: expect.stringContaining('lint failed on stdout') },
    });
  });

  it('reports an in-progress merge as state "merging"', async () => {
    await commitFile(repo, 'a.txt', 'base\n');
    const git = simpleGit(repo);
    await git.checkoutLocalBranch('other');
    await commitFile(repo, 'a.txt', 'theirs\n');
    await git.checkout('-');
    await commitFile(repo, 'a.txt', 'ours\n');
    await git.merge(['other']).catch(() => undefined);

    const status = await client.status(repo);
    expect(status).toMatchObject({ isRepo: true, state: 'merging' });
    expect(filesOf(status)[0]).toMatchObject({ path: 'a.txt', conflicted: true });
  });
});
