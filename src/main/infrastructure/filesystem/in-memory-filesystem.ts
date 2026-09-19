import { dirname, normalize, relative } from 'node:path';
import type { FileSystemEntry } from '../../application/ports/filesystem-port.js';
import type { FileStat, WritableFileSystemPort } from '../../application/ports/writable-filesystem-port.js';

type ErrorWithCode = Error & { code?: string };

interface FileSystemEntryRecord {
  kind: Exclude<FileSystemEntry['kind'], 'none'>;
  target?: string;
  content?: string | Buffer;
  mode: number;
}

interface FailOnRule {
  op: 'lstat' | 'readlink' | 'symlink' | 'unlink' | 'mkdir' | 'copyFile' | 'readdir' | 'pathExists' | 'writeFile' | 'rename' | 'chmod' | 'stat';
  path: string;
  code: string;
}

export class InMemoryFileSystem implements WritableFileSystemPort {
  private readonly entries = new Map<string, FileSystemEntryRecord>();
  private readonly failOn: FailOnRule[];
  private tempCounter = 0;

  constructor(failOn: FailOnRule[] = []) {
    this.failOn = failOn;
  }

  private normalize(path: string): string {
    return normalize(path);
  }

  private checkFail(op: FailOnRule['op'], path: string): void {
    const normalized = this.normalize(path);
    const rule = this.failOn.find((item) => item.op === op && this.normalize(item.path) === normalized);
    if (rule) {
      const err = new Error(`Mock failure ${op} ${normalized}`) as Error & { code?: string };
      err.code = rule.code;
      throw err;
    }
  }

  private ensureDirectory(path: string): void {
    const normalized = this.normalize(path);
    const parent = dirname(normalized);
    if (parent !== normalized) {
      this.ensureDirectory(parent);
    }
    if (!this.entries.has(normalized)) {
      this.entries.set(normalized, { kind: 'directory', mode: 0o755 });
    }
  }

  async lstat(path: string): Promise<FileSystemEntry> {
    this.checkFail('lstat', path);
    const normalized = this.normalize(path);
    const entry = this.entries.get(normalized);
    if (!entry) {
      return { kind: 'none' };
    }
    if (entry.kind === 'symlink') {
      if (entry.target !== undefined) {
        return { kind: 'symlink', target: entry.target };
      }
      return { kind: 'symlink' };
    }
    return { kind: entry.kind };
  }

  async readlink(path: string): Promise<string> {
    this.checkFail('readlink', path);
    const normalized = this.normalize(path);
    const entry = this.entries.get(normalized);
    if (!entry || entry.kind !== 'symlink' || entry.target === undefined) {
      const err = new Error('Invalid symlink path');
      throw err;
    }
    return entry.target;
  }

  async symlink(args: { target: string; path: string }): Promise<void> {
    this.checkFail('symlink', args.path);
    const normalized = this.normalize(args.path);
    this.ensureDirectory(dirname(normalized));
    this.entries.set(normalized, { kind: 'symlink', target: args.target, mode: 0o777 });
  }

  async unlink(path: string): Promise<void> {
    this.checkFail('unlink', path);
    const normalized = this.normalize(path);
    if (!this.entries.has(normalized)) {
      const err: ErrorWithCode = new Error('ENOENT');
      err.code = 'ENOENT';
      throw err;
    }
    this.entries.delete(normalized);
  }

  async mkdir(path: string, options: { recursive: boolean }): Promise<void> {
    this.checkFail('mkdir', path);
    const normalized = this.normalize(path);
    if (options.recursive) {
      this.ensureDirectory(normalized);
      return;
    }
    if (this.entries.has(normalized)) {
      return;
    }
    this.entries.set(normalized, { kind: 'directory', mode: 0o755 });
  }

  async copyFile(src: string, dest: string): Promise<void> {
    this.checkFail('copyFile', dest);
    const srcPath = this.normalize(src);
    const destPath = this.normalize(dest);
    const entry = this.entries.get(srcPath);
    if (!entry || entry.kind !== 'file' || entry.content === undefined) {
      const err: ErrorWithCode = new Error('ENOENT');
      err.code = 'ENOENT';
      throw err;
    }
    this.ensureDirectory(dirname(destPath));
    this.entries.set(destPath, { kind: 'file', content: entry.content, mode: 0o644 });
  }

