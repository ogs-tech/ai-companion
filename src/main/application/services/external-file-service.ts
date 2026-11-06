import { isAbsolute, resolve } from 'node:path';
import type { DialogPort } from '../ports/dialog-port.js';
import type { FileBrowserPort, FilePreview } from '../ports/file-browser-port.js';
import type { FileOperationsPort } from '../ports/file-operations-port.js';
import { DomainError } from '../../domain/errors.js';

/**
 * Files outside the workspace the user explicitly brought in (native picker or
 * an OS drop). Only paths on the grant list can be read, written or imported;
 * the list lives in memory for the app's lifetime, so a restart forgets it.
 * Built once — it is not tied to the open workspace.
 */
export class ExternalFileService {
  private readonly granted = new Set<string>();

  constructor(
    private readonly dialog: DialogPort,
    private readonly browser: FileBrowserPort,
    private readonly ops: FileOperationsPort,
  ) {}

  isGranted(absPath: string): boolean {
    return isAbsolute(absPath) && this.granted.has(resolve(absPath));
  }

  /** Opens the native picker; grants and returns the chosen files (`[]` when cancelled). */
  async pick(): Promise<string[]> {
    const result = await this.dialog.selectFiles();
    if (result.canceled) return [];
    for (const path of result.paths) this.granted.add(resolve(path));
    return result.paths.map((path) => resolve(path));
  }

  /**
   * Grants paths the preload read off a real OS drop event. This trusts the
   * renderer's drop event: a compromised renderer could claim any path, so only
   * existing regular files and directories are accepted.
   */
  async grantDropped(paths: string[]): Promise<string[]> {
    const accepted: string[] = [];
    for (const path of paths) {
      if (!isAbsolute(path)) continue;
      const abs = resolve(path);
      const stat = await this.ops.stat(abs).catch(() => null);
      if (stat === null || stat.kind === 'other') continue;
      this.granted.add(abs);
      accepted.push(abs);
    }
    return accepted;
  }

  async read(path: string): Promise<FilePreview> {
    return this.browser.readFile(this.requireGrant(path));
  }

  async write(path: string, content: string): Promise<void> {
    return this.browser.writeFile(this.requireGrant(path), content);
  }

  private requireGrant(path: string): string {
    if (!this.isGranted(path)) {
      throw new DomainError('validation', 'Este arquivo não foi autorizado. Abra-o pelo seletor ou arraste-o para o app.', {
        reason: 'not-granted',
      });
    }
    return resolve(path);
  }
}
