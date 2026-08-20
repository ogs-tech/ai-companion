import { join } from 'node:path';
import type { WritableFileSystemPort } from '../ports/writable-filesystem-port.js';

import {
  cursorPluginPath,
  legacyCursorPluginPath,
  legacyWorkspacePath,
  workspacePath,
} from '../../../shared/brand-paths.js';

/**
 * One-time migration from the Superset AI footprint to the AI Companion paths.
 * Recognizes the legacy workspace and Cursor plugin directories and renames
 * them when the new paths do not yet exist.
 */
export class ProductMigrationService {
  constructor(private readonly fs: WritableFileSystemPort) {}

  async migrate(home: string): Promise<{ workspacePath: string }> {
    const targetWorkspace = workspacePath(home);
    const legacyWorkspace = legacyWorkspacePath(home);
    await this.renameIfNeeded(legacyWorkspace, targetWorkspace);

    const targetPlugin = cursorPluginPath(home);
    const legacyPlugin = legacyCursorPluginPath(home);
    await this.renameIfNeeded(legacyPlugin, targetPlugin);

    return { workspacePath: targetWorkspace };
  }

  private async renameIfNeeded(from: string, to: string): Promise<void> {
    if (from === to) return;
    if (!(await this.fs.pathExists(from))) return;
    if (await this.fs.pathExists(to)) return;
    await this.fs.mkdir(join(to, '..'), { recursive: true });
    await this.fs.rename(from, to);
  }
}
