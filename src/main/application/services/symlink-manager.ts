import { dirname, join, relative, resolve, sep } from 'node:path';
import type { ClockPort } from '../ports/clock-port.js';
import type { FileSystemPort } from '../ports/filesystem-port.js';
import { DomainError, ioError } from '../../domain/errors.js';

export type RemoveIfPointsResult =
  | 'removed'
  | 'skipped-not-found'
  | 'skipped-real-file'
  | 'skipped-out-of-workspace';

export type SymlinkValidateState =
  | 'none'
  | 'symlink-to-source'
  | 'symlink-to-other'
  | 'real-file';

export interface SymlinkCreateResult {
  status: 'ok' | 'conflict';
  details?: {
    backupPath?: string;
    replacedTarget?: string;
    action?: 'overwritten';
  };
}

export interface SymlinkScanResult {
  path: string;
  target: string;
}

export class SymlinkManager {
  constructor(
    private readonly fs: FileSystemPort,
    private readonly clock: ClockPort,
    private readonly workspacePath: string,
  ) {}

  async create(args: { source: string; destination: string }): Promise<SymlinkCreateResult> {
    const sourcePath = resolve(args.source);
    const destinationPath = resolve(args.destination);
    // A link to its own path is never a valid outcome — every open() on it raises ELOOP, and
    // the existing-symlink branch below would read it back as already-correct and never heal
    // it. Refuse before touching the filesystem, so the real file at that path survives.
    if (sourcePath === destinationPath) {
      throw new DomainError('validation', `Refusing to symlink ${destinationPath} to itself`);
    }
    try {
      await this.fs.mkdir(dirname(destinationPath), { recursive: true });

      const stat = await this.fs.lstat(destinationPath);
      if (stat.kind === 'none') {
        await this.fs.symlink({ target: sourcePath, path: destinationPath });
        return { status: 'ok' };
      }

      if (stat.kind === 'symlink') {
        const existingTarget = await this.fs.readlink(destinationPath);
        const resolvedTarget = resolve(dirname(destinationPath), existingTarget);
        if (resolvedTarget === sourcePath) {
          return { status: 'ok' };
        }
        await this.fs.unlink(destinationPath);
        await this.fs.symlink({ target: sourcePath, path: destinationPath });
        return {
          status: 'ok',
          details: { replacedTarget: resolvedTarget },
        };
      }

      if (stat.kind === 'file' || stat.kind === 'directory') {
        let relativeTarget = relative(this.workspacePath, destinationPath);
        if (relativeTarget.startsWith('..')) {
          relativeTarget = destinationPath.replace(/^\/+/, '');
          if (relativeTarget === '') {
            throw ioError({
              message: `Cannot derive backup path for: ${destinationPath}`,
              details: { reason: 'backup-path-undeterminable' },
            });
          }
        }
        const timestamp = this.timestampForNow();
        const backupPath = await this.nextBackupPath(relativeTarget, timestamp);
        await this.fs.mkdir(dirname(backupPath), { recursive: true });
        try {
          if (stat.kind === 'file') {
            await this.fs.copyFile(destinationPath, backupPath);
          } else {
            throw ioError({
              message: `Cannot backup directory destination: ${destinationPath}`,
              details: { reason: 'backup-directory' },
            });
          }
        } catch (err) {
          if (err instanceof DomainError) throw err;
          if (err instanceof Error) {
            const details: { reason: string; code?: string } = { reason: 'backup-failed' };
            const code = (err as { code?: string }).code;
            if (code !== undefined) {
              details.code = code;
            }
            throw ioError({
              message: `Failed to create backup for ${destinationPath}`,
              details,
            });
          }
          throw err;
        }
        await this.fs.unlink(destinationPath);
        await this.fs.symlink({ target: sourcePath, path: destinationPath });
        return {
          status: 'conflict',
          details: { backupPath, action: 'overwritten' },
        };
      }

      throw ioError({ message: `Unsupported filesystem entry at ${destinationPath}` });
    } catch (err) {
      if (err instanceof DomainError) throw err;
      if (err instanceof Error) {
        const details: { code?: string } = {};
        const code = (err as { code?: string }).code;
        if (code !== undefined) details.code = code;
        throw ioError({ message: err.message, details });
      }
      throw err;
    }
  }

  async validate(args: { destination: string; source?: string }): Promise<SymlinkValidateState> {
    const destinationPath = resolve(args.destination);
    const stat = await this.fs.lstat(destinationPath);
    if (stat.kind === 'none') {
      return 'none';
    }
    if (stat.kind === 'symlink') {
      const existingTarget = await this.fs.readlink(destinationPath);
      const resolvedTarget = resolve(dirname(destinationPath), existingTarget);
      if (args.source && resolve(args.source) === resolvedTarget) {
        return 'symlink-to-source';
      }
      return 'symlink-to-other';
    }
    return 'real-file';
  }

