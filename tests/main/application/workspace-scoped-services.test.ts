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
import { FsClaudeTranscriptAdapter } from '../../../src/main/infrastructure/claude-cli/fs-claude-transcript-adapter.js';
import { FakeClaudeSessionPort } from '../../../src/main/application/services/__fixtures__/fake-claude-session-port.js';
import { FakeEmbeddedBrowserPort } from '../../../src/main/application/services/__fixtures__/fake-embedded-browser-port.js';
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
import { FsLaunchConfigReader } from '../../../src/main/infrastructure/launch-config/fs-launch-config-reader.js';
import { FakeRepoGitPort } from '../../../src/main/application/services/__fixtures__/fake-repo-git-port.js';
import { FakeLaunchProcessPort } from '../../../src/main/application/services/__fixtures__/fake-launch-process-port.js';
import type { WorkspaceScopedSharedDeps } from '../../../src/main/application/workspace-scoped-services.js';
import type { FileWatcherPort } from '../../../src/main/application/ports/file-watcher-port.js';
import { FsEntityRepository } from '../../../src/main/infrastructure/entity/fs-entity-repository.js';
import { WORKSPACE_SOURCE, type Skill } from '../../../src/shared/entity.js';
import type { Workspace } from '../../../src/shared/workspace.js';

const noopFileWatcherPort: FileWatcherPort = {
  watch: () => ({ close: async () => undefined }),
};

let globalDir: string;
let dirA: string;
let dirB: string;
let workspaceA: Workspace;
let workspaceB: Workspace;

beforeEach(async () => {
  globalDir = await mkdtemp(join(tmpdir(), 'wss-global-'));
  dirA = await mkdtemp(join(tmpdir(), 'wss-a-'));
  dirB = await mkdtemp(join(tmpdir(), 'wss-b-'));
  workspaceA = { id: 'ws-a', name: 'A', rootPath: dirA, createdAt: '' };
  workspaceB = { id: 'ws-b', name: 'B', rootPath: dirB, createdAt: '' };
});

afterEach(async () => {
  await rm(globalDir, { recursive: true, force: true });
  await rm(dirA, { recursive: true, force: true });
  await rm(dirB, { recursive: true, force: true });
});

const scopeOf = (workspace: Workspace) => ({ workspace, dataDir: join(workspace.rootPath, '.ai-companion') });

const skill = (name: string, workspace?: Workspace): Skill => ({
  urn: `urn:skill:${name}`, kind: 'skill', name, description: 'd',
  scopes: [workspace ? 'workspace' : 'personal'],
  ...(workspace ? { scopeId: workspace.id } : {}),
  metadata: { version: '0.1.0', createdAt: '', updatedAt: '' },
  source: WORKSPACE_SOURCE, content: 'body',
});

function buildShared(): WorkspaceScopedSharedDeps {
  const nodeFsAdapter = new NodeFsAdapter();
  const clock = new SystemClock();
  const settingsService = new SettingsService(new InMemorySettingsRepository());
  const homedir = '/home/test-user';
  const workspaceService = {
    get: async (id: string): Promise<Workspace> => {
      const found = [workspaceA, workspaceB].find((w) => w.id === id);
      if (!found) throw new Error(`unknown workspace ${id}`);
      return found;
    },
  };
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
    globalEntities: { repository: new FsEntityRepository(globalDir, 'personal'), dataDir: globalDir },
    pluginProvenance,
    pluginService,
    claudeRuntimeReader,
    claudeSettingsFile,
    claudeSessionPort: new FakeClaudeSessionPort(),
    embeddedBrowserPort: new FakeEmbeddedBrowserPort(),
    sessionTranscriptPort: new FsClaudeTranscriptAdapter(join(homedir, '.claude', 'projects')),
    fileWatcherPort: noopFileWatcherPort,
    launchConfigReaderPort: new FsLaunchConfigReader(),
    launchProcessPort: new FakeLaunchProcessPort(),
    repoGitPort: new FakeRepoGitPort(),
  };
}

describe('buildWorkspaceScopedServices', () => {
  it('two workspace graphs share Global but keep their workspace entities apart', async () => {
    const shared = buildShared();
    const a = buildWorkspaceScopedServices(scopeOf(workspaceA), shared);
    const b = buildWorkspaceScopedServices(scopeOf(workspaceB), shared);

    await a.skillService.save({ skill: skill('everywhere'), isCreate: true });
    await a.skillService.save({ skill: skill('only-a', workspaceA), isCreate: true });

    expect((await a.skillService.list()).map((s) => s.name).sort()).toEqual(['everywhere', 'only-a']);
    expect((await b.skillService.list()).map((s) => s.name)).toEqual(['everywhere']);
  });

  it('the Início graph (no workspace open) serves Global and rejects workspace entities', async () => {
    const shared = buildShared();
    const home = buildWorkspaceScopedServices(null, shared);

    await home.skillService.save({ skill: skill('mine'), isCreate: true });
    expect((await home.skillService.list()).map((s) => s.name)).toEqual(['mine']);
    await expect(home.skillService.save({ skill: skill('local', workspaceA), isCreate: true })).rejects.toMatchObject({
      kind: 'validation',
    });
    await expect(home.gitService.status()).rejects.toMatchObject({ kind: 'validation' });
    expect(await home.launchConfigService.list()).toBeNull();
  });
});
