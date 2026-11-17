import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  PluginService,
  type PluginInstallerLike,
  type PluginAuthorServiceLike,
  type PluginPublisherLike,
  type PluginManifestParserLike,
  type MarketplaceParserLike,
} from '../../../../src/main/application/services/plugin-service.js';
import type { MarketplaceManifest } from '../../../../src/main/domain/marketplace-manifest.js';
import { FakeGitPort } from '../../../../src/main/application/services/__fixtures__/fake-git-port.js';
import { FakePluginCachePort } from '../../../../src/main/application/services/__fixtures__/fake-plugin-cache-port.js';
import { FakeClaudeSettingsPort } from '../../../../src/main/application/services/__fixtures__/fake-claude-settings-port.js';
import { InMemoryFileSystem } from '../../../../src/main/infrastructure/filesystem/in-memory-filesystem.js';
import {
  PluginCollisionError,
  OperationNotAllowedForOriginError,
} from '../../../../src/main/domain/plugin-errors.js';
import { pluginId } from '../../../../src/main/domain/plugin-id.js';
import { semVer } from '../../../../src/main/domain/semver.js';
import type { PluginId } from '../../../../src/main/domain/plugin-id.js';
import type { PluginSummary } from '../../../../src/main/application/services/plugin-installer.js';
import type { MetaFile, MetaEntry } from '../../../../src/main/application/schemas/meta-file.schema.js';
import type { PluginManifest } from '../../../../src/main/domain/plugin-manifest.js';
import type { PluginPublishInfo } from '../../../../src/main/domain/plugin-publish-info.js';

// ── Constants ────────────────────────────────────────────────────────────────

const IMPORTED_ID = pluginId('my-imported-plugin');
const OWNED_ID = pluginId('my-owned-plugin');
const SCOPE = 'personal' as const;
const GIT_URL = 'https://github.com/some-owner/some-plugin.git';
const VERSION = semVer('1.0.0');

// ── Minimal fakes for PluginAuthorServiceLike, PluginPublisherLike ───────────

function makeFakeManifest(id: PluginId): PluginManifest {
  return {
    id,
    version: semVer('1.0.0'),
    artifacts: { skills: [], agents: [], commands: [], hooks: 0, mcp: false, lsp: false },
  };
}

class FakeInstallerPort implements PluginInstallerLike {
  public installed: Array<Parameters<PluginInstallerLike['install']>[0]> = [];
  public uninstalled: Array<{ id: PluginId; scope: typeof SCOPE }> = [];

  async install(input: Parameters<PluginInstallerLike['install']>[0]): Promise<PluginSummary> {
    this.installed.push(input);
    return {
      id: input.id,
      origin: input.origin,
      scope: input.scope,
      enabled: true,
      installedAt: new Date().toISOString(),
      ...(input.source != null && { source: input.source }),
      ...(input.installedRef != null && { installedRef: input.installedRef }),
    };
  }

  async uninstall(id: PluginId, scope: typeof SCOPE): Promise<void> {
    this.uninstalled.push({ id, scope });
  }
}

class FakeAuthorService implements PluginAuthorServiceLike {
  public created: Array<Parameters<PluginAuthorServiceLike['create']>[0]> = [];
  public deleted: Array<{ id: PluginId; scope: typeof SCOPE }> = [];

  async create(input: Parameters<PluginAuthorServiceLike['create']>[0]): Promise<PluginSummary> {
    this.created.push(input);
    return {
      id: input.id,
      origin: 'owned',
      scope: input.scope,
      enabled: true,
      installedAt: new Date().toISOString(),
    };
  }

  async delete(id: PluginId, scope: typeof SCOPE): Promise<void> {
    this.deleted.push({ id, scope });
  }
}

class FakePublisher implements PluginPublisherLike {
  public published: Array<Parameters<PluginPublisherLike['publish']>[0]> = [];
  public publishResult: PluginPublishInfo = {
    remoteUrl: 'https://github.com/owner/repo',
    visibility: 'public',
    lastPublishedSha: 'abc123',
    lastPublishedVersion: semVer('1.0.0'),
    lastPublishedAt: new Date().toISOString(),
  };

