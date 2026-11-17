import path from 'node:path';
import type { WritableFileSystemPort } from '../ports/writable-filesystem-port.js';
import type { PluginId } from '../../domain/plugin-id.js';
import type { PluginManifest } from '../../domain/plugin-manifest.js';
import type { PluginPublishInfo } from '../../domain/plugin-publish-info.js';
import type { PluginRef } from '../../domain/plugin-ref.js';
import type { SemVer } from '../../domain/semver.js';
import { PluginCollisionError, OperationNotAllowedForOriginError } from '../../domain/plugin-errors.js';
import { DomainError } from '../../domain/errors.js';
import { normalizeGitUrl } from '../../domain/plugin-source.js';
import type { MarketplaceManifest, MarketplacePlugin } from '../../domain/marketplace-manifest.js';
import type { GitPort } from '../ports/git-port.js';
import type { PluginCachePort } from '../ports/plugin-cache-port.js';
import type { ClaudeSettingsPort } from '../ports/claude-settings-port.js';
import type {
  ClaudeCodePluginDescriptor,
  ClaudeCodePluginRegistryPort,
} from '../ports/claude-code-plugin-registry-port.js';
import type { Scope } from '../ports/scope.js';
import type { PluginSummary } from './plugin-installer.js';
import { enablePlugin, disablePlugin } from './claude-settings-mutators.js';

// ── Structural interfaces ────────────────────────────────────────────────────

export interface PluginInstallerLike {
  install(input: {
    origin: 'imported' | 'owned';
    id: PluginId;
    pluginDir: string;
    tmpDir?: string;
    source?: { kind: 'git'; url: string; ref?: PluginRef };
    installedRef?: PluginRef;
    scope: Scope;
    marketplaceId?: string;
  }): Promise<PluginSummary>;
  uninstall(id: PluginId, scope: Scope): Promise<void>;
}

export interface PluginAuthorServiceLike {
  create(input: {
    id: PluginId;
    version: SemVer;
    description?: string;
    scope: Scope;
  }): Promise<PluginSummary>;
  delete(id: PluginId, scope: Scope): Promise<void>;
}

export interface PluginPublisherLike {
  publish(input: {
    id: PluginId;
    scope: Scope;
    repoName?: string;
    visibility?: 'public' | 'private';
    version: SemVer;
    commitMessage?: string;
  }): Promise<PluginPublishInfo>;
}

export interface PluginManifestParserLike {
  parse(pluginDir: string): Promise<PluginManifest>;
}

export interface MarketplaceParserLike {
  parse(dir: string): Promise<MarketplaceManifest>;
}

// ── Result types ─────────────────────────────────────────────────────────────

export type PluginListItem = PluginSummary & {
  drift?: {
    kind: 'not_in_settings' | 'not_in_registry' | 'not_cached';
    details?: string;
  };
  /** Where Claude Code keeps this plugin's files; set only when Claude registered it. */
  installPath?: string;
};

export type PluginDetail = PluginListItem & {
  manifest?: PluginManifest;
  publishInfo?: PluginPublishInfo;
};

function notCachedDrift(native: ClaudeCodePluginDescriptor): NonNullable<PluginListItem['drift']> {
  return {
    kind: 'not_cached',
    details: `Claude cache missing: ${native.installPath}. Run: claude plugin install ${native.pluginId}@${native.marketplace}`,
  };
}

// ── PluginService ─────────────────────────────────────────────────────────────

export class PluginService {
  constructor(
    private readonly deps: {
      installer: PluginInstallerLike;
      author: PluginAuthorServiceLike;
      publisher: PluginPublisherLike;
      git: GitPort;
      cache: PluginCachePort;
      settings: ClaudeSettingsPort;
      parser: PluginManifestParserLike;
      marketplaceParser: MarketplaceParserLike;
      fs: WritableFileSystemPort;
      /** Claude Code's own plugin registry; plugins installed through `/plugin` are listed from it. */
      claudeRegistry?: ClaudeCodePluginRegistryPort;
    },
  ) {}

