import { promises as fs } from 'node:fs';
import type { FileOperationsPort, FsDirEntry, FsEntryKind } from '../../application/ports/file-operations-port.js';

const BINARY_SNIFF_BYTES = 8000;

function kindOf(entry: { isFile(): boolean; isDirectory(): boolean }): FsEntryKind {
  if (entry.isDirectory()) return 'dir';
  if (entry.isFile()) return 'file';
  return 'other';
}

export class NodeFileOperationsAdapter implements FileOperationsPort {
  async stat(absPath: string): Promise<{ kind: FsEntryKind } | null> {
    try {
      return { kind: kindOf(await fs.lstat(absPath)) };
    } catch (err) {
      if ((err as { code?: string }).code === 'ENOENT') return null;
      throw err;
    }
  }

  async mkdir(absPath: string, options: { recursive?: boolean } = {}): Promise<void> {
    await fs.mkdir(absPath, { recursive: options.recursive === true });
  }

  async createFile(absPath: string): Promise<void> {
    const handle = await fs.open(absPath, 'wx');
    await handle.close();
  }

  async rename(from: string, to: string): Promise<void> {
    await fs.rename(from, to);
  }

  async copy(from: string, to: string): Promise<void> {
    await fs.cp(from, to, { recursive: true, force: false, errorOnExist: true, verbatimSymlinks: true });
  }

  async readDir(absPath: string): Promise<FsDirEntry[]> {
    const dirents = await fs.readdir(absPath, { withFileTypes: true });
    return dirents.map((dirent) => ({ name: dirent.name, kind: kindOf(dirent) }));
  }

  async removeEmptyDir(absPath: string): Promise<void> {
    await fs.rmdir(absPath);
  }

  async readText(absPath: string, maxBytes: number): Promise<string | null> {
    const handle = await fs.open(absPath, 'r');
    try {
      const { size } = await handle.stat();
      if (size > maxBytes) return null;
      const buffer = await handle.readFile();
      if (buffer.subarray(0, Math.min(buffer.length, BINARY_SNIFF_BYTES)).includes(0)) return null;
      return buffer.toString('utf8');
    } finally {
      await handle.close();
    }
  }
}
