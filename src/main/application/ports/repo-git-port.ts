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
}