  /** Plugins Claude Code installed itself, keyed `id@marketplace`. Personal scope only. */
  private async claudeDescriptors(scope: Scope): Promise<Map<string, ClaudeCodePluginDescriptor>> {
    const out = new Map<string, ClaudeCodePluginDescriptor>();
    const registry = this.deps.claudeRegistry;
    if (scope !== 'personal' || registry === undefined) return out;
    try {
      for (const d of await registry.list()) out.set(`${d.pluginId}@${d.marketplace}`, d);
    } catch (err) {
      console.warn('[PluginService] Claude Code plugin registry unreadable', err);
    }
    return out;
  }

  /**
   * Import a third-party plugin from a git URL.
   */
  async import(input: { url: string; ref?: PluginRef; scope: Scope }): Promise<PluginSummary> {
    const { git, cache, installer, parser, fs } = this.deps;
    const { url, ref, scope } = input;

    const normalizedUrl = normalizeGitUrl(url);

    // 1. Clone to a temp dir
    const tmpDir = await fs.makeTempDir('plugin-import-');

    const { sha } = await git.clone(normalizedUrl, ref, tmpDir);

    // 2. Parse manifest to get the id
    const manifest = await parser.parse(tmpDir);
    const id = manifest.id;

    // 3. Check for collision in meta
    const meta = await cache.readMeta(scope);
    const existing = meta.plugins.find((p) => p.id === id);
    if (existing != null) {
      throw new PluginCollisionError(
        `Plugin '${id}' already exists (origin: ${existing.origin})`,
        { id },
      );
    }

    // 4. Install (moves tmpDir to final dir, registers in settings + meta)
    const pluginDir = cache.pluginDir(scope, id);
    const source: { kind: 'git'; url: string; ref?: PluginRef } = { kind: 'git', url: normalizedUrl };
    if (ref != null) {
      source.ref = ref;
    }
    const summary = await installer.install({
      origin: 'imported',
      id,
      pluginDir,
      tmpDir,
      source,
      installedRef: { kind: 'sha', value: sha },
      scope,
    });

    return summary;
  }

  /**
   * Detect whether a URL points to a marketplace or a single plugin.
   * Local-path plugins (source: "./plugins/xxx") are expanded to git-subdir
   * entries pointing back at the marketplace URL, so they can be installed
   * without any special-casing in importFromMarketplace.
   */
  async detect(url: string): Promise<
    { kind: 'marketplace'; manifest: MarketplaceManifest } | { kind: 'plugin' }
  > {
    const { git, marketplaceParser, fs } = this.deps;
    const normalizedUrl = normalizeGitUrl(url);

    const tmpDir = await fs.makeTempDir('plugin-detect-');

    try {
      await git.clone(normalizedUrl, undefined, tmpDir);

      try {
        const raw = await marketplaceParser.parse(tmpDir);
        const manifest: MarketplaceManifest = {
          ...raw,
          plugins: raw.plugins.map((p) => expandLocalSource(p, normalizedUrl)),
        };
        return { kind: 'marketplace', manifest };
      } catch {
        return { kind: 'plugin' };
      }
    } finally {
      await fs.remove(tmpDir).catch(() => {});
    }
  }

  /**
   * Fetch a marketplace plugin's manifest without installing — for a pre-install
   * preview UI. Clones the plugin to a temp dir, parses the manifest, then deletes
   * the temp dir. Returns id, version, description, and the artifacts list so the
   * UI can show what skills/agents/commands/hooks/MCP/LSP will be added.
   */
  async previewFromMarketplace(
    plugin: MarketplacePlugin,
  ): Promise<PluginManifest> {
    const { git, parser, fs } = this.deps;

    const tmpDir = await fs.makeTempDir('plugin-preview-');

    try {
      await cloneMarketplaceSource(git, plugin.source, tmpDir);
      return await parsePluginManifest(fs, parser, tmpDir, plugin);
    } finally {
      await fs.remove(tmpDir).catch(() => {});
    }
  }

