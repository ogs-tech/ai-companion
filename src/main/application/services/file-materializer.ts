import { dirname, relative, resolve } from 'node:path';
import type { WritableFileSystemPort } from '../ports/writable-filesystem-port.js';
import type { ClockPort } from '../ports/clock-port.js';
import type { OwnershipCheck } from '../ports/adapter.js';
import { GENERATED_FILE_MARKER } from '../entity/agents-file.js';
import { legacyOwnershipMarkers } from '../../../shared/brand.js';
import { DomainError, ioError } from '../../domain/errors.js';

export type GeneratedFileState = 'ok' | 'missing' | 'drift' | 'foreign';

export interface FileMaterializeResult {
  status: 'ok' | 'conflict';
  details?: { backupPath?: string; action?: 'overwritten' };
}

interface Ownership {
  marker: string;
  check: OwnershipCheck;
}

/**
 * Write-side twin of SymlinkManager for app-generated files (e.g. <repo>/AGENTS.md).
 * Ownership is signalled by GENERATED_FILE_MARKER on the file's first line: the app
 * only overwrites/removes files it owns; a foreign file is backed up before overwrite
 * and never deleted. Backup scheme mirrors SymlinkManager: <workspace>/_backups/<ts>/<rel>.
 */
export class FileMaterializer {
  private readonly legacyOwnershipMarkers: readonly string[];

  constructor(
    private readonly fs: WritableFileSystemPort,
    private readonly clock: ClockPort,
    private readonly workspacePath: string,
    legacyMarkers: readonly string[] = legacyOwnershipMarkers(),
  ) {
    this.legacyOwnershipMarkers = legacyMarkers;
  }

  async write(args: {
    destination: string;
    content: string;
    ownershipMarker?: string;
    ownershipCheck?: OwnershipCheck;
  }): Promise<FileMaterializeResult> {
    const dest = resolve(args.destination);
    const ownership = ownershipOf(args);
    try {
      await this.fs.mkdir(dirname(dest), { recursive: true });
      const stat = await this.fs.lstat(dest);
      if (stat.kind === 'none') {
        await this.fs.writeFile(dest, args.content);
        return { status: 'ok' };
      }
      if (stat.kind === 'symlink') {
        // A symlink destination is never app-owned: never read/write through it.
        // Back up the link's resolved target content when it can be read, then
        // unlink the symlink itself (leaving its target untouched) and write a
        // fresh regular file in its place.
        let resolvedContent: string | undefined;
        try {
          const rawTarget = await this.fs.readlink(dest);
          const resolvedTarget = resolve(dirname(dest), rawTarget);
          resolvedContent = await this.fs.readFile(resolvedTarget);
        } catch {
          resolvedContent = undefined;
        }
        const details: { backupPath?: string; action: 'overwritten' } = { action: 'overwritten' };
        if (resolvedContent !== undefined) {
          details.backupPath = await this.backup(dest, resolvedContent);
        }
        await this.fs.unlink(dest);
        await this.fs.writeFile(dest, args.content);
        return { status: 'conflict', details };
      }
      const existing = await this.fs.readFile(dest);
      if (isOwned(existing, ownership, this.legacyOwnershipMarkers)) {
        await this.fs.writeFile(dest, args.content);
        return { status: 'ok' };
      }
      const backupPath = await this.backup(dest, existing);
      await this.fs.writeFile(dest, args.content);
      return { status: 'conflict', details: { backupPath, action: 'overwritten' } };
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

  async removeIfOwned(args: {
    destination: string;
    ownershipMarker?: string;
    ownershipCheck?: OwnershipCheck;
  }): Promise<{ removed: boolean }> {
    const dest = resolve(args.destination);
    const ownership = ownershipOf(args);
    const stat = await this.fs.lstat(dest);
    if (stat.kind === 'none') return { removed: false };
    if (stat.kind === 'symlink') return { removed: false };
    const existing = await this.fs.readFile(dest);
    if (!isOwned(existing, ownership, this.legacyOwnershipMarkers)) return { removed: false };
    await this.fs.unlink(dest);
    return { removed: true };
  }

  async validate(args: {
    destination: string;
    content: string;
    ownershipMarker?: string;
    ownershipCheck?: OwnershipCheck;
  }): Promise<GeneratedFileState> {
    const dest = resolve(args.destination);
    const ownership = ownershipOf(args);
    const stat = await this.fs.lstat(dest);
    if (stat.kind === 'none') return 'missing';
    if (stat.kind === 'symlink') return 'foreign';
    const existing = await this.fs.readFile(dest);
    if (!isOwned(existing, ownership, this.legacyOwnershipMarkers)) return 'foreign';
    return existing === args.content ? 'ok' : 'drift';
  }

  private async backup(destinationPath: string, content: string): Promise<string> {
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
    const backupPath = await this.nextBackupPath(relativeTarget, this.timestampForNow());
    await this.fs.mkdir(dirname(backupPath), { recursive: true });
    await this.fs.writeFile(backupPath, content);
    return backupPath;
  }

  private timestampForNow(): string {
    const now = this.clock.now();
    const pad = (v: number) => String(v).padStart(2, '0');
    return (
      `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}` +
      `T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`
    );
  }

  private async nextBackupPath(relativeTarget: string, timestamp: string): Promise<string> {
    let attempt = 0;
    while (true) {
      const suffix = attempt === 0 ? '' : `-${attempt}`;
      const backupPath = resolve(this.workspacePath, '_backups', `${timestamp}${suffix}`, relativeTarget);
      if (!(await this.fs.pathExists(backupPath))) return backupPath;
      attempt += 1;
    }
  }
}

function ownershipOf(args: { ownershipMarker?: string; ownershipCheck?: OwnershipCheck }): Ownership {
  return {
    marker: args.ownershipMarker ?? GENERATED_FILE_MARKER,
    check: args.ownershipCheck ?? 'startsWith',
  };
}

function isOwned(
  content: string,
  ownership: Ownership,
  legacyMarkers: readonly string[],
): boolean {
  const markers = [ownership.marker, ...legacyMarkers];
  if (ownership.check === 'startsWith') {
    return markers.some((marker) => content.startsWith(marker));
  }
  return markers.some((marker) => content.includes(marker));
}
