import { isAbsolute, join, sep } from 'node:path';
import type { FileBrowserEntry, FileBrowserPort, FilePreview } from '../ports/file-browser-port.js';
import { DomainError } from '../../domain/errors.js';

function withSep(p: string): string {
  return p.endsWith(sep) ? p : `${p}${sep}`;
}

const LIST_FOLDERS_MAX_DEPTH = 4;
const LIST_FOLDERS_MAX = 1000;

export class FileBrowserService {
  constructor(
    private readonly port: FileBrowserPort,
    private readonly rootPath: string,
  ) {}

  async listDir(relPath: string, showHidden = false): Promise<FileBrowserEntry[]> {
    return this.port.listDir(await this.resolveSafe(relPath), { showHidden });
  }

  /**
   * Every non-hidden folder under the root as a root-relative path, breadth-first
   * so the shallow ones survive the cap — the folder picker's candidate list.
   */
  async listFolders(): Promise<string[]> {
    const folders: string[] = [];
    let level = [''];
    for (let depth = 0; depth < LIST_FOLDERS_MAX_DEPTH && level.length > 0; depth++) {
      const next: string[] = [];
      for (const relPath of level) {
        const entries = await this.listDir(relPath).catch(() => []);
        for (const entry of entries) {
          if (entry.kind !== 'dir' || entry.name === 'node_modules') continue;
          const child = relPath === '' ? entry.name : `${relPath}/${entry.name}`;
          folders.push(child);
          next.push(child);
          if (folders.length >= LIST_FOLDERS_MAX) return folders;
        }
      }
      level = next;
    }
    return folders;
  }

  async readFile(relPath: string): Promise<FilePreview> {
    return this.port.readFile(await this.resolveSafe(relPath));
  }

  async writeFile(relPath: string, content: string): Promise<void> {
    return this.port.writeFile(await this.resolveSafe(relPath), content);
  }

  async resolveAbsolutePath(relPath: string): Promise<string> {
    return this.resolveSafe(relPath);
  }

  private async resolveSafe(relPath: string): Promise<string> {
    if (isAbsolute(relPath) || relPath.split(/[/\\]/).includes('..')) {
      throw new DomainError('validation', `Path escapes the workspace root: ${relPath}`);
    }
    const candidate = join(this.rootPath, relPath);
    if (candidate !== this.rootPath && !candidate.startsWith(withSep(this.rootPath))) {
      throw new DomainError('validation', `Path escapes the workspace root: ${relPath}`);
    }

    let real: string;
    try {
      real = await this.port.realpath(candidate);
    } catch (err) {
      if (err instanceof DomainError && err.kind === 'not_found') return candidate;
      throw err;
    }
    const realRoot = await this.port.realpath(this.rootPath).catch(() => this.rootPath);
    if (real !== realRoot && !real.startsWith(withSep(realRoot))) {
      throw new DomainError('validation', `Path escapes the workspace root (symlink): ${relPath}`);
    }
    return candidate;
  }
}