  /**
   * Install a plugin from a marketplace entry. Handles source types:
   * git-subdir, url, github, git. Local-path sources are pre-expanded by detect().
   *
   * `marketplaceId` is the upstream marketplace identifier (as registered in
   * Claude Code's settings). When provided, the plugin is attributed to it in
   * `enabledPlugins` ('<id>@<marketplaceId>'); otherwise it falls back to the
   * synthetic local marketplace.
   */
  async importFromMarketplace(
    plugin: MarketplacePlugin,
    scope: Scope,
    marketplaceId?: string,
  ): Promise<PluginSummary> {
    const { git, cache, installer, parser, fs } = this.deps;

    const tmpDir = await fs.makeTempDir('plugin-marketplace-');

    const cloneResult = await cloneMarketplaceSource(git, plugin.source, tmpDir);

    const manifest = await parsePluginManifest(fs, parser, tmpDir, plugin);
    const id = manifest.id;

    const meta = await cache.readMeta(scope);
    const existing = meta.plugins.find((p) => p.id === id);
    if (existing != null) {
      throw new PluginCollisionError(
        `Plugin '${id}' already exists (origin: ${existing.origin})`,
        { id },
      );
    }

    const pluginDir = cache.pluginDir(scope, id);
    return installer.install({
      origin: 'imported',
      id,
      pluginDir,
      tmpDir,
      source: { kind: 'git', url: cloneResult.url },
      installedRef: { kind: 'sha', value: cloneResult.sha },
      scope,
      ...(marketplaceId != null ? { marketplaceId } : {}),
    });
  }

  /**
   * List all plugins (imported + owned) with drift detection.
   * SPEC §6.9
   */
  async list(scope: Scope): Promise<PluginListItem[]> {
    const { cache, settings, fs } = this.deps;

    const meta = await cache.readMeta(scope);
    const claudeSettings = await settings.read(scope);
    const claude = await this.claudeDescriptors(scope);
    const seen = new Set<string>();

    const result: PluginListItem[] = [];

    // Entries from meta
    for (const entry of meta.plugins) {
      const marketplaceId = entry.marketplaceId ?? 'local';
      const pluginKey = `${entry.id}@${marketplaceId}`;
      const inSettings = claudeSettings.enabledPlugins[pluginKey] === true;

      // Build source carefully to satisfy exactOptionalPropertyTypes
      let entrySource: { kind: 'git'; url: string; ref?: PluginRef } | undefined;
      if (entry.source != null) {
        entrySource = { kind: 'git', url: entry.source.url };
        if (entry.source.ref != null) {
          entrySource.ref = entry.source.ref as PluginRef;
        }
      }

      const item: PluginListItem = {
        id: entry.id as PluginId,
        origin: entry.origin,
        scope: entry.scope,
        enabled: entry.enabled,
        installedAt: entry.installedAt,
        ...(entrySource != null && { source: entrySource }),
        ...(entry.installedRef != null && { installedRef: entry.installedRef as PluginRef }),
        ...(entry.marketplaceId != null && { marketplaceId: entry.marketplaceId }),
      };

      const native = claude.get(pluginKey);
      if (native !== undefined) {
        seen.add(pluginKey);
        item.installedBy = 'both';
        item.version = native.version;
        item.installPath = native.installPath;
      }

      // Claude registered this plugin but its cache dir is gone: Claude cannot load it.
      if (native !== undefined && !(await fs.pathExists(native.installPath))) {
        item.drift = notCachedDrift(native);
      } else if (entry.enabled && !inSettings) {
        // Detect drift: entry says enabled=true but not in settings
        item.drift = { kind: 'not_in_settings' };
      }

      result.push(item);
    }

    // Detect drift: settings has @local entries not in meta. We
    // only scan the synthetic marketplace because upstream marketplaces are
    // managed by the user/Claude and may legitimately list plugins we don't
    // know about.
    const metaIds = new Set(meta.plugins.map((p) => p.id));
    for (const key of Object.keys(claudeSettings.enabledPlugins)) {
      if (!key.endsWith('@local')) continue;
      if (claudeSettings.enabledPlugins[key] !== true) continue;

      const idFromKey = key.slice(0, key.lastIndexOf('@local'));
      if (!metaIds.has(idFromKey)) {
        result.push({
          id: idFromKey as PluginId,
          // We don't know the real origin, use 'imported' as default
          origin: 'imported',
          scope,
          enabled: true,
          installedAt: '',
          drift: { kind: 'not_in_registry' },
        });
      }
    }

    // Plugins only Claude Code knows about (installed through its own `/plugin`).
    for (const [key, native] of claude) {
      if (seen.has(key)) continue;
      const item: PluginListItem = {
        id: native.pluginId,
        origin: 'imported',
        scope,
        enabled: claudeSettings.enabledPlugins[key] === true,
        installedAt: '',
        marketplaceId: native.marketplace,
        installedBy: 'claude',
        version: native.version,
        installPath: native.installPath,
      };
      if (!(await fs.pathExists(native.installPath))) item.drift = notCachedDrift(native);
      result.push(item);
    }

    return result;
  }

