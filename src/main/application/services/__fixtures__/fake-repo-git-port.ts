import type { RepoGitPort } from '../../ports/repo-git-port.js';
import type { GitBranchHead, GitFileChange, GitFileDiff, GitRepoState, GitStatus } from '../../../../shared/git.js';

export type RepoGitCall =
  | { op: 'status' | 'init'; root: string }
  | { op: 'diff'; root: string; path: string; source: 'index' | 'worktree' }
  | { op: 'stage' | 'unstage' | 'discard'; root: string; paths: string[] }
  | { op: 'commit'; root: string; message: string; amend: boolean }
  | { op: 'push'; root: string; setUpstream: boolean }
  | { op: 'pull' | 'fetch'; root: string };

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
  head: GitBranchHead = { name: 'main', oid: 'abc', upstream: 'origin/main', ahead: 0, behind: 0 };
  state: GitRepoState = 'clean';
  /** Makes the next call of the op reject with this error. */
  readonly failures = new Map<string, Error>();
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
      head: this.head,
      state: this.state,
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

  async push(root: string, options: { setUpstream: boolean }): Promise<void> {
    await this.record({ op: 'push', root, setUpstream: options.setUpstream });
  }

  async pull(root: string): Promise<void> {
    await this.record({ op: 'pull', root });
  }

  async fetch(root: string): Promise<void> {
    await this.record({ op: 'fetch', root });
  }

  stagedStatText = '';
  stagedDiffResult = { diff: '', truncated: false };
  subjects: string[] = [];
  template: string | null = null;

  async stagedDiff(): Promise<{ diff: string; truncated: boolean }> {
    return this.stagedDiffResult;
  }

  async stagedStat(): Promise<string> {
    return this.stagedStatText;
  }

  async recentSubjects(): Promise<string[]> {
    return this.subjects;
  }

  async commitTemplate(): Promise<string | null> {
    return this.template;
  }

  async init(root: string): Promise<void> {
    await this.record({ op: 'init', root });
    this.repos.add(root);
  }

  private async record(call: RepoGitCall): Promise<void> {
    this.calls.push(call);
    const failure = this.failures.get(call.op);
    if (failure) {
      this.failures.delete(call.op);
      throw failure;
    }
    const held = this.holds.get(call.op);
    if (held) {
      this.holds.delete(call.op);
      await held;
    }
  }
}
