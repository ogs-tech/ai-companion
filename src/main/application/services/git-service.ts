import type { RepoGitPort } from '../ports/repo-git-port.js';
import type { Workspace } from '../../../shared/workspace.js';
import { createTaskQueue, type TaskQueue } from '../task-queue.js';
import { DomainError } from '../../domain/errors.js';
import { GitConflictError, NotARepositoryError } from '../../domain/git-errors.js';
import type {
  GitCommitResult,
  GitDiffSource,
  GitFileChange,
  GitFileDiff,
  GitStatus,
} from '../../../shared/git.js';

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
