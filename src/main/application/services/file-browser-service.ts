import { isAbsolute, join, sep } from 'node:path';
import type { FileBrowserEntry, FileBrowserPort, FilePreview } from '../ports/file-browser-port.js';
import { folderAliases } from '../../../shared/workspace.js';
import { DomainError } from '../../domain/errors.js';

function withSep(p: string): string {
  return p.endsWith(sep) ? p : `${p}${sep}`;
}

const LIST_FOLDERS_MAX_DEPTH = 4;
const LIST_FOLDERS_MAX = 1000;

export class FileBrowserService {
  /**
   * With several folders the browser is virtual: the workspace root lists one
   * directory per folder, named by its alias, and every path below it starts
   * with that alias (`api/src/x.ts`). Callers keep using plain strings — the
   * tree, editor tabs and git decorations need no notion of folders.
   */
  private readonly aliasToFolder = new Map<string, string>();

  constructor(
    private readonly port: FileBrowserPort,
    private readonly rootPath: string,
    private readonly folders: readonly string[] = [rootPath],
  ) {
    if (folders.length > 1) {
      const [first, ...rest] = folders as [string, ...string[]];
      for (const [folder, alias] of Object.entries(folderAliases({ rootPath: first, extraFolders: rest }))) {
        this.aliasToFolder.set(alias, folder);
      }
    }
  }

  private get isVirtual(): boolean {
    return this.aliasToFolder.size > 0;
  }

  /** The single-folder browser for one of this workspace's folders. */
  forFolder(folder?: string): FileBrowserService {
    if (folder === undefined || (!this.isVirtual && folder === this.rootPath)) return this;
    if (!this.folders.includes(folder)) {
      throw new DomainError('validation', `${folder} is not a folder of the open workspace`, { reason: 'unknown-folder' });
    }
    return new FileBrowserService(this.port, folder, [folder]);
  }

  /** Splits a workspace-relative path into the folder's browser and the path inside it. */
  private route(relPath: string): { browser: FileBrowserService; rel: string } {
    if (!this.isVirtual) return { browser: this, rel: relPath };
    const [alias = '', ...rest] = relPath.split('/').filter((seg) => seg !== '');
    const folder = this.aliasToFolder.get(alias);
    if (folder === undefined) throw new DomainError('not_found', `No folder named '${alias}' in this workspace`);
    return { browser: this.forFolder(folder), rel: rest.join('/') };
  }

  private rootListing(): FileBrowserEntry[] {
    return [...this.aliasToFolder.keys()].map((name) => ({ name, kind: 'dir' as const }));
  }

  async listDir(relPath: string, showHidden = false): Promise<FileBrowserEntry[]> {
    if (this.isVirtual) {
      if (relPath === '') return this.rootListing();
      const { browser, rel } = this.route(relPath);
      return browser.listDir(rel, showHidden);
    }
    return this.port.listDir(await this.resolveSafe(relPath), { showHidden });
  }

  /**
   * Every non-hidden folder under the root as a root-relative path, breadth-first
   * so the shallow ones survive the cap — the folder picker's candidate list.
   */
  async listFolders(): Promise<string[]> {
    if (this.isVirtual) {
      const all: string[] = [];
      for (const [alias, folder] of this.aliasToFolder) {
        all.push(alias, ...(await this.forFolder(folder).listFolders()).map((rel) => `${alias}/${rel}`));
      }
      return all;
    }
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
    if (this.isVirtual) {
      const { browser, rel } = this.route(relPath);
      return browser.readFile(rel);
    }
    return this.port.readFile(await this.resolveSafe(relPath));
  }

  async writeFile(relPath: string, content: string): Promise<void> {
    if (this.isVirtual) {
      const { browser, rel } = this.route(relPath);
      return browser.writeFile(rel, content);
    }
    return this.port.writeFile(await this.resolveSafe(relPath), content);
  }

  async resolveAbsolutePath(relPath: string): Promise<string> {
    if (this.isVirtual) {
      const { browser, rel } = this.route(relPath);
      return browser.resolveAbsolutePath(rel);
    }
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