  /**
   * Get details for one plugin.
   */
  async get(id: PluginId, scope: Scope): Promise<PluginDetail> {
    const { cache, parser } = this.deps;

    const listItems = await this.list(scope);
    const item = listItems.find((p) => p.id === id);

    if (item == null) {
      throw new DomainError('not_found', `Plugin '${id}' not found in ${scope} scope`, {
        id,
        scope,
      });
    }

    const detail: PluginDetail = { ...item };

    // Try to read manifest from disk — from Claude's copy when only Claude has the plugin.
    const pluginDir = item.installedBy === 'claude' && item.installPath !== undefined ? item.installPath : cache.pluginDir(scope, id);
    try {
      detail.manifest = await parser.parse(pluginDir);
    } catch (err) {
      // Manifest not available (drift case, etc.) — leave undefined, but say why.
      console.warn('[PluginService] cannot read plugin manifest', pluginDir, err);
    }

    // Attach publish info from meta if available
    const meta = await cache.readMeta(scope);
    const entry = meta.plugins.find((p) => p.id === id);
    if (entry?.publish != null) {
      detail.publishInfo = entry.publish as PluginPublishInfo;
    }

    return detail;
  }

  /**
   * Remove a plugin (both imported and owned origins).
   */
  async remove(id: PluginId, scope: Scope): Promise<void> {
    const { installer } = this.deps;
    await this.assertNotClaudeOnly(id, scope, 'remove');
    await installer.uninstall(id, scope);
  }

  /** A plugin only Claude Code installed has no app registry entry — the app must not change it. */
  private async assertNotClaudeOnly(id: PluginId, scope: Scope, operation: string): Promise<void> {
    const meta = await this.deps.cache.readMeta(scope);
    if (meta.plugins.some((p) => p.id === id)) return;
    const onlyInClaude = [...(await this.claudeDescriptors(scope)).values()].some((d) => d.pluginId === id);
    if (onlyInClaude) {
      throw new OperationNotAllowedForOriginError(
        `Plugin '${id}' was installed by Claude Code; manage it with /plugin in Claude`,
        { origin: 'claude', operation },
      );
    }
  }

  /**
   * Toggle a plugin enabled/disabled.
   */
  async toggle(id: PluginId, scope: Scope, enabled: boolean): Promise<void> {
    const { settings, cache } = this.deps;

    await this.assertNotClaudeOnly(id, scope, 'toggle');
    // Read meta first to honor the plugin's marketplace attribution
    const meta = await cache.readMeta(scope);
    const entry = meta.plugins.find((p) => p.id === id);
    const marketplaceId = entry?.marketplaceId;

    // Update settings (Claude Code's source of truth) first.
    await settings.mutate(scope, (s) =>
      enabled ? enablePlugin(s, id, marketplaceId) : disablePlugin(s, id, marketplaceId),
    );

    // Update meta (the app's registry). settings.json and _meta.json are
    // separate stores with no shared transaction; if this write fails, roll the
    // settings mutation back so the two can't diverge — a plugin the UI reads as
    // enabled while Claude Code has it disabled, or vice versa.
    try {
      await cache.writeMeta(scope, {
        ...meta,
        plugins: meta.plugins.map((p) =>
          p.id === id ? { ...p, enabled } : p,
        ),
      });
    } catch (err) {
      await settings.mutate(scope, (s) =>
        enabled ? disablePlugin(s, id, marketplaceId) : enablePlugin(s, id, marketplaceId),
      );
      throw err;
    }
  }

