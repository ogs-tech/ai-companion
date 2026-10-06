// Types for the `git` IPC namespace — a git client over a Project's (or the
// workspace root's) own repository. See docs/reference/ipc-contract.md, "git".

export type GitChange =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'typechange'
  | 'untracked'
  | 'unmodified';

export interface GitFileChange {
  /** Repo-relative, forward slashes. */
  path: string;
  /** Renames/copies only. */
  origPath?: string;
  /** X column of porcelain v2. */
  index: GitChange;
  /** Y column of porcelain v2. */
  worktree: GitChange;
  /** Unmerged (`u`) record. */
  conflicted: boolean;
}

export type GitRepoState = 'clean' | 'merging' | 'rebasing' | 'cherry-picking' | 'reverting';

export interface GitBranchHead {
  /** null when detached. */
  name: string | null;
  /** null on an unborn branch. */
  oid: string | null;
  upstream?: string;
  ahead: number;
  behind: number;
}

export type GitStatus =
  | { isRepo: false }
  | {
      isRepo: true;
      head: GitBranchHead;
      state: GitRepoState;
      files: GitFileChange[];
      truncated: boolean;
    };

export type GitDiffSource =
  | { kind: 'worktree' } // index → worktree
  | { kind: 'index' } // HEAD → index
  | { kind: 'commit'; sha: string }; // sha^ → sha (Phase D)

export interface GitDiffLine {
  kind: 'context' | 'add' | 'del';
  text: string;
  oldNo?: number;
  newNo?: number;
}

export interface GitHunk {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: GitDiffLine[];
}

export type GitFileDiff =
  | { kind: 'text'; path: string; oldPath?: string; hunks: GitHunk[] }
  | { kind: 'binary'; path: string }
  | { kind: 'too-large'; path: string; bytes: number };

/** Every `git.*` method accepts this; absent `projectId` targets the active workspace's root. */
export interface GitTargetParams {
  projectId?: string;
}

export interface GitDiffParams extends GitTargetParams {
  path: string;
  source: GitDiffSource;
}

export interface GitPathsParams extends GitTargetParams {
  paths: string[];
}

export interface GitCommitParams extends GitTargetParams {
  message: string;
  amend?: boolean;
}

export interface GitCommitResult {
  sha: string;
}

/** `GitStatus.files` cap — beyond it the list is cut and `truncated` is set. */
export const GIT_STATUS_FILE_LIMIT = 5_000;
