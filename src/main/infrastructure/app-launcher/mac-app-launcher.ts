import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { app, shell } from 'electron';
import type { AppCandidate, AppLauncherPort, AppQueryResult } from '../../application/ports/app-launcher-port.js';
import { DomainError } from '../../domain/errors.js';
import {
  IDENTIFY_APPLICATION_SCRIPT,
  LIST_APPLICATIONS_SCRIPT,
  parseApplicationOutput,
  parseApplicationsOutput,
} from './launch-services.js';

const execFileAsync = promisify(execFile);

/**
 * Launch Services answers in milliseconds when the registry is warm, but it
 * can block on a first call after login while the registry rebuilds. The menu
 * would rather come back empty than hang open with a spinner.
 */
const QUERY_TIMEOUT_MS = 5_000;

/** `open` returns as soon as the launch is handed off, so this is only a guard against a wedged LaunchServices. */
const LAUNCH_TIMEOUT_MS = 10_000;

export class MacAppLauncher implements AppLauncherPort {
  /**
   * Icons are read once per bundle and kept for the process's lifetime: the
   * same handful of applications comes back for every file in the tree, and
   * an icon only changes when the app is replaced on disk.
   */
  private readonly iconCache = new Map<string, string | undefined>();

  async listApplicationsFor(absolutePath: string): Promise<AppQueryResult> {
    try {
      const { stdout } = await execFileAsync(
        'osascript',
        ['-l', 'JavaScript', '-e', LIST_APPLICATIONS_SCRIPT, absolutePath],
        { timeout: QUERY_TIMEOUT_MS },
      );
      return parseApplicationsOutput(stdout);
    } catch {
      // A timeout, a missing osascript, a path Launch Services refuses — the
      // caller's contract is an empty list, not an exception.
      return { candidates: [] };
    }
  }

  async identify(appPath: string): Promise<AppCandidate | undefined> {
    try {
      const { stdout } = await execFileAsync(
        'osascript',
        ['-l', 'JavaScript', '-e', IDENTIFY_APPLICATION_SCRIPT, appPath],
        { timeout: QUERY_TIMEOUT_MS },
      );
      return parseApplicationOutput(stdout);
    } catch {
      return undefined;
    }
  }

  async iconFor(appPath: string): Promise<string | undefined> {
    if (this.iconCache.has(appPath)) return this.iconCache.get(appPath);

    let dataUrl: string | undefined;
    try {
      const icon = await app.getFileIcon(appPath, { size: 'small' });
      dataUrl = icon.isEmpty() ? undefined : icon.toDataURL();
    } catch {
      dataUrl = undefined;
    }
    this.iconCache.set(appPath, dataUrl);
    return dataUrl;
  }

  async openWith(absolutePath: string, appPath: string): Promise<void> {
    try {
      await execFileAsync('open', ['-a', appPath, absolutePath], { timeout: LAUNCH_TIMEOUT_MS });
    } catch (err) {
      throw new DomainError(
        'io',
        `Não foi possível abrir com esse aplicativo: ${err instanceof Error ? err.message : String(err)}`,
        { appPath },
      );
    }
  }

  async openDefault(absolutePath: string): Promise<void> {
    const failure = await shell.openPath(absolutePath);
    if (failure !== '') {
      throw new DomainError('io', `Não foi possível abrir com o aplicativo padrão: ${failure}`);
    }
  }

  async reveal(absolutePath: string): Promise<void> {
    shell.showItemInFolder(absolutePath);
  }
}