  /**
   * Update an imported plugin (pull latest on branch).
   * SPEC §6.6
   */
  async update(id: PluginId, scope: Scope): Promise<PluginSummary> {
    const { cache, git, parser } = this.deps;

    // 1. Read meta, find entry
    const meta = await cache.readMeta(scope);
    const entry = meta.plugins.find((p) => p.id === id);

    if (entry == null) {
      throw new DomainError('not_found', `Plugin '${id}' not found in ${scope} scope`, {
        id,
        scope,
      });
    }

    // 2. Only imported plugins can be updated
    if (entry.origin !== 'imported') {
      throw new OperationNotAllowedForOriginError(
        `Cannot update plugin with origin '${entry.origin}'; only 'imported' plugins can be updated`,
        { origin: entry.origin, operation: 'update' },
      );
    }

    // 3. Must be pinned to a branch
    if (entry.installedRef == null || entry.installedRef.kind !== 'branch') {
      const pinnedTo = entry.installedRef?.kind ?? 'nothing';
      throw new DomainError(
        'validation',
        `Can only update plugins pinned to a branch (plugin '${id}' is pinned to ${pinnedTo})`,
        { id, pinnedTo },
      );
    }

    const pluginDir = cache.pluginDir(scope, id);

    // 4. Pull latest
    const { sha: newSha } = await git.pull(pluginDir);

    // 5. Parse manifest (sanity check)
    await parser.parse(pluginDir);

    // 6. Update meta
    const updatedAt = new Date().toISOString();
    const updatedEntry = {
      ...entry,
      installedRef: { kind: 'sha' as const, value: newSha },
      installedAt: updatedAt,
    };

    await cache.writeMeta(scope, {
      ...meta,
      plugins: meta.plugins.map((p) => (p.id === id ? updatedEntry : p)),
    });

    // Build source for return value, satisfying exactOptionalPropertyTypes
    let returnSource: { kind: 'git'; url: string; ref?: PluginRef } | undefined;
    if (updatedEntry.source != null) {
      returnSource = { kind: 'git', url: updatedEntry.source.url };
      if (updatedEntry.source.ref != null) {
        returnSource.ref = updatedEntry.source.ref as PluginRef;
      }
    }

    return {
      id: updatedEntry.id as PluginId,
      origin: updatedEntry.origin,
      scope: updatedEntry.scope,
      enabled: updatedEntry.enabled,
      installedAt: updatedEntry.installedAt,
      ...(returnSource != null && { source: returnSource }),
      installedRef: updatedEntry.installedRef as PluginRef,
    };
  }

  /**
   * Create an owned plugin.
   */
  async createOwned(input: {
    id: PluginId;
    version: SemVer;
    description?: string;
    scope: Scope;
  }): Promise<PluginSummary> {
    return this.deps.author.create(input);
  }

  /**
   * Delete an owned plugin.
   */
  async deleteOwned(id: PluginId, scope: Scope): Promise<void> {
    return this.deps.author.delete(id, scope);
  }

