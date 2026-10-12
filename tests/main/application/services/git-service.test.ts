import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GitService } from '../../../../src/main/application/services/git-service.js';
import { FakeRepoGitPort } from '../../../../src/main/application/services/__fixtures__/fake-repo-git-port.js';

const WORKSPACE_ROOT = '/ws';

function setup(activeRoot: string | null = WORKSPACE_ROOT) {
  const port = new FakeRepoGitPort();
  port.repos.add(WORKSPACE_ROOT);
  const service = new GitService(port, { activeWorkspace: activeRoot === null ? null : { rootPath: activeRoot } });
  return { port, service };
}

describe('GitService', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  describe('root resolution', () => {
    it('targets the open workspace root', async () => {
      await ctx.service.status();
      expect(ctx.port.calls).toEqual([{ op: 'status', root: WORKSPACE_ROOT }]);
    });

    it('fails validation for every call when no workspace is open (Início)', async () => {
      const home = setup(null);
      await expect(home.service.status()).rejects.toMatchObject({ kind: 'validation' });
      await expect(home.service.stage(['a.ts'])).rejects.toMatchObject({ kind: 'validation' });
      await expect(home.service.init()).rejects.toMatchObject({ kind: 'validation' });
      expect(home.port.calls).toEqual([]);
    });

    it('reports a non-repo from status but rejects mutations with not_found', async () => {
      ctx.port.repos.delete(WORKSPACE_ROOT);
      expect(await ctx.service.status()).toEqual({ isRepo: false });
      await expect(ctx.service.stage(['a.ts'])).rejects.toMatchObject({
        kind: 'not_found',
      });
    });
  });

  describe('path validation', () => {
    it.each([
      ['/etc/passwd'],
      ['../escape'],
      ['a/../../b'],
      ['a\\..\\b'],
      ['bad\0name'],
      [''],
      ['C:\\x'],
    ])('rejects %j', async (bad) => {
      await expect(ctx.service.stage(['ok.ts', bad])).rejects.toMatchObject({
        kind: 'validation',
      });
      expect(ctx.port.calls).toEqual([]);
    });

    it('allows a leading dash (paths always follow `--`)', async () => {
      await ctx.service.stage(['-rf']);
      expect(ctx.port.calls).toContainEqual({ op: 'stage', root: WORKSPACE_ROOT, paths: ['-rf'] });
    });

    it('rejects an empty paths list', async () => {
      await expect(ctx.service.discard([])).rejects.toMatchObject({
        kind: 'validation',
      });
    });
  });

  describe('diff', () => {
    it('passes the source kind through', async () => {
      await ctx.service.diff('a.ts', { kind: 'index' });
      expect(ctx.port.calls).toContainEqual({
        op: 'diff',
        root: WORKSPACE_ROOT,
        path: 'a.ts',
        source: 'index',
      });
    });

    it('rejects the commit source until history ships', async () => {
      await expect(
        ctx.service.diff('a.ts', { kind: 'commit', sha: 'abc' }),
      ).rejects.toMatchObject({
        kind: 'validation',
      });
    });
  });

  describe('commit', () => {
    it('rejects a blank message', async () => {
      await expect(ctx.service.commit('  \n', false)).rejects.toMatchObject({
        kind: 'validation',
      });
    });

    it('rejects when nothing is staged, unless amending', async () => {
      ctx.port.files = [
        { path: 'a.ts', index: 'unmodified', worktree: 'modified', conflicted: false },
      ];
      await expect(ctx.service.commit('msg', false)).rejects.toMatchObject({
        kind: 'validation',
      });
      await expect(ctx.service.commit('msg', true)).resolves.toEqual({ sha: 'new-sha' });
    });

    it('commits when something is staged', async () => {
      ctx.port.files = [
        { path: 'a.ts', index: 'modified', worktree: 'unmodified', conflicted: false },
      ];
      await expect(ctx.service.commit('msg', false)).resolves.toEqual({ sha: 'new-sha' });
      expect(ctx.port.calls).toContainEqual({
        op: 'commit',
        root: WORKSPACE_ROOT,
        message: 'msg',
        amend: false,
      });
    });
  });

  describe('init', () => {
    it('initializes a non-repo', async () => {
      ctx.port.repos.delete(WORKSPACE_ROOT);
      await ctx.service.init();
      expect(ctx.port.calls).toContainEqual({ op: 'init', root: WORKSPACE_ROOT });
    });

    it('raises conflict on an existing repo', async () => {
      await expect(ctx.service.init()).rejects.toMatchObject({ kind: 'conflict' });
    });
  });

  describe('mutation serialization', () => {
    it('runs two mutations on the same root in order', async () => {
      const release = ctx.port.hold('stage');
      const first = ctx.service.stage(['a.ts']);
      const second = ctx.service.unstage(['b.ts']);

      await vi.waitFor(() => expect(ctx.port.calls.map((c) => c.op)).toEqual(['stage']));
      release();
      await Promise.all([first, second]);

      expect(ctx.port.calls.map((c) => c.op)).toEqual(['stage', 'unstage']);
    });

    it('keeps the queue alive after a failed mutation', async () => {
      await expect(ctx.service.commit('msg', false)).rejects.toMatchObject({
        kind: 'validation',
      });
      await expect(ctx.service.stage(['a.ts'])).resolves.toBeUndefined();
    });
  });
});
