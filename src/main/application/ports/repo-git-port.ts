import type { GitFileDiff, GitStatus } from '../../../shared/git.js';

/**
 * Working-tree git operations on a user's repository. Separate from `GitPort`
 * (plugins/marketplaces): different callers, error vocabulary and safety rules.
 *
 * Every method takes the absolute repo `root` and repo-relative paths that the
 * caller has already validated. Failures surface as the classes in
 * `domain/git-errors.ts`.
 */
export interface RepoGitPort {
  /** True only when `root` is itself a repository's top level. */
  isRepo(root: string): Promise<boolean>;
  /** Never throws for a non-repo — reports `{ isRepo: false }`. */
  status(root: string): Promise<GitStatus>;
  /** `index` = HEAD → index; `worktree` = index → worktree (untracked files diff against /dev/null). */
  diff(root: string, path: string, source: 'index' | 'worktree'): Promise<GitFileDiff>;
  stage(root: string, paths: string[]): Promise<void>;
  unstage(root: string, paths: string[]): Promise<void>;
  /** Tracked paths back to the index; untracked paths removed. Never touches the index. */
  discard(root: string, paths: string[]): Promise<void>;
  commit(root: string, message: string, amend: boolean): Promise<{ sha: string }>;
  init(root: string): Promise<void>;
  /**
   * The staged diff, at most `maxChars` long. Lockfiles and generated files are
   * left out (they only show in {@link stagedStat}); past the cap it ends on a
   * file boundary and reports `truncated`.
   */
  stagedDiff(root: string, maxChars: number): Promise<{ diff: string; truncated: boolean }>;
  /** `git diff --staged --stat` — every staged file, lockfiles and binaries included. */
  stagedStat(root: string): Promise<string>;
  /** Subjects of the last `count` commits, newest first; `[]` on an unborn branch. */
  recentSubjects(root: string, count: number): Promise<string[]>;
  /** Contents of git's `commit.template`, or `null` when unset or unreadable. */
  commitTemplate(root: string): Promise<string | null>;
  /**
   * Sends the current branch to its upstream. With `setUpstream` it publishes to
   * the first remote (`origin` preferred) and tracks it. Never forces.
   */
  push(root: string, options: { setUpstream: boolean }): Promise<void>;
  /** `git pull --ff-only`: fails `GitNonFastForwardError` rather than merging or rebasing. */
  pull(root: string): Promise<void>;
  fetch(root: string): Promise<void>;
}
