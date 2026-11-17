import path from 'node:path';
import type { PluginId } from '../../domain/plugin-id.js';
import type { PluginOrigin } from '../../domain/plugin-origin.js';
import type { PluginSource } from '../../domain/plugin-source.js';
import type { PluginRef } from '../../domain/plugin-ref.js';
import type { PluginCachePort } from '../ports/plugin-cache-port.js';
import type { ClaudeSettingsPort } from '../ports/claude-settings-port.js';
import type { Scope } from '../ports/scope.js';
import {
  addMarketplaceIfMissing,
  enablePlugin,
  removePlugin,
  cleanupMarketplaceIfEmpty,
} from './claude-settings-mutators.js';

export type PluginSummary = {
  id: PluginId;
  origin: PluginOrigin;
  scope: Scope;
  enabled: boolean;
  installedAt: string;
  source?: PluginSource;
  installedRef?: PluginRef;
  marketplaceId?: string;
  /** Set when Claude Code's own `/plugin` also installed it: `claude` = only Claude, `both` = app + Claude. */
  installedBy?: 'claude' | 'both';
  /** Version Claude Code installed (from `installed_plugins.json`). */
  version?: string;
};

type InstallInput = {
  origin: PluginOrigin;
  id: PluginId;
  pluginDir: string;
  tmpDir?: string;
  source?: PluginSource;
  installedRef?: PluginRef;
  scope: Scope;
  marketplaceId?: string;
};

export class PluginInstaller {
  constructor(
    private readonly deps: {
      cache: PluginCachePort;
      settings: ClaudeSettingsPort;
    },
  ) {}

  async install(input: InstallInput): Promise<PluginSummary> {
    const { cache, settings } = this.deps;
    const { id, origin, scope, pluginDir, tmpDir, source, installedRef, marketplaceId } = input;
    const workspacePluginsDir = path.dirname(pluginDir);
    // Plugins from a known upstream marketplace are attributed to it directly.
    // Plugins owned locally or imported via raw URL fall back to the synthetic
    // local marketplace (which we register).
    const usingLocal = marketplaceId == null;

    const compensations: Array<() => Promise<void>> = [];

    try {
      // Step A
      if (origin === 'imported') {
        if (tmpDir == null) {
          throw new Error('tmpDir is required for imported plugins');
        }
        await cache.movePluginDir(tmpDir, pluginDir);
        compensations.push(() => cache.movePluginDir(pluginDir, tmpDir));
      } else {
        // owned: pluginDir already in place — register removal as compensation
        compensations.push(() => cache.removePluginDir(scope, id));
      }

      // Step B
      await settings.symlink(scope, id, pluginDir);
      compensations.push(() => settings.unlink(scope, id));

      // Step C
      await settings.mutate(scope, (s) => {
        const next = usingLocal ? addMarketplaceIfMissing(s, workspacePluginsDir) : s;
        return enablePlugin(next, id, marketplaceId);
      });
      compensations.push(() =>
        settings.mutate(scope, (s) => {
          const next = removePlugin(s, id, marketplaceId);
          return usingLocal ? cleanupMarketplaceIfEmpty(next) : next;
        }),
      );

      // Step D
      const installedAt = new Date().toISOString();
      const existingMeta = await cache.readMeta(scope);
      const newEntry = {
        id,
        origin,
        scope,
        enabled: true,
        installedAt,
        ...(source != null && { source }),
        ...(installedRef != null && { installedRef }),
        ...(marketplaceId != null && { marketplaceId }),
      };
      await cache.writeMeta(scope, {
        ...existingMeta,
        plugins: [...existingMeta.plugins, newEntry],
      });

      return {
        id,
        origin,
        scope,
        enabled: true,
        installedAt,
        ...(source != null && { source }),
        ...(installedRef != null && { installedRef }),
        ...(marketplaceId != null && { marketplaceId }),
      };
    } catch (err) {
      for (const comp of compensations.reverse()) {
        try {
          await comp();
        } catch (rollbackErr) {
          console.error('Rollback error:', rollbackErr);
        }
      }
      throw err;
    }
  }

  async uninstall(id: PluginId, scope: Scope): Promise<void> {
    const { cache, settings } = this.deps;

    // D': read entry first to know its marketplace attribution, then remove from meta
    const existingMeta = await cache.readMeta(scope);
    const entry = existingMeta.plugins.find((p) => p.id === id);
    const marketplaceId = entry?.marketplaceId;
    await cache.writeMeta(scope, {
      ...existingMeta,
      plugins: existingMeta.plugins.filter((p) => p.id !== id),
    });

    // C': remove from settings + cleanup marketplace if empty
    await settings.mutate(scope, (s) => cleanupMarketplaceIfEmpty(removePlugin(s, id, marketplaceId)));

    // B': unlink symlink
    await settings.unlink(scope, id);

    // A': remove plugin dir
    await cache.removePluginDir(scope, id);
  }
}
