import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { createServer, type Server } from 'node:http';
import { unlinkSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { IPC_CHANNEL } from '../shared/ipc-contract.js';
import { brand } from '../shared/brand.js';
import {
  devLockPath,
  projectWorkspacePath,
} from '../shared/brand-paths.js';
import { SettingsService } from './application/services/settings-service.js';
import { RepoService } from './application/services/repo-service.js';
import { WorkspaceBootstrapService } from './application/services/workspace-bootstrap.js';
import { WorkspaceTeardownService } from './application/services/workspace-teardown.js';
import { ProductMigrationService } from './application/services/product-migration-service.js';
import { AdapterManager } from './application/services/adapter-manager.js';
import { SymlinkManager } from './application/services/symlink-manager.js';
import { FileMaterializer } from './application/services/file-materializer.js';
import { FsSettingsRepository } from './infrastructure/settings/fs-settings-repository.js';
import { FsRepoReader } from './infrastructure/repo/fs-repo-reader.js';
import { FsWorkspaceBootstrap } from './infrastructure/workspace/fs-workspace-bootstrap.js';
import { SystemClock } from './infrastructure/clock/system-clock.js';
import { ElectronDialogAdapter } from './infrastructure/dialog/electron-dialog-adapter.js';
import { NodeFsAdapter } from './infrastructure/filesystem/node-fs-adapter.js';
import { ClaudeAdapter } from './infrastructure/adapters/claude-adapter.js';
import { CursorAdapter } from './infrastructure/adapters/cursor-adapter.js';
import { EntityService } from './application/services/entity-service.js';
import { EntityValidator } from './application/services/entity-validator.js';
import { FsEntityRepository } from './infrastructure/entity/fs-entity-repository.js';
import type { Adapter } from './application/ports/adapter.js';
import type { CredentialStorePort } from './application/ports/credential-store-port.js';
import { SafeStorageCredentials } from './infrastructure/credentials/safe-storage-credentials.js';
import { SimpleGitClient } from './infrastructure/git/simple-git-client.js';
import { PluginCacheFile } from './infrastructure/plugins/plugin-cache-file.js';
import { ClaudeSettingsFile } from './infrastructure/settings/claude-settings-file.js';
import { OctokitClient } from './infrastructure/github/octokit-client.js';
import { PluginManifestParser } from './application/services/plugin-manifest-parser.js';
import { MarketplaceParser } from './application/services/marketplace-parser.js';
import { PluginInstaller } from './application/services/plugin-installer.js';
import { PluginAuthorService } from './application/services/plugin-author-service.js';
import { PluginPublisher } from './application/services/plugin-publisher.js';
import { PluginService } from './application/services/plugin-service.js';
import { PluginProvenanceService } from './application/services/plugin-provenance.js';
import { ClaudeCodePluginReader } from './infrastructure/plugins/claude-code-plugin-reader.js';
import { SkillService } from './application/services/skill-service.js';
import { AgentService } from './application/services/agent-service.js';
import { HookService } from './application/services/hook-service.js';
import { InstructionService } from './application/services/instruction-service.js';
import { MarketplaceService } from './application/services/marketplace-service.js';
import { MarketplaceSeeder } from './application/services/marketplace-seeder.js';
import { SettingsMarketplaceRepository } from './infrastructure/marketplace/settings-marketplace-repository.js';
import { FsClaudeRuntimeReader } from './infrastructure/claude-runtime/fs-claude-runtime-reader.js';
import { FsMcpConfigStore } from './infrastructure/mcp/fs-mcp-config-store.js';
import { PluginMcpReader } from './infrastructure/mcp/plugin-mcp-reader.js';
import { McpService } from './application/services/mcp-service.js';
import { McpDisabledStash } from './infrastructure/mcp/mcp-disabled-stash.js';
import { ElectronShell } from './infrastructure/shell/electron-shell.js';
import { ElectronNotificationAdapter } from './infrastructure/notification/electron-notification-adapter.js';
import { HealthService } from './application/services/health/health-service.js';
import { McpAuthCollector } from './application/services/health/mcp-auth-collector.js';
import { McpRuntimeCollector } from './application/services/health/mcp-runtime-collector.js';
import { ConfigDriftCollector } from './application/services/health/config-drift-collector.js';
import { SymlinkCollector } from './application/services/health/symlink-collector.js';
import { GeneratedFileCollector } from './application/services/health/generated-file-collector.js';
import type { HealthCollector } from './application/services/health/health-collector.js';
import { buildHandlers } from './ipc/registry.js';
import { createDispatcher } from './ipc/dispatcher.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const isDev = process.env['NODE_ENV'] === 'development';
const devLockPathValue = devLockPath(homedir());
/** Localhost-only — Dock launcher hits GET /focus (see scripts/focus-dev.sh). */
const DEV_FOCUS_PORT = 47174;

let mainWindow: BrowserWindow | null = null;
let devFocusServer: Server | null = null;

function writeDevLock(): void {
  if (!isDev) return;
  try {
    writeFileSync(devLockPathValue, String(process.pid), 'utf8');
  } catch {
    // Non-fatal — focus-dev.sh falls back to port check.
  }
}

function removeDevLock(): void {
  if (!isDev) return;
  try {
    unlinkSync(devLockPathValue);
  } catch {
    // Already removed or never written.
  }
}

function startDevFocusServer(): void {
  if (!isDev || devFocusServer !== null) return;

  devFocusServer = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/focus') {
      focusMainWindow();
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
      return;
    }
    res.writeHead(404);
    res.end();
  });

  devFocusServer.listen(DEV_FOCUS_PORT, '127.0.0.1', () => {
    writeDevLock();
  });

  devFocusServer.on('error', (error) => {
    console.warn('[dev] focus server unavailable:', error.message);
  });
}

