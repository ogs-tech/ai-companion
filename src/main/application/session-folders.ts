import { createHash } from 'node:crypto';
import { basename, join } from 'node:path';
import type { FileSystemPort } from './ports/filesystem-port.js';

type LinkFs = Pick<FileSystemPort, 'lstat' | 'readlink' | 'symlink' | 'mkdir'>;

/**
 * The working directory for a session that sees two or more folders as equals:
 * a helper directory under the workspace's own home, holding links to exactly
 * those folders (and to the workspace's shared `.claude/`, so the shared
 * customizations load). Same folder set → same directory, reused. Folders left
 * out are not linked, so they are completely outside the session.
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
  await link('.claude', join(workspaceHome, '.claude'));
  return dir;
}
