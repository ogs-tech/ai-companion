import type { WritableFileSystemPort } from '../ports/writable-filesystem-port.js';
import type { SettingsService } from './settings-service.js';
import type { Workspace } from '../../../shared/workspace.js';
import { workspaceFolders } from '../../../shared/workspace.js';
import { resolveGitIgnoreMode, type GitIgnoreMode } from '../../../shared/settings.js';

const START = '# ai-companion:start (managed by AI Companion — do not edit)';
const END = '# ai-companion:end';
/** Always hidden: the app's own data dir inside the folder. */
const DATA_DIR_ENTRY = '/.ai-companion/';

/** What the sync materialized, as absolute paths — supplied by `AdapterManager`. */
export interface ManagedPathsSource {
  managedPaths(): Promise<string[]>;
}

const stripBlock = (content: string): string => {
  const start = content.indexOf(START);
  if (start === -1) return content;
  const end = content.indexOf(END, start);
  if (end === -1) return content;
  const before = content.slice(0, start).replace(/\n+$/, '');
  const after = content.slice(end + END.length).replace(/^\n+/, '');
  return before === '' ? after : after === '' ? `${before}\n` : `${before}\n${after}`;
};

/**
 * Keeps the files the app generates inside a workspace's repos out of `git status`.
 *
 * Writes one delimited block per folder — to `.git/info/exclude` (`local`) or to
 * `.gitignore` (`gitignore`) — listing `.ai-companion/` plus only the symlinks and
 * generated files the app itself created under `.claude/` / `.cursor/`, so anything
 * the user wrote by hand there stays visible. Idempotent; `off` removes the block.
 * Never touches tracked files (no `git rm --cached`).
 */
export class GitIgnoreService {
  constructor(
    private readonly fs: WritableFileSystemPort,
    private readonly settings: Pick<SettingsService, 'load'>,
    private readonly workspace: Pick<Workspace, 'rootPath' | 'extraFolders'> | null,
    private readonly source: ManagedPathsSource,
  ) {}

  /** Best-effort: a failure here must never fail the sync or the workspace switch. */
  async apply(): Promise<void> {
    if (this.workspace === null) return;
    try {
      const mode = resolveGitIgnoreMode(await this.settings.load());
      const managed = mode === 'off' ? [] : await this.source.managedPaths();
      for (const folder of workspaceFolders(this.workspace)) {
        await this.applyToFolder(folder, mode, managed);
      }
    } catch (error) {
      console.error('[git-ignore] could not update ignore rules', error);
    }
  }

  private async applyToFolder(folder: string, mode: GitIgnoreMode, managed: string[]): Promise<void> {
    const git = await this.fs.lstat(`${folder}/.git`);
    if (git.kind === 'none') return;

    // A `.git` file (worktree/submodule) has no local info/exclude we can safely resolve.
    const exclude = git.kind === 'directory' ? `${folder}/.git/info/exclude` : null;
    const gitignore = `${folder}/.gitignore`;
    const target = mode === 'local' ? exclude : mode === 'gitignore' ? gitignore : null;

    const entries = [DATA_DIR_ENTRY, ...managed.filter((p) => p.startsWith(`${folder}/`)).map((p) => `/${p.slice(folder.length + 1)}`)];
    const block = `${START}\n${[...new Set(entries)].sort().join('\n')}\n${END}\n`;

    for (const file of [exclude, gitignore]) {
      if (file === null) continue;
      if (file === target) await this.writeBlock(file, block);
      else await this.removeBlock(file);
    }
  }

  private async readOrNull(file: string): Promise<string | null> {
    return (await this.fs.pathExists(file)) ? this.fs.readFile(file) : null;
  }

  private async writeBlock(file: string, block: string): Promise<void> {
    const current = await this.readOrNull(file);
    const base = stripBlock(current ?? '');
    const next = base === '' ? block : `${base.replace(/\n*$/, '\n')}\n${block}`;
    if (next === current) return;
    await this.fs.mkdir(file.slice(0, file.lastIndexOf('/')), { recursive: true });
    await this.fs.writeFile(file, next);
  }

  private async removeBlock(file: string): Promise<void> {
    const current = await this.readOrNull(file);
    if (current === null || !current.includes(START)) return;
    await this.fs.writeFile(file, stripBlock(current));
  }
}