function stopDevFocusServer(): void {
  devFocusServer?.close();
  devFocusServer = null;
}

interface IpcCallPayload {
  method: string;
  params: unknown;
}

function isCallPayload(value: unknown): value is IpcCallPayload {
  return (
    typeof value === 'object' &&
    value !== null &&
    'method' in value &&
    typeof (value as { method: unknown }).method === 'string'
  );
}

async function wireIpc(): Promise<void> {
  const nodeFsAdapter = new NodeFsAdapter();
  const home = homedir();
  const { workspacePath } = await new ProductMigrationService(nodeFsAdapter).migrate(home);

  const workspaceBootstrap = new WorkspaceBootstrapService(new FsWorkspaceBootstrap());
  await workspaceBootstrap.create(workspacePath);

  const settingsService = new SettingsService(
    new FsSettingsRepository(join(workspacePath, 'settings.json')),
  );
  const repoReader = new FsRepoReader();
  const repoService = new RepoService(repoReader);
  const dialogPort = new ElectronDialogAdapter();

  const clock = new SystemClock();

  const symlinkManager = new SymlinkManager(new NodeFsAdapter(), clock, workspacePath);
  const fileMaterializer = new FileMaterializer(nodeFsAdapter, clock, workspacePath);
  const claudeAdapter = new ClaudeAdapter({ homedir: homedir() });
  const cursorAdapter = new CursorAdapter({ homedir: homedir() });
  const entityRepository = new FsEntityRepository(workspacePath);
  const adapterManager = new AdapterManager({
    settingsService,
    entityRepository,
    symlinkManager,
    fileMaterializer,
    workspacePath,
    adapters: new Map<string, Adapter>([
      [claudeAdapter.adapterId, claudeAdapter],
      [cursorAdapter.adapterId, cursorAdapter],
    ]),
  });

  const entityValidator = new EntityValidator();
  const entityService = new EntityService(entityRepository, clock, adapterManager, entityValidator);

  const credentialStore: CredentialStorePort = new SafeStorageCredentials(app.getPath('userData'));

  // T10.1: wire full PluginService
  const gitClient = new SimpleGitClient();

  const pluginsWorkspaceDir = join(workspacePath, 'plugins');
  const pluginCache = new PluginCacheFile({
    pluginsDir: (scope) =>
      scope === 'personal'
        ? pluginsWorkspaceDir
        : join(projectWorkspacePath(process.cwd()), 'plugins'),
    cacheDir: (scope) =>
      scope === 'personal'
        ? join(homedir(), '.claude', 'plugins', 'cache', 'local')
        : join(process.cwd(), '.claude', 'plugins', 'cache', 'local'),
  });

  const claudeSettingsFile = new ClaudeSettingsFile({
    settingsPath: (scope) =>
      scope === 'personal'
        ? join(homedir(), '.claude', 'settings.json')
        : join(process.cwd(), '.claude', 'settings.json'),
    symlinkPath: (scope, id) =>
      scope === 'personal'
        ? join(homedir(), '.claude', 'plugins', 'cache', 'local', id)
        : join(process.cwd(), '.claude', 'plugins', 'cache', 'local', id),
  });

  const manifestParser = new PluginManifestParser(nodeFsAdapter);
  const marketplaceParser = new MarketplaceParser(nodeFsAdapter);

  const pluginInstaller = new PluginInstaller({ cache: pluginCache, settings: claudeSettingsFile });

  const pluginAuthor = new PluginAuthorService({
    cache: pluginCache,
    installer: pluginInstaller,
    parser: manifestParser,
  });

  const octokitClient = new OctokitClient(async () => credentialStore.get('github.pat'));

  const pluginPublisher = new PluginPublisher({
    cache: pluginCache,
    git: gitClient,
    githubApi: octokitClient,
    credentials: credentialStore,
    parser: manifestParser,
    clock,
  });

  const pluginService = new PluginService({
    installer: pluginInstaller,
    author: pluginAuthor,
    publisher: pluginPublisher,
    git: gitClient,
    cache: pluginCache,
    settings: claudeSettingsFile,
    parser: manifestParser,
    marketplaceParser,
    fs: nodeFsAdapter,
  });

  const claudeCodePluginReader = new ClaudeCodePluginReader({
    registryPath: join(homedir(), '.claude', 'plugins', 'installed_plugins.json'),
    fs: nodeFsAdapter,
  });

  const pluginProvenance = new PluginProvenanceService({
    cache: pluginCache,
    fs: nodeFsAdapter,
    claudeCodeRegistry: claudeCodePluginReader,
  });
  const skillService = new SkillService(entityService, {
    provenance: pluginProvenance,
    fs: nodeFsAdapter,
  });
  const agentService = new AgentService(entityService, {
    provenance: pluginProvenance,
    fs: nodeFsAdapter,
  });
  const hookService = new HookService(claudeSettingsFile, {
    cache: pluginCache,
    fs: nodeFsAdapter,
  });
  const instructionService = new InstructionService(entityService);
  const marketplacesCacheRoot = (scope: 'personal' | 'project'): string =>
    scope === 'personal'
      ? join(workspacePath, 'marketplaces-cache')
      : join(projectWorkspacePath(process.cwd()), 'marketplaces-cache');
  const marketplaceService = new MarketplaceService({
    repository: new SettingsMarketplaceRepository(claudeSettingsFile),
    parser: marketplaceParser,
    git: gitClient,
    cacheDirRoot: marketplacesCacheRoot,
    fs: nodeFsAdapter,
  });

  await new MarketplaceSeeder({ marketplaceService }).seedDefaultsIfMissing('personal');

  const claudeRuntimeReader = new FsClaudeRuntimeReader({
    claudeJsonPath: join(homedir(), '.claude.json'),
    authCachePath: join(homedir(), '.claude', 'mcp-needs-auth-cache.json'),
    mcpLogsBaseDir: join(homedir(), 'Library', 'Caches', 'claude-cli-nodejs'),
  });

  const mcpConfigStore = new FsMcpConfigStore({
    claudeJsonPath: join(homedir(), '.claude.json'),
  });
  const pluginMcpReader = new PluginMcpReader({
    listRoots: (scope) => pluginProvenance.roots(scope),
  });
  const mcpDisabledStash = new McpDisabledStash({
    stashPath: join(workspacePath, 'mcp-disabled.json'),
  });
  const mcpService = new McpService({
    config: mcpConfigStore,
    plugins: pluginMcpReader,
    runtime: claudeRuntimeReader,
    // Project-scoped MCP config used to be read from every linked repo. That
    // list is gone with linkedRepos; project MCPs will come from the per-entity
    // repoPath in a follow-up iteration. For now, only personal + plugin MCPs.
    linkedRepoPaths: async () => [],
    disabledStash: mcpDisabledStash,
    shell: new ElectronShell(),
  });

  const healthCollectors: HealthCollector[] = [
    new McpAuthCollector(claudeRuntimeReader, clock),
    new McpRuntimeCollector(claudeRuntimeReader, clock),
    new ConfigDriftCollector(pluginService, clock),
    new SymlinkCollector(adapterManager, symlinkManager, clock),
    new GeneratedFileCollector(adapterManager, fileMaterializer, settingsService, clock),
  ];
  const healthService = new HealthService(healthCollectors, clock);
  const notificationPort = new ElectronNotificationAdapter();
  const workspaceTeardownService = new WorkspaceTeardownService(
    adapterManager,
    nodeFsAdapter,
    workspacePath,
    claudeSettingsFile,
  );

  const handlers = buildHandlers({
    settingsService,
    repoService,
    adapterManager,
    dialogPort,
    pluginService,
    credentialStore,
    skillService,
    agentService,
    hookService,
    instructionService,
    marketplaceService,
    healthService,
    mcpService,
    notificationPort,
    workspaceTeardownService,
    appQuit: () => app.quit(),
  });
  const dispatch = createDispatcher(handlers);

  ipcMain.handle(IPC_CHANNEL, async (_event, payload: unknown) => {
    if (!isCallPayload(payload)) {
      return {
        ok: false,
        error: { kind: 'validation', message: 'Invalid IPC payload' },
      };
    }
    return dispatch(payload.method, payload.params);
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1024,
    height: 768,
    show: false,
    title: brand.documentTitle,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.on('ready-to-show', () => mainWindow?.show());

  const devServerUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl);
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

function configureDevDock(): void {
  if (!isDev || process.platform !== 'darwin') return;
  app.setName(brand.devAppName);
  app.dock?.hide();
}

function focusMainWindow(): void {
  if (mainWindow !== null) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    if (process.platform === 'darwin') {
      app.focus({ steal: true });
    }
    mainWindow.focus();
    return;
  }
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
}

function reportFatalBootError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error('[boot] fatal error during startup:', error);
  dialog.showErrorBox(
    brand.fatalErrorTitle,
    `The app could not finish initializing and will now close.\n\n${message}`,
  );
  app.quit();
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    focusMainWindow();
  });

  app.on('will-quit', () => {
    stopDevFocusServer();
    removeDevLock();
  });

  app.on('window-all-closed', () => {
    // Dev: quit when the window closes so `npm run dev` restarts cleanly on macOS.
    // Prod macOS: keep the Dock icon alive until explicit Quit (platform convention).
    if (isDev || process.platform !== 'darwin') {
      app.quit();
    }
  });

  void app.whenReady().then(async () => {
    try {
      await wireIpc();
    } catch (error) {
      reportFatalBootError(error);
      return;
    }

    configureDevDock();
    createWindow();
    startDevFocusServer();

    app.on('activate', () => {
      focusMainWindow();
    });
  });
}