  async publish(input: Parameters<PluginPublisherLike['publish']>[0]): Promise<PluginPublishInfo> {
    this.published.push(input);
    return this.publishResult;
  }
}

class FakeMarketplaceParser implements MarketplaceParserLike {
  private manifest: MarketplaceManifest | null = null;

  seed(manifest: MarketplaceManifest): void {
    this.manifest = manifest;
  }

  async parse(_dir: string): Promise<MarketplaceManifest> {
    if (this.manifest == null) throw new Error('No marketplace manifest seeded');
    return this.manifest;
  }
}

class FakeManifestParser implements PluginManifestParserLike {
  private manifests: Map<string, PluginManifest> = new Map();
  private defaultManifest: PluginManifest | null = null;

  seed(dir: string, manifest: PluginManifest): void {
    this.manifests.set(dir, manifest);
  }

  /**
   * Seeds a manifest for a plugin id. The manifest will match:
   * - Exact path: `scope/plugins/<id>`
   * - Any path ending with the id (e.g. cached plugin dir)
   * - Any unknown path (tmpDir during import) via the default fallback
   */
  seedById(id: PluginId): void {
    const manifest = makeFakeManifest(id);
    // Match by id suffix (cached plugin dir)
    this.manifests.set(id, manifest);
    // Also set as default so random tmpDirs match too
    this.defaultManifest = manifest;
  }

