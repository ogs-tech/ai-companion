import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildWorkspaceScopedServices } from '../../../src/main/application/workspace-scoped-services.js';
import { SystemClock } from '../../../src/main/infrastructure/clock/system-clock.js';
import { NodeFsAdapter } from '../../../src/main/infrastructure/filesystem/node-fs-adapter.js';
import { SettingsService } from '../../../src/main/application/services/settings-service.js';
import { InMemorySettingsRepository } from '../../../src/main/infrastructure/settings/in-memory-settings-repository.js';
import { PluginProvenanceService } from '../../../src/main/application/services/plugin-provenance.js';
import { PluginCacheFile } from '../../../src/main/infrastructure/plugins/plugin-cache-file.js';
import { ClaudeCodePluginReader } from '../../../src/main/infrastructure/plugins/claude-code-plugin-reader.js';
import { FakeClaudeCliPort } from '../../../src/main/application/services/__fixtures__/fake-claude-cli-port.js';
import { FakeClaudeSessionPort } from '../../../src/main/application/services/__fixtures__/fake-claude-session-port.js';
import { FsClaudeRuntimeReader } from '../../../src/main/infrastructure/claude-runtime/fs-claude-runtime-reader.js';
import { PluginService } from '../../../src/main/application/services/plugin-service.js';
import { PluginManifestParser } from '../../../src/main/application/services/plugin-manifest-parser.js';
import { MarketplaceParser } from '../../../src/main/application/services/marketplace-parser.js';
import { PluginInstaller } from '../../../src/main/application/services/plugin-installer.js';
import { PluginAuthorService } from '../../../src/main/application/services/plugin-author-service.js';
import { PluginPublisher } from '../../../src/main/application/services/plugin-publisher.js';
import { ClaudeSettingsFile } from '../../../src/main/infrastructure/settings/claude-settings-file.js';
import { SimpleGitClient } from '../../../src/main/infrastructure/git/simple-git-client.js';
import { OctokitClient } from '../../../src/main/infrastructure/github/octokit-client.js';
import { FakeCredentialStorePort } from '../../../src/main/application/services/__fixtures__/fake-credential-store-port.js';
import type { WorkspaceScopedSharedDeps } from '../../../src/main/application/workspace-scoped-services.js';
import { WORKSPACE_SOURCE, type Skill } from '../../../src/shared/entity.js';

let dirA: string;
let dirB: string;

beforeEach(async () => {
  dirA = await mkdtemp(join(tmpdir(), 'wss-a-'));
  dirB = await mkdtemp(join(tmpdir(), 'wss-b-'));
});

afterEach(async () => {
  await rm(dirA, { recursive: true, force: true });
  await rm(dirB, { recursive: true, force: true });
});

function buildShared(): WorkspaceScopedSharedDeps {
  const nodeFsAdapter = new NodeFsAdapter();
  const clock = new SystemClock();
  const settingsService = new SettingsService(new InMemorySettingsRepository());
  const homedir = '/home/test-user';
  const workspaceService = { get: async () => { throw new Error('not stubbed in this test'); } };
  const pluginCache = new PluginCacheFile({
    pluginsDir: () => join(homedir, '.ai-companion', 'plugins'),
    cacheDir: () => join(homedir, '.claude', 'plugins', 'cache', 'local'),
  });
  const claudeCodePluginReader = new ClaudeCodePluginReader({
    registryPath: join(homedir, '.claude', 'plugins', 'installed_plugins.json'),
    fs: nodeFsAdapter,
  });
  const pluginProvenance = new PluginProvenanceService({
    cache: pluginCache,
    fs: nodeFsAdapter,
    claudeCodeRegistry: claudeCodePluginReader,
  });
  const manifestParser = new PluginManifestParser(nodeFsAdapter);
  const marketplaceParser = new MarketplaceParser(nodeFsAdapter);
  const claudeSettingsFile = new ClaudeSettingsFile({
    settingsPath: () => join(homedir, '.claude', 'settings.json'),
    symlinkPath: (_scope, id) => join(homedir, '.claude', 'plugins', 'cache', 'local', id),
  });
  const pluginInstaller = new PluginInstaller({ cache: pluginCache, settings: claudeSettingsFile });
  const pluginAuthor = new PluginAuthorService({ cache: pluginCache, installer: pluginInstaller, parser: manifestParser });
  const gitClient = new SimpleGitClient();
  const octokitClient = new OctokitClient(async () => null);
  const pluginPublisher = new PluginPublisher({
    cache: pluginCache, git: gitClient, githubApi: octokitClient,
    credentials: new FakeCredentialStorePort(),
    parser: manifestParser, clock,
  });
  const pluginService = new PluginService({
    installer: pluginInstaller, author: pluginAuthor, publisher: pluginPublisher, git: gitClient,
    cache: pluginCache, settings: claudeSettingsFile, parser: manifestParser, marketplaceParser, fs: nodeFsAdapter,
  });
  const claudeRuntimeReader = new FsClaudeRuntimeReader({
    claudeJsonPath: join(homedir, '.claude.json'),
    authCachePath: join(homedir, '.claude', 'mcp-needs-auth-cache.json'),
    mcpLogsBaseDir: join(homedir, 'Library', 'Caches', 'claude-cli-nodejs'),
  });

  return {
    clock,
    nodeFsAdapter,
    settingsService,
    homedir,
    workspaceService,
    pluginProvenance,
    pluginService,
    claudeRuntimeReader,
    claudeSettingsFile,
    claudeCli: new FakeClaudeCliPort(),
    claudeSessionPort: new FakeClaudeSessionPort(),
  };
}

describe('buildWorkspaceScopedServices', () => {
  it('two calls with different dataDirs produce fully independent entity graphs', async () => {
    const shared = buildShared();
    const a = buildWorkspaceScopedServices(dirA, shared);
    const b = buildWorkspaceScopedServices(dirB, shared);

    const skill: Skill = {
      urn: 'urn:skill:foo', kind: 'skill', name: 'foo', description: 'd',
      scopes: ['personal'], metadata: { version: '0.1.0', createdAt: '', updatedAt: '' },
      source: WORKSPACE_SOURCE, content: 'body',
    };
    await a.skillService.save({ skill, isCreate: true });

    expect((await a.skillService.list()).map((s) => s.name)).toEqual(['foo']);
    expect(await b.skillService.list()).toEqual([]);
  });

  it('wires projectService against <dataDir>/projects.json independently per graph', async () => {
    const shared = buildShared();
    const a = buildWorkspaceScopedServices(dirA, shared);
    const b = buildWorkspaceScopedServices(dirB, shared);

    await a.projectService.create({ name: 'acme', path: '/repos/acme' });
    expect(await a.projectService.list()).toHaveLength(1);
    expect(await b.projectService.list()).toHaveLength(0);
  });
});
