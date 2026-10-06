import type { RepoGitPort } from '../../ports/repo-git-port.js';
import type { GitFileChange, GitFileDiff, GitStatus } from '../../../../shared/git.js';

export type RepoGitCall =
  | { op: 'status' | 'init'; root: string }
  | { op: 'diff'; root: string; path: string; source: 'index' | 'worktree' }
  | { op: 'stage' | 'unstage' | 'discard'; root: string; paths: string[] }
  | { op: 'commit'; root: string; message: string; amend: boolean };

/**
 * In-memory `RepoGitPort`: records every call and treats any root in `repos`
 * as a repository whose status lists `files`. `hold(op)` makes the next call
 * of that op wait until the returned release function is called — for
 * asserting mutation ordering.
 */
export class FakeRepoGitPort implements RepoGitPort {
  readonly calls: RepoGitCall[] = [];
  readonly repos = new Set<string>();
  files: GitFileChange[] = [];
  diffResult: GitFileDiff = { kind: 'text', path: '', hunks: [] };
  private readonly holds = new Map<string, Promise<void>>();

  hold(op: RepoGitCall['op']): () => void {
    let release!: () => void;
    this.holds.set(op, new Promise<void>((resolve) => (release = resolve)));
    return release;
  }

  async isRepo(root: string): Promise<boolean> {
    return this.repos.has(root);
  }

  async status(root: string): Promise<GitStatus> {
    this.calls.push({ op: 'status', root });
    if (!this.repos.has(root)) return { isRepo: false };
    return {
      isRepo: true,
      head: { name: 'main', oid: 'abc', ahead: 0, behind: 0 },
      state: 'clean',
      files: this.files,
      truncated: false,
    };
  }

  async diff(root: string, path: string, source: 'index' | 'worktree'): Promise<GitFileDiff> {
    this.calls.push({ op: 'diff', root, path, source });
    return this.diffResult;
  }

  async stage(root: string, paths: string[]): Promise<void> {
    await this.record({ op: 'stage', root, paths });
  }

  async unstage(root: string, paths: string[]): Promise<void> {
    await this.record({ op: 'unstage', root, paths });
  }

  async discard(root: string, paths: string[]): Promise<void> {
    await this.record({ op: 'discard', root, paths });
  }

  async commit(root: string, message: string, amend: boolean): Promise<{ sha: string }> {
    await this.record({ op: 'commit', root, message, amend });
    return { sha: 'new-sha' };
  }

  async init(root: string): Promise<void> {
    await this.record({ op: 'init', root });
    this.repos.add(root);
  }

  private async record(call: RepoGitCall): Promise<void> {
    this.calls.push(call);
    const held = this.holds.get(call.op);
    if (held) {
      this.holds.delete(call.op);
      await held;
    }
  }
}
