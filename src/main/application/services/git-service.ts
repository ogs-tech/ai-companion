import type { RepoGitPort } from '../ports/repo-git-port.js';
import type { ProjectService } from './project-service.js';
import type { WorkspaceService } from './workspace-service.js';
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
  projectService: Pick<ProjectService, 'get'>;
  workspaceService: Pick<WorkspaceService, 'getActive'>;
}

/**
 * The `git` namespace's use cases over a Project's (or the workspace root's)
 * repository. Resolves the target on every call — a Project's path can change —
 * and runs mutations on the same root one at a time; reads bypass the queue.
 */
export class GitService {
  private readonly queues = new Map<string, TaskQueue>();

  constructor(
    private readonly port: RepoGitPort,
    private readonly deps: GitServiceDeps,
  ) {}

  async status(projectId?: string): Promise<GitStatus> {
    return this.port.status(await this.resolveRoot(projectId));
  }

  async diff(
    projectId: string | undefined,
    path: string,
    source: GitDiffSource,
  ): Promise<GitFileDiff> {
    assertRepoPath(path);
    if (source.kind === 'commit') {
      throw new DomainError('validation', "Diff source 'commit' is not supported yet");
    }
    const root = await this.resolveRepo(projectId);
    return this.port.diff(root, path, source.kind);
  }

  async stage(projectId: string | undefined, paths: string[]): Promise<void> {
    assertRepoPaths(paths);
    await this.mutate(projectId, (root) => this.port.stage(root, paths));
  }

  async unstage(projectId: string | undefined, paths: string[]): Promise<void> {
    assertRepoPaths(paths);
    await this.mutate(projectId, (root) => this.port.unstage(root, paths));
  }

  async discard(projectId: string | undefined, paths: string[]): Promise<void> {
    assertRepoPaths(paths);
    await this.mutate(projectId, (root) => this.port.discard(root, paths));
  }

  async commit(
    projectId: string | undefined,
    message: string,
    amend: boolean,
  ): Promise<GitCommitResult> {
    if (message.trim().length === 0) throw new DomainError('validation', 'Commit message is empty');
    return this.mutate(projectId, async (root) => {
      if (!amend) {
        const status = await this.port.status(root);
        const staged = status.isRepo && status.files.some(isStaged);
        if (!staged) throw new DomainError('validation', 'Nothing staged to commit');
      }
      return this.port.commit(root, message, amend);
    });
  }

  async init(projectId?: string): Promise<void> {
    const root = await this.resolveRoot(projectId);
    await this.queueFor(root)(async () => {
      if (await this.port.isRepo(root)) {
        throw new GitConflictError(`Already a git repository: ${root}`);
      }
      await this.port.init(root);
    });
  }

  private async mutate<T>(
    projectId: string | undefined,
    task: (root: string) => Promise<T>,
  ): Promise<T> {
    const root = await this.resolveRepo(projectId);
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
  private async resolveRepo(projectId: string | undefined): Promise<string> {
    const root = await this.resolveRoot(projectId);
    if (!(await this.port.isRepo(root))) throw new NotARepositoryError(root);
    return root;
  }

  // Same projectId? → root convention as the openWith handlers; consolidating
  // the two is tracked separately (open-with handler DRY debt).
  private async resolveRoot(projectId: string | undefined): Promise<string> {
    if (projectId !== undefined) return (await this.deps.projectService.get(projectId)).path;
    return (await this.deps.workspaceService.getActive()).rootPath;
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
