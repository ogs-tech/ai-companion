import type { AdapterManager } from './adapter-manager.js';
import type { WritableFileSystemPort } from '../ports/writable-filesystem-port.js';
import type { ClaudeSettingsPort } from '../ports/claude-settings-port.js';

/**
 * "Restore to initial state" (factory reset). Undoes only this app's footprint:
 * the symlinks it created under adapter targets (those pointing into the
 * workspace), the workspace directory itself, and the marketplace/plugin
 * registrations this app writes into `~/.claude/settings.json`. It deliberately
 * never deletes the wider `~/.claude` tree or any project `.env.local`.
 */
export class WorkspaceTeardownService {
  constructor(
    private readonly adapterManager: Pick<AdapterManager, 'removeAllAdapterSymlinks' | 'removeAllGeneratedFiles'>,
    private readonly fs: Pick<WritableFileSystemPort, 'remove'>,
    private readonly workspacePath: string,
    private readonly settings: Pick<ClaudeSettingsPort, 'mutate'>,
  ) {}

  async restore(): Promise<void> {
    // Order matters: symlink/generated-file discovery reads the workspace
    // (customization list), so both must be removed before the workspace
    // directory is deleted.
    await this.adapterManager.removeAllAdapterSymlinks();
    await this.adapterManager.removeAllGeneratedFiles();
    await this.fs.remove(this.workspacePath);
    // Clear the registry this app owns in settings.json. Deleting the workspace
    // (above) wipes the marketplace clone cache, so leaving these entries behind
    // would strand the seeder on a dangling cachePath — registered but
    // unreadable — and the next boot would skip re-seeding. Resetting them lets
    // the seeder re-clone the official marketplace from scratch.
    await this.settings.mutate('personal', (s) => ({
      ...s,
      extraKnownMarketplaces: {},
      enabledPlugins: {},
    }));
  }
}
