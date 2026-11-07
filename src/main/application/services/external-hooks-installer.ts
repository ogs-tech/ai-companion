import { join } from 'node:path';
import type { HarnessId } from '../../../shared/harness.js';
import type { ExternalConsent } from '../../../shared/external-session.js';
import type { MergeTarget } from '../ports/adapter.js';
import type { WritableFileSystemPort } from '../ports/writable-filesystem-port.js';
import {
  CLAUDE_EXTERNAL_HOOKS,
  CLAUDE_EXTERNAL_NOTIFICATION_MATCHER,
  CURSOR_EXTERNAL_HOOKS,
  EXTERNAL_CONSENT_MARKER,
} from '../external-hooks.js';
import type { MergeMaterializer } from './merge-materializer.js';

interface HookEntry {
  file: string;
  target: MergeTarget;
  seed?: Record<string, unknown>;
}

/**
 * Consent + install for the external-session signal hooks. Nothing is written to
 * the user's `~/.claude/settings.json` / `~/.cursor/hooks.json` before an
 * explicit accept; every entry goes through {@link MergeMaterializer}, which
 * touches only the entries it owns and can take them out again. The consent
 * marker file (`~/.ai-companion/signals/external-enabled`) is what the hook
 * commands check at run time, so removing consent silences them even where an
 * entry could not be removed.
 */
export class ExternalHooksInstaller {
  private readonly marker: string;
  private readonly consentFile: string;

  constructor(
    private readonly merge: Pick<MergeMaterializer, 'apply' | 'remove' | 'validate'>,
    private readonly fs: WritableFileSystemPort,
    private readonly home: string,
  ) {
    const dataDir = join(home, '.ai-companion');
    this.marker = join(dataDir, EXTERNAL_CONSENT_MARKER);
    this.consentFile = join(dataDir, 'signals', 'external-consent');
  }

  async consent(): Promise<ExternalConsent> {
    try {
      const value = (await this.fs.readFile(this.consentFile)).trim();
      return value === 'exact' || value === 'estimated' ? value : 'unset';
    } catch {
      return 'unset';
    }
  }

  /** `exact`: write the marker and install the entries of the harnesses present; `estimated`: remove anything we installed and remember the choice. */
  async setConsent(mode: 'exact' | 'estimated', harnesses: readonly HarnessId[]): Promise<void> {
    await this.fs.mkdir(join(this.home, '.ai-companion', 'signals'), { recursive: true });
    await this.fs.writeFile(this.consentFile, `${mode}\n`);
    if (mode === 'estimated') {
      await this.uninstallEntries();
      await this.fs.remove(this.marker);
      return;
    }
    await this.fs.writeFile(this.marker, '');
    for (const harness of harnesses) {
      for (const entry of this.entries(harness)) await this.merge.apply(entry);
    }
  }

  /** At startup under `exact` consent: installs entries a newer app version added (e.g. SessionEnd), so an existing install keeps up without re-asking. Idempotent. */
  async heal(harnesses: readonly HarnessId[]): Promise<void> {
    if ((await this.consent()) !== 'exact') return;
    for (const harness of harnesses) {
      if (await this.installed(harness)) continue;
      for (const entry of this.entries(harness)) await this.merge.apply(entry);
    }
  }

  /** Revokes consent entirely (Settings): entries out, marker out, back to "ask again". */
  async revoke(): Promise<void> {
    await this.uninstallEntries();
    await this.fs.remove(this.marker);
    await this.fs.remove(this.consentFile);
  }

  async installed(harness: HarnessId): Promise<boolean> {
    const entries = this.entries(harness);
    if (entries.length === 0) return false;
    for (const entry of entries) {
      if ((await this.merge.validate(entry)) !== 'ok') return false;
    }
    return true;
  }

  private async uninstallEntries(): Promise<void> {
    for (const harness of ['claude', 'cursor'] as const) {
      for (const entry of this.entries(harness)) await this.merge.remove(entry);
    }
  }

  private entries(harness: HarnessId): HookEntry[] {
    if (harness === 'claude') {
      const file = join(this.home, '.claude', 'settings.json');
      return Object.entries(CLAUDE_EXTERNAL_HOOKS).map(([event, command]) => {
        const matcher = event === 'Notification' ? CLAUDE_EXTERNAL_NOTIFICATION_MATCHER : undefined;
        const value = { ...(matcher ? { matcher } : {}), hooks: [{ type: 'command', command }] };
        return {
          file,
          target: { shape: 'array-item' as const, path: ['hooks', event], identity: { 'hooks.0.command': command }, value },
        };
      });
    }
    if (harness === 'cursor') {
      const file = join(this.home, '.cursor', 'hooks.json');
      return Object.entries(CURSOR_EXTERNAL_HOOKS).map(([event, command]) => ({
        file,
        target: { shape: 'array-item' as const, path: ['hooks', event], identity: { command }, value: { command } },
        seed: { version: 1 },
      }));
    }
    return [];
  }
}