  async parse(pluginDir: string): Promise<PluginManifest> {
    // Check for exact match
    const exact = this.manifests.get(pluginDir);
    if (exact != null) return exact;

    // Check if dir ends with a known id
    for (const [key, manifest] of this.manifests) {
      if (pluginDir.endsWith(key)) {
        return manifest;
      }
    }

    // Fall back to default (covers random tmpDirs in import())
    if (this.defaultManifest != null) {
      return this.defaultManifest;
    }

    throw new Error(`No manifest seeded for dir: ${pluginDir}`);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeImportedEntry(id: PluginId, overrides?: Partial<MetaEntry>): MetaEntry {
  return {
    id,
    origin: 'imported' as const,
    installedAt: '2026-01-01T00:00:00Z',
    scope: SCOPE,
    enabled: true,
    source: { kind: 'git', url: GIT_URL },
    installedRef: { kind: 'branch', value: 'main' },
    ...overrides,
  };
}

function makeOwnedEntry(id: PluginId, overrides?: Partial<MetaEntry>): MetaEntry {
  return {
    id,
    origin: 'owned' as const,
    installedAt: '2026-01-01T00:00:00Z',
    scope: SCOPE,
    enabled: true,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PluginService', () => {
  let git: FakeGitPort;
  let cache: FakePluginCachePort;
  let settings: FakeClaudeSettingsPort;
  let installer: FakeInstallerPort;
  let author: FakeAuthorService;
  let publisher: FakePublisher;
  let parser: FakeManifestParser;
  let marketplaceParser: FakeMarketplaceParser;
  let service: PluginService;

  beforeEach(() => {
    git = new FakeGitPort();
    cache = new FakePluginCachePort();
    settings = new FakeClaudeSettingsPort();
    installer = new FakeInstallerPort();
    author = new FakeAuthorService();
    publisher = new FakePublisher();
    parser = new FakeManifestParser();
    marketplaceParser = new FakeMarketplaceParser();

    service = new PluginService({
      installer,
      author,
      publisher,
      git,
      cache,
      settings,
      parser,
      marketplaceParser,
      fs: new InMemoryFileSystem(),
    });
  });

  // ── import ──────────────────────────────────────────────────────────────────

  describe('import', () => {
    it('happy path: returns PluginSummary with origin=imported', async () => {
      parser.seedById(IMPORTED_ID);

      const result = await service.import({ url: GIT_URL, scope: SCOPE });

      expect(result.origin).toBe('imported');
      expect(result.id).toBe(IMPORTED_ID);
      expect(result.scope).toBe(SCOPE);
      expect(installer.installed).toHaveLength(1);
      expect(installer.installed[0]?.origin).toBe('imported');
      expect(installer.installed[0]?.id).toBe(IMPORTED_ID);
    });

    it('throws PluginCollisionError when id already exists as imported', async () => {
      const existingMeta: MetaFile = {
        version: 2,
        plugins: [makeImportedEntry(IMPORTED_ID)],
      };
      cache.seedMeta(SCOPE, existingMeta);
      parser.seedById(IMPORTED_ID);

      await expect(service.import({ url: GIT_URL, scope: SCOPE })).rejects.toThrowError(
        PluginCollisionError,
      );
    });

    it('throws PluginCollisionError when id already exists as owned', async () => {
      const existingMeta: MetaFile = {
        version: 2,
        plugins: [makeOwnedEntry(IMPORTED_ID)],
      };
      cache.seedMeta(SCOPE, existingMeta);
      parser.seedById(IMPORTED_ID);

      await expect(service.import({ url: GIT_URL, scope: SCOPE })).rejects.toThrowError(
        PluginCollisionError,
      );
    });

    it('passes installedRef with sha from git.clone result', async () => {
      git.seedSha(GIT_URL, undefined, 'deadbeef');
      parser.seedById(IMPORTED_ID);

      await service.import({ url: GIT_URL, scope: SCOPE });

      const installCall = installer.installed[0];
      expect(installCall?.installedRef).toEqual({ kind: 'sha', value: 'deadbeef' });
    });

    it('passes ref to git.clone when ref is provided', async () => {
      const ref = { kind: 'branch' as const, value: 'feature-branch' };
      parser.seedById(IMPORTED_ID);

      await service.import({ url: GIT_URL, ref, scope: SCOPE });

      expect(installer.installed[0]?.source).toMatchObject({ ref });
    });
  });

  // ── list ────────────────────────────────────────────────────────────────────

  describe('list', () => {
    it('returns both imported and owned entries', async () => {
      const meta: MetaFile = {
        version: 2,
        plugins: [makeImportedEntry(IMPORTED_ID), makeOwnedEntry(OWNED_ID)],
      };
      cache.seedMeta(SCOPE, meta);
      settings.seedSettings(SCOPE, {
        extraKnownMarketplaces: {},
        enabledPlugins: {
          [`${IMPORTED_ID}@local`]: true,
          [`${OWNED_ID}@local`]: true,
        },
      });

      const result = await service.list(SCOPE);

      expect(result).toHaveLength(2);
      expect(result.find((p) => p.id === IMPORTED_ID)?.origin).toBe('imported');
      expect(result.find((p) => p.id === OWNED_ID)?.origin).toBe('owned');
    });

    it('detects not_in_settings drift for enabled meta entry missing from settings', async () => {
      const meta: MetaFile = {
        version: 2,
        plugins: [makeImportedEntry(IMPORTED_ID, { enabled: true })],
      };
      cache.seedMeta(SCOPE, meta);
      // No entry in settings for IMPORTED_ID

      const result = await service.list(SCOPE);

      const item = result.find((p) => p.id === IMPORTED_ID);
      expect(item?.drift?.kind).toBe('not_in_settings');
    });

    it('no drift when meta and settings are in sync', async () => {
      const meta: MetaFile = {
        version: 2,
        plugins: [makeImportedEntry(IMPORTED_ID, { enabled: true })],
      };
      cache.seedMeta(SCOPE, meta);
      settings.seedSettings(SCOPE, {
        extraKnownMarketplaces: {},
        enabledPlugins: { [`${IMPORTED_ID}@local`]: true },
      });

      const result = await service.list(SCOPE);

      const item = result.find((p) => p.id === IMPORTED_ID);
      expect(item?.drift).toBeUndefined();
    });

    it('detects not_in_registry drift for settings entry missing from meta', async () => {
      // Meta is empty but settings has an entry
      cache.seedMeta(SCOPE, { version: 2, plugins: [] });
      settings.seedSettings(SCOPE, {
        extraKnownMarketplaces: {},
        enabledPlugins: { [`${IMPORTED_ID}@local`]: true },
      });

      const result = await service.list(SCOPE);

      const item = result.find((p) => p.id === IMPORTED_ID);
      expect(item?.drift?.kind).toBe('not_in_registry');
    });
  });

  describe('Claude Code installed plugins', () => {
    const MP = 'claude-plugins-official';
    const NATIVE_ID = pluginId('feature-dev');
    const INSTALL_PATH = '/home/u/.claude/plugins/cache/claude-plugins-official/feature-dev/1.0.1';
    const descriptor = { pluginId: NATIVE_ID, marketplace: MP, installPath: INSTALL_PATH, version: '1.0.1', scope: 'user' as const };

    const withRegistry = (descriptors: unknown[], fs = new InMemoryFileSystem()): { svc: PluginService; fs: InMemoryFileSystem } => ({
      fs,
      svc: new PluginService({
        installer, author, publisher, git, cache, settings, parser, marketplaceParser, fs,
        claudeRegistry: { list: async () => descriptors as never },
      }),
    });

    it('lists a plugin only Claude installed, enabled from Claude settings', async () => {
      cache.seedMeta(SCOPE, { version: 2, plugins: [] });
      settings.seedSettings(SCOPE, { extraKnownMarketplaces: {}, enabledPlugins: { [`${NATIVE_ID}@${MP}`]: true } });
      const fs = new InMemoryFileSystem();
      fs.createFile(`${INSTALL_PATH}/README.md`, 'x');
      const { svc } = withRegistry([descriptor], fs);

      const item = (await svc.list(SCOPE)).find((p) => p.id === NATIVE_ID);

      expect(item).toMatchObject({ installedBy: 'claude', version: '1.0.1', enabled: true, marketplaceId: MP, installPath: INSTALL_PATH });
      expect(item?.drift).toBeUndefined();
    });

    it('lists one row, marked as both, when the app imported the same plugin', async () => {
      cache.seedMeta(SCOPE, { version: 2, plugins: [makeImportedEntry(NATIVE_ID, { marketplaceId: MP })] });
      settings.seedSettings(SCOPE, { extraKnownMarketplaces: {}, enabledPlugins: { [`${NATIVE_ID}@${MP}`]: true } });
      const fs = new InMemoryFileSystem();
      fs.createFile(`${INSTALL_PATH}/README.md`, 'x');
      const { svc } = withRegistry([descriptor], fs);

      const items = (await svc.list(SCOPE)).filter((p) => p.id === NATIVE_ID);

      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ installedBy: 'both', origin: 'imported', version: '1.0.1' });
    });

    it('flags not_cached, with the reinstall command, when Claude registered it but its cache is gone', async () => {
      cache.seedMeta(SCOPE, { version: 2, plugins: [] });
      settings.seedSettings(SCOPE, { extraKnownMarketplaces: {}, enabledPlugins: {} });
      const { svc } = withRegistry([descriptor]);

      const item = (await svc.list(SCOPE)).find((p) => p.id === NATIVE_ID);

      expect(item?.drift?.kind).toBe('not_cached');
      expect(item?.drift?.details).toContain(`claude plugin install ${NATIVE_ID}@${MP}`);
    });

    it('does not merge Claude plugins into the project scope', async () => {
      cache.seedMeta('project', { version: 2, plugins: [] });
      settings.seedSettings('project', { extraKnownMarketplaces: {}, enabledPlugins: {} });
      const { svc } = withRegistry([descriptor]);
      expect(await svc.list('project')).toEqual([]);
    });

    it('still lists the app plugins when the Claude registry throws', async () => {
      cache.seedMeta(SCOPE, { version: 2, plugins: [makeOwnedEntry(OWNED_ID)] });
      settings.seedSettings(SCOPE, { extraKnownMarketplaces: {}, enabledPlugins: { [`${OWNED_ID}@local`]: true } });
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const svc = new PluginService({
        installer, author, publisher, git, cache, settings, parser, marketplaceParser, fs: new InMemoryFileSystem(),
        claudeRegistry: { list: async () => { throw new Error('boom'); } },
      });
      expect((await svc.list(SCOPE)).map((p) => p.id)).toEqual([OWNED_ID]);
      warn.mockRestore();
    });

    it('refuses to remove or toggle a plugin only Claude installed', async () => {
      cache.seedMeta(SCOPE, { version: 2, plugins: [] });
      settings.seedSettings(SCOPE, { extraKnownMarketplaces: {}, enabledPlugins: {} });
      const { svc } = withRegistry([descriptor]);
      await expect(svc.remove(NATIVE_ID, SCOPE)).rejects.toBeInstanceOf(OperationNotAllowedForOriginError);
      await expect(svc.toggle(NATIVE_ID, SCOPE, false)).rejects.toBeInstanceOf(OperationNotAllowedForOriginError);
      expect(installer.uninstalled).toEqual([]);
    });
  });

  // ── get ─────────────────────────────────────────────────────────────────────

  describe('get', () => {
    it('returns detail with manifest for existing plugin', async () => {
      const meta: MetaFile = {
        version: 2,
        plugins: [makeImportedEntry(IMPORTED_ID)],
      };
      cache.seedMeta(SCOPE, meta);
      settings.seedSettings(SCOPE, {
        extraKnownMarketplaces: {},
        enabledPlugins: { [`${IMPORTED_ID}@local`]: true },
      });
      parser.seedById(IMPORTED_ID);

      const detail = await service.get(IMPORTED_ID, SCOPE);

      expect(detail.id).toBe(IMPORTED_ID);
      expect(detail.manifest).toBeDefined();
      expect(detail.manifest?.id).toBe(IMPORTED_ID);
    });

    it('returns detail without manifest when parser fails (drift case)', async () => {
      const meta: MetaFile = {
        version: 2,
        plugins: [makeImportedEntry(IMPORTED_ID)],
      };
      cache.seedMeta(SCOPE, meta);
      settings.seedSettings(SCOPE, {
        extraKnownMarketplaces: {},
        enabledPlugins: { [`${IMPORTED_ID}@local`]: true },
      });
      // No manifest seeded → parser will throw → detail.manifest should be undefined

      const detail = await service.get(IMPORTED_ID, SCOPE);

      expect(detail.id).toBe(IMPORTED_ID);
      expect(detail.manifest).toBeUndefined();
    });

    it('attaches publishInfo when entry has publish data', async () => {
      const publishInfo: PluginPublishInfo = {
        remoteUrl: 'https://github.com/owner/repo',
        visibility: 'public',
        lastPublishedSha: 'abc123',
        lastPublishedVersion: semVer('1.0.0'),
        lastPublishedAt: '2026-01-01T00:00:00Z',
      };
      const meta: MetaFile = {
        version: 2,
        plugins: [makeOwnedEntry(OWNED_ID, { publish: publishInfo })],
      };
      cache.seedMeta(SCOPE, meta);
      settings.seedSettings(SCOPE, {
        extraKnownMarketplaces: {},
        enabledPlugins: { [`${OWNED_ID}@local`]: true },
      });

      const detail = await service.get(OWNED_ID, SCOPE);

      expect(detail.publishInfo).toEqual(publishInfo);
    });

    it('throws when plugin not found', async () => {
      cache.seedMeta(SCOPE, { version: 2, plugins: [] });

      await expect(service.get(IMPORTED_ID, SCOPE)).rejects.toThrow(/not found/);
    });

    it('get() throws not_found DomainError for an unknown plugin', async () => {
      cache.seedMeta(SCOPE, { version: 2, plugins: [] });

      await expect(
        service.get(pluginId('ghost') as never, SCOPE),
      ).rejects.toMatchObject({ kind: 'not_found' });
    });
  });

  // ── remove ──────────────────────────────────────────────────────────────────

  describe('remove', () => {
    it('delegates to installer.uninstall for imported plugin', async () => {
      await service.remove(IMPORTED_ID, SCOPE);

      expect(installer.uninstalled).toHaveLength(1);
      expect(installer.uninstalled[0]).toEqual({ id: IMPORTED_ID, scope: SCOPE });
    });

    it('delegates to installer.uninstall for owned plugin', async () => {
      await service.remove(OWNED_ID, SCOPE);

      expect(installer.uninstalled).toHaveLength(1);
      expect(installer.uninstalled[0]).toEqual({ id: OWNED_ID, scope: SCOPE });
    });
  });

  // ── toggle ──────────────────────────────────────────────────────────────────

  describe('toggle', () => {
    beforeEach(() => {
      const meta: MetaFile = {
        version: 2,
        plugins: [makeImportedEntry(IMPORTED_ID, { enabled: false })],
      };
      cache.seedMeta(SCOPE, meta);
      settings.seedSettings(SCOPE, {
        extraKnownMarketplaces: {},
        enabledPlugins: {},
      });
    });

    it('enables the plugin in settings and meta', async () => {
      await service.toggle(IMPORTED_ID, SCOPE, true);

      const updatedSettings = settings.getSettings(SCOPE);
      expect(updatedSettings.enabledPlugins[`${IMPORTED_ID}@local`]).toBe(true);

      const updatedMeta = cache.getMeta(SCOPE);
      const entry = updatedMeta?.plugins.find((p) => p.id === IMPORTED_ID);
      expect(entry?.enabled).toBe(true);
    });

    it('disables the plugin in settings and meta', async () => {
      // First enable it so settings has an entry
      settings.seedSettings(SCOPE, {
        extraKnownMarketplaces: {},
        enabledPlugins: { [`${IMPORTED_ID}@local`]: true },
      });
      const meta: MetaFile = {
        version: 2,
        plugins: [makeImportedEntry(IMPORTED_ID, { enabled: true })],
      };
      cache.seedMeta(SCOPE, meta);

      await service.toggle(IMPORTED_ID, SCOPE, false);

      const updatedSettings = settings.getSettings(SCOPE);
      expect(updatedSettings.enabledPlugins[`${IMPORTED_ID}@local`]).toBe(false);

      const updatedMeta = cache.getMeta(SCOPE);
      const entry = updatedMeta?.plugins.find((p) => p.id === IMPORTED_ID);
      expect(entry?.enabled).toBe(false);
    });

    it('rolls the settings mutation back when the meta write fails', async () => {
      // settings.json and _meta.json are separate stores; a failed meta write
      // must not leave settings flipped on, or the two diverge permanently.
      const boom = new Error('disk full');
      vi.spyOn(cache, 'writeMeta').mockRejectedValueOnce(boom);

      await expect(service.toggle(IMPORTED_ID, SCOPE, true)).rejects.toThrow(boom);

      const updatedSettings = settings.getSettings(SCOPE);
      expect(updatedSettings.enabledPlugins[`${IMPORTED_ID}@local`]).not.toBe(true);
    });
  });

  // ── update ──────────────────────────────────────────────────────────────────

  describe('update', () => {
    it('throws OperationNotAllowedForOriginError for owned plugin', async () => {
      const meta: MetaFile = {
        version: 2,
        plugins: [makeOwnedEntry(OWNED_ID)],
      };
      cache.seedMeta(SCOPE, meta);

      await expect(service.update(OWNED_ID, SCOPE)).rejects.toThrowError(
        OperationNotAllowedForOriginError,
      );
    });

    it('throws when plugin is pinned to a tag ref', async () => {
      const meta: MetaFile = {
        version: 2,
        plugins: [
          makeImportedEntry(IMPORTED_ID, { installedRef: { kind: 'tag', value: 'v1.0.0' } }),
        ],
      };
      cache.seedMeta(SCOPE, meta);

      await expect(service.update(IMPORTED_ID, SCOPE)).rejects.toThrow(
        /Can only update plugins pinned to a branch/,
      );
    });

    it('throws when plugin is pinned to a sha ref', async () => {
      const meta: MetaFile = {
        version: 2,
        plugins: [
          makeImportedEntry(IMPORTED_ID, { installedRef: { kind: 'sha', value: 'abc123' } }),
        ],
      };
      cache.seedMeta(SCOPE, meta);

      await expect(service.update(IMPORTED_ID, SCOPE)).rejects.toThrow(
        /Can only update plugins pinned to a branch/,
      );
    });

    it('non-branch update rejects with a validation DomainError', async () => {
      const meta: MetaFile = {
        version: 2,
        plugins: [
          makeImportedEntry(IMPORTED_ID, { installedRef: { kind: 'tag', value: 'v1.0.0' } }),
        ],
      };
      cache.seedMeta(SCOPE, meta);

      await expect(service.update(IMPORTED_ID, SCOPE)).rejects.toMatchObject({ kind: 'validation' });
    });

    it('happy path: pulls, updates meta, returns updated PluginSummary', async () => {
      const meta: MetaFile = {
        version: 2,
        plugins: [
          makeImportedEntry(IMPORTED_ID, { installedRef: { kind: 'branch', value: 'main' } }),
        ],
      };
      cache.seedMeta(SCOPE, meta);
      parser.seedById(IMPORTED_ID);

      const result = await service.update(IMPORTED_ID, SCOPE);

      expect(result.id).toBe(IMPORTED_ID);
      expect(result.origin).toBe('imported');
      // installedRef should now be a sha (updated after pull)
      expect(result.installedRef?.kind).toBe('sha');

      // Meta should also be updated
      const updatedMeta = cache.getMeta(SCOPE);
      const entry = updatedMeta?.plugins.find((p) => p.id === IMPORTED_ID);
      expect(entry?.installedRef?.kind).toBe('sha');
    });

    it('throws when plugin not found', async () => {
      cache.seedMeta(SCOPE, { version: 2, plugins: [] });

      await expect(service.update(IMPORTED_ID, SCOPE)).rejects.toThrow(/not found/);
    });

    it('update() throws not_found DomainError for an unknown plugin', async () => {
      cache.seedMeta(SCOPE, { version: 2, plugins: [] });

      await expect(
        service.update(pluginId('ghost') as never, SCOPE),
      ).rejects.toMatchObject({ kind: 'not_found' });
    });
  });

  // ── createOwned ─────────────────────────────────────────────────────────────

  describe('createOwned', () => {
    it('delegates to author.create', async () => {
      const result = await service.createOwned({
        id: OWNED_ID,
        version: VERSION,
        description: 'A test plugin',
        scope: SCOPE,
      });

      expect(author.created).toHaveLength(1);
      expect(author.created[0]).toMatchObject({ id: OWNED_ID, version: VERSION, scope: SCOPE });
      expect(result.origin).toBe('owned');
    });
  });

  // ── deleteOwned ─────────────────────────────────────────────────────────────

  describe('deleteOwned', () => {
    it('delegates to author.delete', async () => {
      await service.deleteOwned(OWNED_ID, SCOPE);

      expect(author.deleted).toHaveLength(1);
      expect(author.deleted[0]).toEqual({ id: OWNED_ID, scope: SCOPE });
    });
  });

  // ── detect ──────────────────────────────────────────────────────────────────

  describe('detect', () => {
    const MARKETPLACE_URL = 'https://github.com/anthropics/claude-plugins-official.git';

    it('returns { kind: marketplace } when marketplace.json is present', async () => {
      marketplaceParser.seed({
        name: 'test-marketplace',
        plugins: [
          {
            name: 'my-plugin',
            description: 'A plugin',
            author: { name: 'Author' },
            category: 'tools',
            source: { source: 'git-subdir', url: 'https://github.com/owner/repo.git', path: 'plugins/my-plugin', ref: 'v1.0.0', sha: 'abc123' },
          },
        ],
      });

      const result = await service.detect(MARKETPLACE_URL);

      expect(result.kind).toBe('marketplace');
    });

    it('expands local-path string sources to git-subdir using the marketplace URL', async () => {
      marketplaceParser.seed({
        name: 'test-marketplace',
        plugins: [
          {
            name: 'local-plugin',
            description: 'A local plugin',
            author: { name: 'Author' },
            category: 'tools',
            source: './plugins/local-plugin',
          },
        ],
      });

      const result = await service.detect(MARKETPLACE_URL);

      expect(result.kind).toBe('marketplace');
      if (result.kind === 'marketplace') {
        const p = result.manifest.plugins[0];
        expect(typeof p?.source).toBe('object');
        const src = p?.source as { source: string; url: string; path: string };
        expect(src.source).toBe('git-subdir');
        expect(src.url).toBe(MARKETPLACE_URL);
        expect(src.path).toBe('plugins/local-plugin');
      }
    });

    it('returns { kind: plugin } when marketplace.json is not present', async () => {
      // marketplaceParser seeded with nothing → throws → detect returns plugin
      const result = await service.detect(GIT_URL);

      expect(result.kind).toBe('plugin');
    });
  });

  // ── importFromMarketplace ───────────────────────────────────────────────────

  describe('importFromMarketplace', () => {
    it('installs a git-subdir plugin', async () => {
      parser.seedById(IMPORTED_ID);

      const result = await service.importFromMarketplace(
        {
          name: 'my-imported-plugin',
          description: 'desc',
          author: { name: 'Author' },
          category: 'tools',
          source: { source: 'git-subdir', url: GIT_URL, path: 'plugins/my-imported-plugin', ref: 'v1.0.0' },
        },
        SCOPE,
      );

      expect(result.origin).toBe('imported');
      expect(result.id).toBe(IMPORTED_ID);
      expect(installer.installed).toHaveLength(1);
    });

    it('installs a url source plugin', async () => {
      parser.seedById(IMPORTED_ID);

      const result = await service.importFromMarketplace(
        {
          name: 'my-imported-plugin',
          description: 'desc',
          author: { name: 'Author' },
          category: 'tools',
          source: { source: 'url', url: GIT_URL, sha: 'deadbeef' },
        },
        SCOPE,
      );

      expect(result.origin).toBe('imported');
      expect(result.id).toBe(IMPORTED_ID);
    });

    it('installs a github source plugin', async () => {
      parser.seedById(IMPORTED_ID);

      const result = await service.importFromMarketplace(
        {
          name: 'my-imported-plugin',
          description: 'desc',
          author: { name: 'Author' },
          category: 'tools',
          source: { source: 'github', repo: 'some-owner/some-plugin', commit: 'deadbeef' },
        },
        SCOPE,
      );

      expect(result.origin).toBe('imported');
      expect(result.id).toBe(IMPORTED_ID);
      const installCall = installer.installed[0];
      expect(installCall?.source?.url).toContain('github.com/some-owner/some-plugin');
    });

    it('throws PluginCollisionError when plugin already exists', async () => {
      parser.seedById(IMPORTED_ID);
      cache.seedMeta('personal', {
        version: 2,
        plugins: [makeImportedEntry(IMPORTED_ID)],
      });

      await expect(
        service.importFromMarketplace(
          {
            name: 'my-imported-plugin',
            description: 'desc',
            author: { name: 'Author' },
            category: 'tools',
            source: { source: 'git-subdir', url: GIT_URL, path: 'plugins/my-imported-plugin' },
          },
          SCOPE,
        ),
      ).rejects.toBeInstanceOf(PluginCollisionError);
    });

    it('throws on unsupported source type', async () => {
      await expect(
        service.importFromMarketplace(
          {
            name: 'weird-plugin',
            description: 'desc',
            author: { name: 'Author' },
            category: 'tools',
            source: { source: 'npm', package: '@org/plugin' },
          },
          SCOPE,
        ),
      ).rejects.toThrow('Unsupported marketplace plugin source type');
    });
  });

  // ── publish ─────────────────────────────────────────────────────────────────

  describe('publish', () => {
    it('delegates to publisher.publish and returns PluginPublishInfo', async () => {
      const result = await service.publish({
        id: OWNED_ID,
        scope: SCOPE,
        version: VERSION,
        commitMessage: 'chore: publish v1.0.0',
      });

      expect(publisher.published).toHaveLength(1);
      expect(publisher.published[0]).toMatchObject({
        id: OWNED_ID,
        scope: SCOPE,
        version: VERSION,
      });
      expect(result.remoteUrl).toBeDefined();
      expect(result.lastPublishedVersion).toBe(VERSION);
    });
  });
});
