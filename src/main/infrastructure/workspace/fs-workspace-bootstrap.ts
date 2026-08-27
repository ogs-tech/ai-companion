import { promises as fs } from 'node:fs';
import type { FileSystemMutator } from '../../application/ports/file-system-mutator.js';
import { DomainError } from '../../domain/errors.js';

const IO_ERRNO_CODES = new Set(['EACCES', 'ENOSPC', 'EROFS', 'EPERM']);

const errnoCode = (err: unknown): string | undefined =>
  typeof err === 'object' && err !== null
    ? (err as { code?: unknown }).code as string | undefined
    : undefined;

export class FsWorkspaceBootstrap implements FileSystemMutator {
  async mkdirRecursive(path: string): Promise<void> {
    try {
      await fs.mkdir(path, { recursive: true });
    } catch (err) {
      const code = errnoCode(err);
      if (code !== undefined && IO_ERRNO_CODES.has(code)) {
        throw new DomainError('io', `Failed to create directory: ${path}`, { code, path });
      }
      throw err;
    }
  }

  async writeFile(path: string, content: string): Promise<void> {
    try {
      await fs.writeFile(path, content, 'utf8');
    } catch (err) {
      const code = errnoCode(err);
      if (code !== undefined && IO_ERRNO_CODES.has(code)) {
        throw new DomainError('io', `Failed to write file: ${path}`, { code, path });
      }
      throw err;
    }
  }
}