  async remove(args: { destination: string }): Promise<void> {
    const destinationPath = resolve(args.destination);
    const stat = await this.fs.lstat(destinationPath);
    if (stat.kind !== 'symlink') {
      throw ioError({
        message: `Destination is not a symlink: ${destinationPath}`,
        details: { reason: 'not-a-symlink' },
      });
    }
    await this.fs.unlink(destinationPath);
  }

  async removeIfExists(args: { destination: string }): Promise<{ removed: boolean }> {
    const destinationPath = resolve(args.destination);
    const stat = await this.fs.lstat(destinationPath);
    if (stat.kind === 'none') {
      return { removed: false };
    }
    if (stat.kind !== 'symlink') {
      throw ioError({
        message: `Destination is not a symlink: ${destinationPath}`,
        details: { reason: 'not-a-symlink' },
      });
    }
    await this.fs.unlink(destinationPath);
    return { removed: true };
  }

  async scanByTarget(args: {
    rootPath: string;
    workspacePath: string;
  }): Promise<SymlinkScanResult[]> {
    const root = resolve(args.rootPath);
    const workspace = resolve(args.workspacePath);
    return this.scanDirectory(root, workspace);
  }

  private async scanDirectory(rootPath: string, workspacePath: string): Promise<SymlinkScanResult[]> {
    const items: SymlinkScanResult[] = [];
    const entries = await this.fs.readdir(rootPath);
    for (const name of entries) {
      const current = join(rootPath, name);
      const stat = await this.fs.lstat(current);
      if (stat.kind === 'symlink' && stat.target) {
        const resolvedTarget = resolve(dirname(current), stat.target);
        if (resolvedTarget.startsWith(`${workspacePath}/`) || resolvedTarget === workspacePath) {
          items.push({ path: current, target: resolvedTarget });
        }
        continue;
      }
      if (stat.kind === 'directory') {
        items.push(...(await this.scanDirectory(current, workspacePath)));
      }
    }
    return items;
  }

  async isSymlinkToWorkspace(destination: string, workspacePath: string): Promise<boolean> {
    const destinationPath = resolve(destination);
    const stat = await this.fs.lstat(destinationPath);
    if (stat.kind !== 'symlink') return false;
    const rawTarget = await this.fs.readlink(destinationPath);
    const resolvedTarget = resolve(dirname(destinationPath), rawTarget);
    const resolvedWorkspace = resolve(workspacePath);
    return resolvedTarget.startsWith(resolvedWorkspace + sep) || resolvedTarget === resolvedWorkspace;
  }

  async removeIfPointsToWorkspace(
    destination: string,
    workspacePath: string,
  ): Promise<RemoveIfPointsResult> {
    const destinationPath = resolve(destination);
    const stat = await this.fs.lstat(destinationPath);

    if (stat.kind === 'none') return 'skipped-not-found';
    if (stat.kind !== 'symlink') return 'skipped-real-file';

    const rawTarget = await this.fs.readlink(destinationPath);
    const resolvedTarget = resolve(dirname(destinationPath), rawTarget);
    const resolvedWorkspace = resolve(workspacePath);

    if (!resolvedTarget.startsWith(resolvedWorkspace + sep) && resolvedTarget !== resolvedWorkspace) {
      return 'skipped-out-of-workspace';
    }

    await this.fs.unlink(destinationPath);
    return 'removed';
  }

  private timestampForNow(): string {
    const now = this.clock.now();
    const pad = (value: number) => String(value).padStart(2, '0');
    const year = now.getUTCFullYear();
    const month = pad(now.getUTCMonth() + 1);
    const day = pad(now.getUTCDate());
    const hours = pad(now.getUTCHours());
    const minutes = pad(now.getUTCMinutes());
    const seconds = pad(now.getUTCSeconds());
    return `${year}${month}${day}T${hours}${minutes}${seconds}`;
  }

  private async nextBackupPath(relativeTarget: string, timestamp: string): Promise<string> {
    let attempt = 0;
    while (true) {
      const suffix = attempt === 0 ? '' : `-${attempt}`;
      const backupPath = resolve(this.workspacePath, '_backups', `${timestamp}${suffix}`, relativeTarget);
      if (!(await this.fs.pathExists(backupPath))) {
        return backupPath;
      }
      attempt += 1;
    }
  }
}
