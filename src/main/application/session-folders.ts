import { createHash } from 'node:crypto';
import { basename, join } from 'node:path';
import type { FileSystemPort } from './ports/filesystem-port.js';

type LinkFs = Pick<FileSystemPort, 'lstat' | 'readlink' | 'symlink' | 'mkdir' | 'unlink' | 'readdir' | 'pathExists'>;

/** The `.claude/` subfolders whose entries are merged across the shared set and every ticked folder. */
const MERGED_DIRS = ['skills', 'agents', 'commands'] as const;

/**
 * The working directory for a session that sees two or more folders as equals:
 * a helper directory under the workspace's own home, holding links to exactly
 * those folders. Its own `.claude/` is assembled from the workspace's shared
 * `.claude/` and each folder's `.claude/` — skills, agents and commands are
 * linked entry by entry (the shared set wins a name clash, then folder order),
 * so what the folders hold loads too. Same folder set → same directory,
 * reused. Folders left out are not linked, so they are completely outside the
 * session.
 */
export async function prepareMultiFolderCwd(
  fs: LinkFs,
  workspaceHome: string,
  folders: readonly string[],
): Promise<string> {
  const sorted = [...folders].sort();
  const key = createHash('sha1').update(sorted.join('\n')).digest('hex').slice(0, 10);
  const dir = join(workspaceHome, 'sessions', key);
  await fs.mkdir(dir, { recursive: true });

  const used = new Set<string>(['.claude']);
  const link = async (name: string, target: string): Promise<void> => {
    const path = join(dir, name);
    const existing = await fs.lstat(path);
    if (existing.kind === 'symlink' && (await fs.readlink(path)) === target) return;
    if (existing.kind !== 'none') return; // never clobber something that is not our link
    await fs.symlink({ target, path });
  };

  for (const folder of sorted) {
    let name = basename(folder) || 'folder';
    for (let n = 2; used.has(name); n++) name = `${basename(folder)}-${n}`;
    used.add(name);
    await link(name, folder);
  }
  await assembleClaudeDir(fs, join(dir, '.claude'), join(workspaceHome, '.claude'), sorted.map((f) => join(f, '.claude')));
  return dir;
}

async function listDir(fs: LinkFs, path: string): Promise<string[]> {
  return (await fs.pathExists(path)) ? (await fs.readdir(path)).filter((n) => !n.startsWith('.')) : [];
}

/**
 * Builds `dest` (a real directory) so Claude Code finds the shared set and
 * every folder's own skills/agents/commands. Only symlinks are ever replaced
 * or removed; links that no longer belong are dropped so a folder taken out of
 * the session stops contributing.
 */
async function assembleClaudeDir(fs: LinkFs, dest: string, shared: string, folderDirs: readonly string[]): Promise<void> {
  const current = await fs.lstat(dest);
  if (current.kind === 'symlink') await fs.unlink(dest); // legacy: a single link to the shared set
  else if (current.kind !== 'none' && current.kind !== 'directory') return; // not ours
  await fs.mkdir(dest, { recursive: true });

  const sync = async (dir: string, wanted: Map<string, string>): Promise<void> => {
    for (const name of await listDir(fs, dir)) {
      const path = join(dir, name);
      const entry = await fs.lstat(path);
      if (entry.kind !== 'symlink') continue;
      if (wanted.get(name) !== (await fs.readlink(path))) await fs.unlink(path);
    }
    for (const [name, target] of wanted) {
      const path = join(dir, name);
      if ((await fs.lstat(path)).kind === 'none') await fs.symlink({ target, path });
    }
  };

  // Top level of the shared set (CLAUDE.md, settings…), minus the merged folders.
  const top = new Map<string, string>();
  for (const name of await listDir(fs, shared)) if (!(MERGED_DIRS as readonly string[]).includes(name)) top.set(name, join(shared, name));
  await sync(dest, top);

  for (const sub of MERGED_DIRS) {
    const wanted = new Map<string, string>();
    for (const source of [shared, ...folderDirs]) {
      for (const name of await listDir(fs, join(source, sub))) if (!wanted.has(name)) wanted.set(name, join(source, sub, name));
    }
    const subDir = join(dest, sub);
    if (wanted.size === 0 && !(await fs.pathExists(subDir))) continue;
    await fs.mkdir(subDir, { recursive: true });
    await sync(subDir, wanted);
  }
}
