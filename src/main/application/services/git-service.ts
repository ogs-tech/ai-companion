import type { RepoGitPort } from '../ports/repo-git-port.js';
import type { Workspace } from '../../../shared/workspace.js';
import { createTaskQueue, type TaskQueue } from '../task-queue.js';
import { DomainError } from '../../domain/errors.js';
import { GitConflictError, NotARepositoryError } from '../../domain/git-errors.js';
import type {
  GitCommitResult,
  GitDiffSource,
  GitFileChange,
  GitBranchHead,
  GitFileDiff,
  GitStatus,
  GitSyncResult,
} from '../../../shared/git.js';
import { syncActionFor } from '../../../shared/git.js';

export interface GitServiceDeps {
  /** The workspace this graph was built for — `null` at Início, where every call fails `validation`. */
  activeWorkspace: Pick<Workspace, 'rootPath'> | null;
}

/**
 * The `git` namespace's use cases over the open workspace root's repository.
 * Runs mutations one at a time; reads bypass the queue.
 */
export class GitService {
  private readonly queues = new Map<string, TaskQueue>();

  constructor(
    private readonly port: RepoGitPort,
    private readonly deps: GitServiceDeps,
  ) {}

  async status(): Promise<GitStatus> {
    return this.port.status(this.resolveRoot());
  }

  async diff(path: string, source: GitDiffSource): Promise<GitFileDiff> {
    assertRepoPath(path);
    if (source.kind === 'commit') {
      throw new DomainError('validation', "Diff source 'commit' is not supported yet");
    }
    const root = await this.resolveRepo();
    return this.port.diff(root, path, source.kind);
  }

  async stage(paths: string[]): Promise<void> {
    assertRepoPaths(paths);
    await this.mutate((root) => this.port.stage(root, paths));
  }

  async unstage(paths: string[]): Promise<void> {
    assertRepoPaths(paths);
    await this.mutate((root) => this.port.unstage(root, paths));
  }

  async discard(paths: string[]): Promise<void> {
    assertRepoPaths(paths);
    await this.mutate((root) => this.port.discard(root, paths));
  }

  async commit(message: string, amend: boolean): Promise<GitCommitResult> {
    if (message.trim().length === 0) throw new DomainError('validation', 'Commit message is empty');
    return this.mutate(async (root) => {
      if (!amend) {
        const status = await this.port.status(root);
        const staged = status.isRepo && status.files.some(isStaged);
        if (!staged) throw new DomainError('validation', 'Nothing staged to commit');
      }
      return this.port.commit(root, message, amend);
    });
  }

  /** Pushes the branch; publishes it (`--set-upstream`) when it has no upstream yet. */
  async push(): Promise<void> {
    await this.mutate(async (root) => {
      const head = await this.syncableHead(root);
      await this.port.push(root, { setUpstream: head.upstream === undefined });
    });
  }

  async pull(): Promise<void> {
    await this.mutate(async (root) => {
      await this.requireUpstream(await this.syncableHead(root));
      await this.port.pull(root);
    });
  }

  async fetch(): Promise<void> {
    await this.mutate(async (root) => {
      await this.syncableHead(root);
      await this.port.fetch(root);
    });
  }

  /**
   * The smart button: runs whatever {@link syncActionFor} says for the current
   * state. Diverged branches pull `--ff-only` first and never create a merge;
   * a failure names the half (pull or push) that failed.
   */
  async sync(): Promise<GitSyncResult> {
    return this.mutate(async (root) => {
      const status = await this.port.status(root);
      const action = syncActionFor(status);
      if (action === 'none') throw new DomainError('validation', unsyncableReason(status));
      switch (action) {
        case 'publish':
          await this.port.push(root, { setUpstream: true });
          break;
        case 'push':
          await this.port.push(root, { setUpstream: false });
          break;
        case 'pull':
          await this.port.pull(root);
          break;
        case 'fetch':
          await this.port.fetch(root);
          break;
        case 'sync':
          await inHalf('Pull', () => this.port.pull(root));
          await inHalf('Pull concluído, mas o push', () => this.port.push(root, { setUpstream: false }));
          break;
      }
      return { action };
    });
  }

  async init(): Promise<void> {
    const root = this.resolveRoot();
    await this.queueFor(root)(async () => {
      if (await this.port.isRepo(root)) {
        throw new GitConflictError(`Already a git repository: ${root}`);
      }
      await this.port.init(root);
    });
  }

  private async mutate<T>(task: (root: string) => Promise<T>): Promise<T> {
    const root = await this.resolveRepo();
    return this.queueFor(root)(() => task(root));
  }

  /** The branch head, once the repo is in a state where sync makes sense. */
  private async syncableHead(root: string): Promise<GitBranchHead> {
    const status = await this.port.status(root);
    if (!status.isRepo) throw new NotARepositoryError(root);
    if (status.state !== 'clean') throw new DomainError('validation', unsyncableReason(status));
    if (status.head.name === null || status.head.oid === null) {
      throw new DomainError('validation', unsyncableReason(status));
    }
    return status.head;
  }

  private requireUpstream(head: GitBranchHead): void {
    if (head.upstream === undefined) {
      throw new DomainError('validation', `Branch '${head.name}' has no upstream — publish it first`);
    }
  }

  private queueFor(root: string): TaskQueue {
    let queue = this.queues.get(root);
    if (!queue) {
      queue = createTaskQueue();
      this.queues.set(root, queue);
    }
    return queue;
  }

  /** Like {@link resolveRoot}, but the target must be a repository (`not_found` otherwise). */
  private async resolveRepo(): Promise<string> {
    const root = this.resolveRoot();
    if (!(await this.port.isRepo(root))) throw new NotARepositoryError(root);
    return root;
  }

  private resolveRoot(): string {
    const workspace = this.deps.activeWorkspace;
    if (workspace === null) throw new DomainError('validation', 'No workspace is open — git needs one');
    return workspace.rootPath;
  }
}

function unsyncableReason(status: GitStatus): string {
  if (!status.isRepo) return 'Not a git repository';
  if (status.state !== 'clean') return `A ${status.state} is in progress — finish it before syncing`;
  if (status.head.name === null) return 'HEAD is detached — check out a branch before syncing';
  return 'The branch has no commits yet';
}

/** Re-raises a domain failure with the failed half named, keeping its kind and details. */
async function inHalf(label: string, task: () => Promise<void>): Promise<void> {
  try {
    await task();
  } catch (err) {
    if (!(err instanceof DomainError)) throw err;
    throw new DomainError(err.kind, `${label} falhou: ${err.message}`, err.details);
  }
}

/** Staged = has an index-side change (untracked files are never staged). */
export function isStaged(file: Pick<GitFileChange, 'index'>): boolean {
  return file.index !== 'unmodified' && file.index !== 'untracked';
}

function assertRepoPaths(paths: string[]): void {
  if (paths.length === 0) throw new DomainError('validation', "'paths' is empty");
  paths.forEach(assertRepoPath);
}

/**
 * Repo-relative only: no absolute path, no `..` segment, no NUL. Paths reach
 * git after `--`, so a leading `-` is harmless and allowed.
 */
function assertRepoPath(path: string): void {
  const invalid =
    path.length === 0 ||
    path.includes('\0') ||
    path.startsWith('/') ||
    /^[A-Za-z]:[\\/]/.test(path) ||
    path.split(/[\\/]/).includes('..');
  if (invalid)
    throw new DomainError('validation', `Invalid repo-relative path: ${JSON.stringify(path)}`);
}
