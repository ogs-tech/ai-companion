import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { FileBrowserEntry, FileBrowserPort, FilePreview } from '../../application/ports/file-browser-port.js';
import { DomainError } from '../../domain/errors.js';

const MAX_READABLE_BYTES = 5 * 1024 * 1024; // 5MB — above this, never even read the file.
const PREVIEW_CONTENT_CAP = 256 * 1024; // 256KB — previewable content is truncated to this.
const BINARY_SNIFF_BYTES = 8000;

function isEnoent(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT';
}

export class NodeFileBrowserAdapter implements FileBrowserPort {
  async listDir(absPath: string): Promise<FileBrowserEntry[]> {
    let dirents: import('node:fs').Dirent[];
    try {
      dirents = await fs.readdir(absPath, { withFileTypes: true });
    } catch (err) {
      if (isEnoent(err)) throw new DomainError('not_found', `Directory not found: ${absPath}`);
      throw err;
    }

    const entries: FileBrowserEntry[] = [];
    for (const dirent of dirents) {
      if (dirent.name.startsWith('.')) continue;
      if (dirent.isDirectory()) {
        entries.push({ name: dirent.name, kind: 'dir' });
        continue;
      }
      if (dirent.isFile()) {
        const stat = await fs.stat(join(absPath, dirent.name)).catch(() => null);
        entries.push({ name: dirent.name, kind: 'file', ...(stat ? { size: stat.size } : {}) });
      }
    }

    return entries.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  async readFile(absPath: string): Promise<FilePreview> {
    let stat: import('node:fs').Stats;
    try {
      stat = await fs.stat(absPath);
    } catch (err) {
      if (isEnoent(err)) throw new DomainError('not_found', `File not found: ${absPath}`);
      throw err;
    }
    if (!stat.isFile()) {
      throw new DomainError('validation', `Not a file: ${absPath}`);
    }
    if (stat.size > MAX_READABLE_BYTES) {
      return { previewable: false, reason: `File is too large to preview (over ${MAX_READABLE_BYTES / (1024 * 1024)}MB)` };
    }

    const buffer = await fs.readFile(absPath);
    const sniffLength = Math.min(buffer.length, BINARY_SNIFF_BYTES);
    if (buffer.subarray(0, sniffLength).includes(0)) {
      return { previewable: false, reason: 'File appears to be binary' };
    }

    const truncated = buffer.length > PREVIEW_CONTENT_CAP;
    const content = buffer.subarray(0, PREVIEW_CONTENT_CAP).toString('utf8');
    return { previewable: true, content, truncated };
  }

  async realpath(absPath: string): Promise<string> {
    try {
      return await fs.realpath(absPath);
    } catch (err) {
      if (isEnoent(err)) throw new DomainError('not_found', `Path not found: ${absPath}`);
      throw err;
    }
  }
}
