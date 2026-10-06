import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GitService } from '../../../../src/main/application/services/git-service.js';
import { FakeRepoGitPort } from '../../../../src/main/application/services/__fixtures__/fake-repo-git-port.js';
import { DomainError } from '../../../../src/main/domain/errors.js';

const WORKSPACE_ROOT = '/ws';
const PROJECT_ROOT = '/ws/app';

function setup() {
  const port = new FakeRepoGitPort();
  port.repos.add(WORKSPACE_ROOT);
  port.repos.add(PROJECT_ROOT);
  const projectService = {
    get: vi.fn(async (id: string) => {
      if (id !== 'p1') throw new DomainError('not_found', `Project not found: ${id}`);
      return { id, name: 'app', path: PROJECT_ROOT, createdAt: '' };
    }),
  };
  const workspaceService = { getActive: vi.fn(async () => ({ rootPath: WORKSPACE_ROOT })) };
  const service = new GitService(port, {
    projectService,
    workspaceService: workspaceService as never,
  });
  return { port, service, projectService };
}

describe('GitService', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  describe('root resolution', () => {
    it('targets the active workspace root without a projectId', async () => {
      await ctx.service.status();
      expect(ctx.port.calls).toEqual([{ op: 'status', root: WORKSPACE_ROOT }]);
    });

    it("targets the Project's path with a projectId, resolved on every call", async () => {
      await ctx.service.status('p1');
      await ctx.service.status('p1');
      expect(ctx.port.calls.map((c) => c.root)).toEqual([PROJECT_ROOT, PROJECT_ROOT]);
      expect(ctx.projectService.get).toHaveBeenCalledTimes(2);
    });

    it('raises not_found for an unknown projectId', async () => {
      await expect(ctx.service.status('nope')).rejects.toMatchObject({ kind: 'not_found' });
    });

    it('reports a non-repo from status but rejects mutations with not_found', async () => {
      ctx.port.repos.delete(WORKSPACE_ROOT);
      expect(await ctx.service.status()).toEqual({ isRepo: false });
      await expect(ctx.service.stage(undefined, ['a.ts'])).rejects.toMatchObject({
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
      await expect(ctx.service.stage(undefined, ['ok.ts', bad])).rejects.toMatchObject({
        kind: 'validation',
      });
      expect(ctx.port.calls).toEqual([]);
    });

    it('allows a leading dash (paths always follow `--`)', async () => {
      await ctx.service.stage(undefined, ['-rf']);
      expect(ctx.port.calls).toContainEqual({ op: 'stage', root: WORKSPACE_ROOT, paths: ['-rf'] });
    });

    it('rejects an empty paths list', async () => {
      await expect(ctx.service.discard(undefined, [])).rejects.toMatchObject({
        kind: 'validation',
      });
    });
  });

  describe('diff', () => {
    it('passes the source kind through', async () => {
      await ctx.service.diff('p1', 'a.ts', { kind: 'index' });
      expect(ctx.port.calls).toContainEqual({
        op: 'diff',
        root: PROJECT_ROOT,
        path: 'a.ts',
        source: 'index',
      });
    });

    it('rejects the commit source until history ships', async () => {
      await expect(
        ctx.service.diff(undefined, 'a.ts', { kind: 'commit', sha: 'abc' }),
      ).rejects.toMatchObject({
        kind: 'validation',
      });
    });
  });

  describe('commit', () => {
    it('rejects a blank message', async () => {
      await expect(ctx.service.commit(undefined, '  \n', false)).rejects.toMatchObject({
        kind: 'validation',
      });
    });

    it('rejects when nothing is staged, unless amending', async () => {
      ctx.port.files = [
        { path: 'a.ts', index: 'unmodified', worktree: 'modified', conflicted: false },
      ];
      await expect(ctx.service.commit(undefined, 'msg', false)).rejects.toMatchObject({
        kind: 'validation',
      });
      await expect(ctx.service.commit(undefined, 'msg', true)).resolves.toEqual({ sha: 'new-sha' });
    });

    it('commits when something is staged', async () => {
      ctx.port.files = [
        { path: 'a.ts', index: 'modified', worktree: 'unmodified', conflicted: false },
      ];
      await expect(ctx.service.commit('p1', 'msg', false)).resolves.toEqual({ sha: 'new-sha' });
      expect(ctx.port.calls).toContainEqual({
        op: 'commit',
        root: PROJECT_ROOT,
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
      const first = ctx.service.stage(undefined, ['a.ts']);
      const second = ctx.service.unstage(undefined, ['b.ts']);

      await vi.waitFor(() => expect(ctx.port.calls.map((c) => c.op)).toEqual(['stage']));
      release();
      await Promise.all([first, second]);

      expect(ctx.port.calls.map((c) => c.op)).toEqual(['stage', 'unstage']);
    });

    it('does not block a mutation on a different root', async () => {
      const release = ctx.port.hold('stage');
      const blocked = ctx.service.stage(undefined, ['a.ts']);
      await ctx.service.discard('p1', ['b.ts']);
      expect(ctx.port.calls.map((c) => c.op)).toEqual(['stage', 'discard']);
      release();
      await blocked;
    });

    it('keeps the queue alive after a failed mutation', async () => {
      await expect(ctx.service.commit(undefined, 'msg', false)).rejects.toMatchObject({
        kind: 'validation',
      });
      await expect(ctx.service.stage(undefined, ['a.ts'])).resolves.toBeUndefined();
    });
  });
});