  async readdir(path: string): Promise<string[]> {
    this.checkFail('readdir', path);
    const normalized = this.normalize(path);
    const entry = this.entries.get(normalized);
    if (!entry || entry.kind !== 'directory') {
      const err: ErrorWithCode = new Error('ENOTDIR');
      err.code = 'ENOTDIR';
      throw err;
    }
    const names = new Set<string>();
    for (const key of this.entries.keys()) {
      const relativePath = relative(normalized, key);
      if (!relativePath || relativePath.startsWith('..') || relativePath === '.') continue;
      const segments = relativePath.split(/[/\\]/);
      const firstSegment = segments[0] ?? '';
      if (firstSegment) {
        names.add(firstSegment);
      }
    }
    return Array.from(names);
  }

  async pathExists(path: string): Promise<boolean> {
    this.checkFail('pathExists', path);
    const normalized = this.normalize(path);
    if (this.entries.has(normalized)) return true;
    for (const key of this.entries.keys()) {
      if (key.startsWith(`${normalized}/`) || key.startsWith(`${normalized}\\`)) {
        return true;
      }
    }
    return false;
  }

  async readFile(path: string): Promise<string> {
    const normalized = this.normalize(path);
    const entry = this.entries.get(normalized);
    if (!entry || entry.kind !== 'file' || entry.content === undefined) {
      const err: ErrorWithCode = new Error(`ENOENT: no such file: ${normalized}`);
      err.code = 'ENOENT';
      throw err;
    }
    // Mirrors `fs.readFile(path, 'utf-8')`, which decodes whatever bytes were
    // written the same way whether they arrived as a string or a Buffer.
    return typeof entry.content === 'string' ? entry.content : entry.content.toString('utf-8');
  }

  createFile(path: string, content: string): void {
    const normalized = this.normalize(path);
    this.ensureDirectory(dirname(normalized));
    this.entries.set(normalized, { kind: 'file', content, mode: 0o644 });
  }

  async writeFile(path: string, content: string | Buffer): Promise<void> {
    this.checkFail('writeFile', path);
    const normalized = this.normalize(path);
    this.ensureDirectory(dirname(normalized));
    const existing = this.entries.get(normalized);
    this.entries.set(normalized, { kind: 'file', content, mode: existing?.mode ?? 0o644 });
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    this.checkFail('rename', oldPath);
    const normalizedOld = this.normalize(oldPath);
    const normalizedNew = this.normalize(newPath);
    const entry = this.entries.get(normalizedOld);
    if (!entry) {
      const err: ErrorWithCode = new Error('ENOENT');
      err.code = 'ENOENT';
      throw err;
    }
    this.ensureDirectory(dirname(normalizedNew));
    this.entries.delete(normalizedOld);
    this.entries.set(normalizedNew, entry);
  }

  async chmod(path: string, mode: number): Promise<void> {
    this.checkFail('chmod', path);
    const normalized = this.normalize(path);
    const entry = this.entries.get(normalized);
    if (!entry) {
      const err: ErrorWithCode = new Error('ENOENT');
      err.code = 'ENOENT';
      throw err;
    }
    this.entries.set(normalized, { ...entry, mode });
  }

  async stat(path: string): Promise<FileStat | null> {
    this.checkFail('stat', path);
    const normalized = this.normalize(path);
    const entry = this.entries.get(normalized);
    if (!entry || entry.kind !== 'file') return null;
    return { mode: entry.mode };
  }

  async remove(path: string): Promise<void> {
    const normalized = this.normalize(path);
    for (const key of [...this.entries.keys()]) {
      if (
        key === normalized ||
        key.startsWith(`${normalized}/`) ||
        key.startsWith(`${normalized}\\`)
      ) {
        this.entries.delete(key);
      }
    }
  }

  async makeTempDir(prefix: string): Promise<string> {
    const dir = this.normalize(`/tmp/${prefix}${this.tempCounter++}`);
    this.ensureDirectory(dir);
    return dir;
  }
}
