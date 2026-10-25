import { existsSync } from 'node:fs';
import { lstat, mkdtemp, readFile, readlink, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { simpleGit, GitPluginError, type SimpleGit } from 'simple-git';
import type { RepoGitPort } from '../../application/ports/repo-git-port.js';
import {
  GIT_STATUS_FILE_LIMIT,
  type GitFileDiff,
  type GitRepoState,
  type GitStatus,
} from '../../../shared/git.js';
import { GitCommandError } from '../../domain/git-errors.js';
import { classifyGitError, truncateStderr } from './classify-git-error.js';
import { addedFileDiff, parseFileDiff } from './parsers/diff.js';
import { truncateDiff } from './parsers/truncate-diff.js';
import { parseStatus } from './parsers/status.js';

const LOCAL_TIMEOUT_MS = 30_000;
/** Network ops get more room; the timeout is per silent period, not total. */
const REMOTE_TIMEOUT_MS = 120_000;

/**
 * Every spawned git is non-interactive and produces stable, parseable C-locale
 * messages; reads never take optional locks, so polling `status` can't fight a
 * running `claude` session over `index.lock`.
 */
const GIT_ENV: Record<string, string> = {
  GIT_TERMINAL_PROMPT: '0',
  GIT_EDITOR: 'true',
  GIT_MERGE_AUTOEDIT: 'no',
  GIT_PAGER: 'cat',
  GIT_OPTIONAL_LOCKS: '0',
  LC_ALL: 'C',
};

/** Lockfiles and generated output: they appear in `--stat` but never in the diff sent to a model. */
const DIFF_EXCLUDES = [
  '*.lock',
  '*lock.json',
  '*lock.yaml',
  'go.sum',
  '*.min.js',
  '*.min.css',
  '*.map',
  '*.snap',
  'dist/**',
  'build/**',
  'out/**',
].map((glob) => `:(exclude,glob)**/${glob}`);

/** Marker files under the git dir that name an in-progress operation, checked in this order. */
const STATE_MARKERS: ReadonlyArray<[string, GitRepoState]> = [
  ['rebase-merge', 'rebasing'],
  ['rebase-apply', 'rebasing'],
  ['MERGE_HEAD', 'merging'],
  ['CHERRY_PICK_HEAD', 'cherry-picking'],
  ['REVERT_HEAD', 'reverting'],
];

/** `RepoGitPort` over the system `git` binary, through `simple-git`. */
export class SimpleGitRepoClient implements RepoGitPort {
  async status(root: string): Promise<GitStatus> {
    if (!(await this.isRepo(root))) return { isRepo: false };

    const output = await this.run(root, [
      '--no-optional-locks',
      'status',
      '--porcelain=v2',
      '--branch',
      '-z',
      '--untracked-files=all',
    ]);
    const { head, files } = parseStatus(output);
    const truncated = files.length > GIT_STATUS_FILE_LIMIT;
    return {
      isRepo: true,
      head,
      state: await this.repoState(root),
      files: truncated ? files.slice(0, GIT_STATUS_FILE_LIMIT) : files,
      truncated,
    };
  }

  async diff(root: string, path: string, source: 'index' | 'worktree'): Promise<GitFileDiff> {
    if (source === 'worktree' && (await this.isUntracked(root, path))) {
      return addedFileDiff(await this.readWorktreeFile(root, path), path);
    }
    const args = ['--no-optional-locks', 'diff', '--no-color', '--no-ext-diff', '-U3'];
    if (source === 'index') args.push('--cached');
    return parseFileDiff(await this.run(root, [...args, '--', path]), path);
  }

  async stage(root: string, paths: string[]): Promise<void> {
    await this.run(root, ['add', '--', ...paths]);
  }

  async unstage(root: string, paths: string[]): Promise<void> {
    // `restore --staged` needs a HEAD to restore from; on an unborn branch
    // "unstaging" means dropping the entries from the index.
    if (await this.hasHead(root)) await this.run(root, ['restore', '--staged', '--', ...paths]);
    else await this.run(root, ['rm', '--cached', '--force', '--quiet', '--', ...paths]);
  }

  async discard(root: string, paths: string[]): Promise<void> {
    const tracked = new Set(
      (await this.run(root, ['ls-files', '-z', '--', ...paths]))
        .split('\0')
        .filter((p) => p.length > 0),
    );
    const restore = paths.filter((p) => tracked.has(p));
    const clean = paths.filter((p) => !tracked.has(p));
    if (restore.length > 0) await this.run(root, ['restore', '--worktree', '--', ...restore]);
    if (clean.length > 0) await this.run(root, ['clean', '--force', '--', ...clean]);
  }

  async commit(root: string, message: string, amend: boolean): Promise<{ sha: string }> {
    // The message goes through a file, never argv — it would show up in `ps`
    // and could be read as flags. simple-git has no stdin channel for `-F -`.
    const dir = await mkdtemp(join(tmpdir(), 'ai-companion-commit-'));
    try {
      const file = join(dir, 'COMMIT_EDITMSG');
      await writeFile(file, message, 'utf8');
      await this.run(root, ['commit', '--file', file, ...(amend ? ['--amend'] : [])]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
    return { sha: (await this.run(root, ['rev-parse', 'HEAD'])).trim() };
  }

  async push(root: string, options: { setUpstream: boolean }): Promise<void> {
    if (!options.setUpstream) {
      await this.runRemote(root, ['push']);
      return;
    }
    const branch = (await this.run(root, ['symbolic-ref', '--short', 'HEAD'])).trim();
    await this.runRemote(root, ['push', '--set-upstream', await this.publishRemote(root), branch]);
  }

  async pull(root: string): Promise<void> {
    await this.runRemote(root, ['pull', '--ff-only']);
  }

  async fetch(root: string): Promise<void> {
    await this.runRemote(root, ['fetch']);
  }

  async init(root: string): Promise<void> {
    await this.run(root, ['init']);
  }

  async stagedDiff(root: string, maxChars: number): Promise<{ diff: string; truncated: boolean }> {
    const output = await this.run(root, [
      '--no-optional-locks', 'diff', '--cached', '--no-color', '--no-ext-diff', '-U3',
      '--', '.', ...DIFF_EXCLUDES,
    ]);
    return truncateDiff(output, maxChars);
  }

  async stagedStat(root: string): Promise<string> {
    return this.run(root, ['--no-optional-locks', 'diff', '--cached', '--no-color', '--stat']);
  }

  async recentSubjects(root: string, count: number): Promise<string[]> {
    if (!(await this.hasHead(root))) return [];
    const output = await this.run(root, ['--no-optional-locks', 'log', `-${count}`, '--format=%s']);
    return output.split('\n').filter((line) => line.length > 0);
  }

  async commitTemplate(root: string): Promise<string | null> {
    let path: string;
    try {
      path = (await this.run(root, ['config', '--path', '--get', 'commit.template'])).trim();
    } catch {
      return null; // unset
    }
    if (path.length === 0) return null;
    try {
      return await readFile(isAbsolute(path) ? path : join(root, path), 'utf8');
    } catch {
      return null;
    }
  }

  /** The target itself must be the top level — a subfolder of a larger repo is not a repo here. */
  async isRepo(root: string): Promise<boolean> {
    if (!existsSync(root)) return false;
    let toplevel: string;
    try {
      toplevel = (await this.run(root, ['rev-parse', '--show-toplevel'])).trim();
    } catch (err) {
      if (err instanceof GitCommandError) throw err; // git missing, timeout, …
      return false; // NotARepositoryError and friends
    }
    // realpath on both: macOS tmp dirs (/var → /private/var) and symlinked project paths.
    return (await realpath(toplevel)) === (await realpath(root));
  }

  private async repoState(root: string): Promise<GitRepoState> {
    const gitDir = (await this.run(root, ['rev-parse', '--absolute-git-dir'])).trim();
    for (const [marker, state] of STATE_MARKERS) {
      if (existsSync(join(gitDir, marker))) return state;
    }
    return 'clean';
  }

  /** `origin` when it exists, else the first configured remote. */
  private async publishRemote(root: string): Promise<string> {
    const remotes = (await this.run(root, ['remote'])).split('\n').filter((r) => r.length > 0);
    const remote = remotes.includes('origin') ? 'origin' : remotes[0];
    if (remote === undefined) throw new GitCommandError('No remote configured');
    return remote;
  }

  /**
   * Network ops fail fast instead of waiting on a credential prompt: git's own
   * prompts are off (`GIT_TERMINAL_PROMPT`) and ssh runs in `BatchMode`, on top
   * of the user's own `GIT_SSH_COMMAND` / `core.sshCommand`.
   */
  private async runRemote(root: string, args: string[]): Promise<void> {
    const configured = await this.run(root, ['config', '--get', 'core.sshCommand']).catch(() => '');
    const ssh = process.env['GIT_SSH_COMMAND'] ?? (configured.trim() || 'ssh');
    try {
      await this.git(root, REMOTE_TIMEOUT_MS, { GIT_SSH_COMMAND: `${ssh} -o BatchMode=yes` }).raw(args);
    } catch (err) {
      throw toDomainError(err, root);
    }
  }

  private async hasHead(root: string): Promise<boolean> {
    try {
      await this.run(root, ['rev-parse', '--verify', '--quiet', 'HEAD']);
      return true;
    } catch {
      return false;
    }
  }

  private async isUntracked(root: string, path: string): Promise<boolean> {
    const listed = await this.run(root, ['ls-files', '-z', '--', path]);
    return listed.length === 0;
  }

  /** A symlink's diff is its target text, as git records it — never the file it points to. */
  private async readWorktreeFile(root: string, path: string): Promise<Buffer> {
    const abs = join(root, path);
    const stats = await lstat(abs);
    return stats.isSymbolicLink() ? Buffer.from(await readlink(abs), 'utf8') : readFile(abs);
  }

  private async run(root: string, args: string[]): Promise<string> {
    try {
      return await this.git(root).raw(args);
    } catch (err) {
      throw toDomainError(err, root);
    }
  }

  private git(root: string, timeoutMs = LOCAL_TIMEOUT_MS, extraEnv: Record<string, string> = {}): SimpleGit {
    return simpleGit({
      baseDir: root,
      timeout: { block: timeoutMs },
      // The env we set (editor/pager) and the user's own SSH/askpass setup are
      // deliberate; simple-git refuses them without these opt-ins.
      unsafe: {
        allowUnsafeEditor: true,
        allowUnsafePager: true,
        allowUnsafeSshCommand: true,
        allowUnsafeAskPass: true,
      },
      // Default detection ignores a non-zero exit with empty stderr (e.g. a
      // hook that reports on stdout) — treat every non-zero exit as failure.
      errors: (error, result) =>
        error ??
        (result.exitCode !== 0 ? Buffer.concat([...result.stdOut, ...result.stdErr]) : undefined),
    }).env({ ...process.env, ...GIT_ENV, ...extraEnv });
  }
}

function toDomainError(err: unknown, root: string): Error {
  if (err instanceof GitPluginError && err.plugin === 'timeout') {
    return new GitCommandError('GitTimeout');
  }
  const message = err instanceof Error ? err.message : String(err);
  if (/\bENOENT\b/.test(message) && /spawn/.test(message)) {
    return new GitCommandError('GitNotFound', { stderr: truncateStderr(message) });
  }
  return classifyGitError(message, root);
}
