import { isAbsolute, join, sep } from 'node:path';
import type { FileBrowserEntry, FileBrowserPort, FilePreview } from '../ports/file-browser-port.js';
import { DomainError } from '../../domain/errors.js';

function withSep(p: string): string {
  return p.endsWith(sep) ? p : `${p}${sep}`;
}

export class FileBrowserService {
  constructor(
    private readonly port: FileBrowserPort,
    private readonly rootPath: string,
  ) {}

  async listDir(relPath: string): Promise<FileBrowserEntry[]> {
    return this.port.listDir(await this.resolveSafe(relPath));
  }

  async readFile(relPath: string): Promise<FilePreview> {
    return this.port.readFile(await this.resolveSafe(relPath));
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