  /**
   * Publish an owned plugin to GitHub.
   */
  async publish(input: {
    id: PluginId;
    scope: Scope;
    repoName?: string;
    visibility?: 'public' | 'private';
    version: SemVer;
    commitMessage?: string;
  }): Promise<PluginPublishInfo> {
    return this.deps.publisher.publish(input);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function expandLocalSource(
  plugin: MarketplacePlugin,
  marketplaceUrl: string,
): MarketplacePlugin {
  if (typeof plugin.source !== 'string') return plugin;
  const localPath = plugin.source.replace(/^\.\//, '');
  return {
    ...plugin,
    source: { source: 'git-subdir', url: marketplaceUrl, path: localPath },
  };
}

/**
 * Parse the plugin manifest from a cloned source dir, synthesizing one first for
 * inline-defined plugins.
 *
 * LSP/MCP plugins on the official marketplace are defined entirely in the
 * marketplace entry (an inline `lspServers`/`mcpServers` block) and ship no
 * `.claude-plugin/plugin.json` in their source subdir — that dir holds only a
 * LICENSE and README. The parser would reject them as "manifest not found". When
 * the entry is inline and the subdir genuinely lacks a manifest, we write one
 * synthesized from the entry so the install can proceed; the inline server block
 * is carried into the plugin.json verbatim for Claude Code to read.
 *
 * We only synthesize when no manifest file exists — a present-but-invalid
 * manifest still surfaces its real schema error rather than being masked.
 */
async function parsePluginManifest(
  fs: WritableFileSystemPort,
  parser: PluginManifestParserLike,
  tmpDir: string,
  plugin: MarketplacePlugin,
): Promise<PluginManifest> {
  if (isInlinePlugin(plugin) && !(await manifestExists(fs, tmpDir))) {
    await writeSynthesizedManifest(fs, tmpDir, plugin);
  }
  return parser.parse(tmpDir);
}

/** A plugin whose behavior lives in an inline `lspServers`/`mcpServers` block. */
function isInlinePlugin(plugin: MarketplacePlugin): boolean {
  const raw = plugin as Record<string, unknown>;
  return isNonEmptyObject(raw['lspServers']) || isNonEmptyObject(raw['mcpServers']);
}

function isNonEmptyObject(value: unknown): boolean {
  return typeof value === 'object' && value !== null && Object.keys(value).length > 0;
}

async function manifestExists(fs: WritableFileSystemPort, dir: string): Promise<boolean> {
  return fs.pathExists(path.join(dir, '.claude-plugin', 'plugin.json'));
}

/** Write a `.claude-plugin/plugin.json` derived from an inline marketplace entry. */
async function writeSynthesizedManifest(
  fs: WritableFileSystemPort,
  dir: string,
  plugin: MarketplacePlugin,
): Promise<void> {
  const raw = plugin as Record<string, unknown>;
  const manifest: Record<string, unknown> = {
    name: plugin.name,
    version: typeof raw['version'] === 'string' ? raw['version'] : '1.0.0',
    description: plugin.description,
  };
  if (isNonEmptyObject(raw['lspServers'])) manifest['lspServers'] = raw['lspServers'];
  if (isNonEmptyObject(raw['mcpServers'])) manifest['mcpServers'] = raw['mcpServers'];

  const manifestDir = path.join(dir, '.claude-plugin');
  await fs.mkdir(manifestDir, { recursive: true });
  await fs.writeFile(path.join(manifestDir, 'plugin.json'), JSON.stringify(manifest, null, 2));
}

async function cloneMarketplaceSource(
  git: GitPort,
  source: MarketplacePlugin['source'],
  tmpDir: string,
): Promise<{ sha: string; url: string }> {
  if (typeof source === 'string') {
    throw new Error(
      `Cannot install local-path plugin without marketplace URL: '${source}'. Use marketplace.detect() first.`,
    );
  }

  const s = source as { source?: string; url?: string; path?: string; ref?: string; sha?: string; repo?: string; commit?: string };

  if (s.source === 'git-subdir') {
    const { sha } = await git.cloneSubdir(s.url!, s.path!, s.ref, tmpDir);
    return { sha, url: s.url! };
  }

  if (s.source === 'url' || s.source === 'git') {
    const ref = s.sha
      ? ({ kind: 'sha', value: s.sha } as const)
      : s.ref
        ? ({ kind: 'branch', value: s.ref } as const)
        : undefined;
    const { sha } = await git.clone(s.url!, ref, tmpDir);
    return { sha, url: s.url! };
  }

  if (s.source === 'github') {
    const url = `https://github.com/${s.repo!}.git`;
    const ref = s.commit ? ({ kind: 'sha', value: s.commit } as const) : undefined;
    const { sha } = await git.clone(url, ref, tmpDir);
    return { sha, url };
  }

  throw new Error(
    `Unsupported marketplace plugin source type: '${String(s.source)}'. ` +
      `Supported types: git-subdir, url, git, github.`,
  );
}
