import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { createServer, type Server } from 'node:http';
import { unlinkSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { IPC_CHANNEL } from '../shared/ipc-contract.js';
import { brand } from '../shared/brand.js';
import { devLockPath, workspacePath as workspaceDataDir } from '../shared/brand-paths.js';
import type { Workspace } from '../shared/workspace.js';
import { SettingsService } from './application/services/settings-service.js';
import { WorkspaceBootstrapService } from './application/services/workspace-bootstrap.js';
import { WorkspaceService } from './application/services/workspace-service.js';
import { ProductMigrationService } from './application/services/product-migration-service.js';
import {
  buildWorkspaceScopedServices,
  type ActiveWorkspaceScope,
  type WorkspaceScopedServices,
} from './application/workspace-scoped-services.js';
import { WorkspaceModelMigration } from './application/services/workspace-model-migration.js';
import { FsEntityRepository } from './infrastructure/entity/fs-entity-repository.js';
import type { WorkspaceActivation } from './ipc/workspace-handlers.js';
import { DomainError } from './domain/errors.js';
import { createTaskQueue } from './application/task-queue.js';
import { FsSettingsRepository } from './infrastructure/settings/fs-settings-repository.js';
import { FsWorkspaceBootstrap } from './infrastructure/workspace/fs-workspace-bootstrap.js';
import { FsWorkspaceRegistry } from './infrastructure/workspace/fs-workspace-registry.js';
import { SystemClock } from './infrastructure/clock/system-clock.js';
import { ElectronDialogAdapter } from './infrastructure/dialog/electron-dialog-adapter.js';
import { NodeFsAdapter } from './infrastructure/filesystem/node-fs-adapter.js';
import { NodeFileBrowserAdapter } from './infrastructure/filesystem/node-file-browser-adapter.js';
import { NumbersConverterAdapter } from './infrastructure/spreadsheet/numbers-converter-adapter.js';
import { FileBrowserService } from './application/services/file-browser-service.js';
import { OpenWithService } from './application/services/open-with-service.js';
import { MacAppLauncher } from './infrastructure/app-launcher/mac-app-launcher.js';
import { SystemDefaultAppLauncher } from './infrastructure/app-launcher/system-default-app-launcher.js';
import type { CredentialStorePort } from './application/ports/credential-store-port.js';
import { SafeStorageCredentials } from './infrastructure/credentials/safe-storage-credentials.js';
import { SimpleGitClient } from './infrastructure/git/simple-git-client.js';
import { SimpleGitRepoClient } from './infrastructure/git/simple-git-repo-client.js';
import { augmentPath } from './infrastructure/system/augment-path.js';
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
import { HookService } from './application/services/hook-service.js';
import { NodePtySessionAdapter } from './infrastructure/claude-cli/node-pty-session-adapter.js';
import { EmbeddedBrowserAdapter } from './infrastructure/browser/embedded-browser-adapter.js';
import type { EmbeddedBrowserPort } from './application/ports/embedded-browser-port.js';
import { FsClaudeTranscriptAdapter } from './infrastructure/claude-cli/fs-claude-transcript-adapter.js';
import { SESSION_OUTPUT_CHANNEL, SESSION_EXIT_CHANNEL } from '../shared/session.js';
import { ENTITY_CHANGED_CHANNEL } from '../shared/entity.js';
import { LAUNCH_PROCESS_OUTPUT_CHANNEL, LAUNCH_PROCESS_EXIT_CHANNEL } from '../shared/launch-config.js';
import { FsLaunchConfigReader } from './infrastructure/launch-config/fs-launch-config-reader.js';
import { NodeChildProcessAdapter } from './infrastructure/launch-process/node-child-process-adapter.js';
import { ChokidarFileWatcher } from './infrastructure/file-watcher/chokidar-file-watcher.js';
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
import { buildHandlers } from './ipc/registry.js';
import { createDispatcher } from './ipc/dispatcher.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const isDev = process.env['NODE_ENV'] === 'development';
// Before anything spawns `git` or `claude` — see augment-path.ts.
const augmentedPath = augmentPath(process.env['PATH'], process.platform);
if (augmentedPath !== undefined) process.env['PATH'] = augmentedPath;
const devLockPathValue = devLockPath(homedir());
/** Localhost-only — Dock launcher hits GET /focus (see scripts/focus-dev.sh). */
const DEV_FOCUS_PORT = 47174;
/**
 * Localhost-only CDP endpoint for every session's embedded browser tool.
 * Fixed rather than dynamically probed for a free port, so it can be set via
 * `appendSwitch` synchronously before `app.whenReady()` (Electron requires
 * this switch as early as possible, ideally before any other `app` call) —
 * matches `DEV_FOCUS_PORT` above, a similar localhost-only fixed port. Chosen
 * to avoid colliding with Chrome's own common `--remote-debugging-port`
 * default (9222) in case the user also runs Chrome with that enabled.
 * Accepted trade-off (see docs/superpowers/specs/2026-09-19-embedded-session-browser-design.md#2):
 * this exposes every window in the app over CDP while any session's browser
 * tool is active, not just that session's own view.
 */
const EMBEDDED_BROWSER_CDP_PORT = 9333;
app.commandLine.appendSwitch('remote-debugging-port', String(EMBEDDED_BROWSER_CDP_PORT));

let mainWindow: BrowserWindow | null = null;
let devFocusServer: Server | null = null;
/** Set once `wireIpc` constructs the real adapter — read by `createWindow`'s reload listener, see `hideAll`. */
let embeddedBrowserPortForReload: EmbeddedBrowserPort | null = null;

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

  const clock = new SystemClock();
  const workspaceRegistry = new FsWorkspaceRegistry(join(workspacePath, 'workspaces.json'));

  // Before any service graph exists: moves project-era data onto the
  // Global/workspace model. A failure leaves the old files untouched and the
  // app on the IoError screen (see wireMigrationFailure).
  let migration: Awaited<ReturnType<WorkspaceModelMigration['run']>>;
  try {
    migration = await new WorkspaceModelMigration({
      fs: nodeFsAdapter,
      registry: workspaceRegistry,
      bootstrap: workspaceBootstrap,
      clock,
      homedir: home,
      globalDataDir: workspacePath,
    }).run();
  } catch (error) {
    wireMigrationFailure(error);
    return;
  }

  const workspaceService = new WorkspaceService(workspaceRegistry, clock, workspaceBootstrap, home, nodeFsAdapter);
  const globalEntities = { repository: new FsEntityRepository(workspacePath, 'personal'), dataDir: workspacePath };

  /** Bootstraps (self-heals) the workspace's data dir — a no-op scope at Início. */
  const scopeFor = async (workspace: Workspace | null): Promise<ActiveWorkspaceScope | null> => {
    if (workspace === null) return null;
    const dataDir = workspaceDataDir(workspace.rootPath);
    await workspaceBootstrap.create(dataDir);
    return { workspace, dataDir };
  };
  let activeWorkspace = await workspaceService.getActive();

  /**
   * Harness-native `project` tiers (plugin cache, Claude settings, marketplace
   * cache) resolve against the open workspace's root. At Início there is none,
   * so those tiers are not offered.
   */
  const activeRoot = (): string => {
    if (activeWorkspace === null) {
      throw new DomainError('validation', 'No workspace is open — project-scoped settings need one');
    }
    return activeWorkspace.rootPath;
  };

  const settingsService = new SettingsService(
    new FsSettingsRepository(join(workspacePath, 'settings.json')),
  );
  const dialogPort = new ElectronDialogAdapter();

  const credentialStore: CredentialStorePort = new SafeStorageCredentials(app.getPath('userData'));

  // T10.1: wire full PluginService
  const gitClient = new SimpleGitClient();

  const pluginsWorkspaceDir = join(workspacePath, 'plugins');
  const pluginCache = new PluginCacheFile({
    pluginsDir: (scope) =>
      scope === 'personal'
        ? pluginsWorkspaceDir
        : join(workspaceDataDir(activeRoot()), 'plugins'),
    cacheDir: (scope) =>
      scope === 'personal'
        ? join(homedir(), '.claude', 'plugins', 'cache', 'local')
        : join(activeRoot(), '.claude', 'plugins', 'cache', 'local'),
  });

  const claudeSettingsFile = new ClaudeSettingsFile({
    settingsPath: (scope) =>
      scope === 'personal'
        ? join(homedir(), '.claude', 'settings.json')
        : join(activeRoot(), '.claude', 'settings.json'),
    symlinkPath: (scope, id) =>
      scope === 'personal'
        ? join(homedir(), '.claude', 'plugins', 'cache', 'local', id)
        : join(activeRoot(), '.claude', 'plugins', 'cache', 'local', id),
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
  const hookService = new HookService(claudeSettingsFile, {
    cache: pluginCache,
    fs: nodeFsAdapter,
  });
  const marketplacesCacheRoot = (scope: 'personal' | 'project'): string =>
    scope === 'personal'
      ? join(workspacePath, 'marketplaces-cache')
      : join(workspaceDataDir(activeRoot()), 'marketplaces-cache');
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

  const embeddedBrowserAdapter = new EmbeddedBrowserAdapter({
    getMainWindow: () => mainWindow,
    fs: nodeFsAdapter,
    // Never `npx` (see spec §2.5) — the pinned dependency's own binary, in
    // this app's own installation, resolved the packaging-aware way.
    playwrightMcpBin: join(app.getAppPath(), 'node_modules', '.bin', 'playwright-mcp'),
    cdpPort: EMBEDDED_BROWSER_CDP_PORT,
  });
  embeddedBrowserPortForReload = embeddedBrowserAdapter;

  const sharedDeps = {
    clock,
    nodeFsAdapter,
    settingsService,
    homedir: home,
    workspaceService,
    globalEntities,
    pluginProvenance,
    pluginService,
    claudeRuntimeReader,
    claudeSettingsFile,
    claudeSessionPort: new NodePtySessionAdapter(),
    embeddedBrowserPort: embeddedBrowserAdapter,
    // The CLI's own transcript directory — resolved here, like every other
    // `~/.claude` path, so the adapter stays a pure reader of a given folder.
    sessionTranscriptPort: new FsClaudeTranscriptAdapter(join(home, '.claude', 'projects')),
    fileWatcherPort: new ChokidarFileWatcher(),
    launchConfigReaderPort: new FsLaunchConfigReader(),
    launchProcessPort: new NodeChildProcessAdapter(),
    repoGitPort: new SimpleGitRepoClient(),
  };

  if (migration.migrated) await syncAfterMigration(migration.touchedWorkspaceIds);

  let workspaceScoped: WorkspaceScopedServices = buildWorkspaceScopedServices(
    await scopeFor(activeWorkspace),
    sharedDeps,
  );

  const fileBrowserPort = new NodeFileBrowserAdapter([new NumbersConverterAdapter()]);
  const fileBrowserFor = (workspace: Workspace | null): FileBrowserService | null =>
    workspace === null ? null : new FileBrowserService(fileBrowserPort, workspace.rootPath);
  let fileBrowserService = fileBrowserFor(activeWorkspace);

  /**
   * Re-points every adapter destination at the canonical files the migration
   * moved — Global first, then each touched workspace (whose graph also
   * re-syncs Global's entities, harmlessly). Best-effort: a failed sync is
   * what `adapter.syncAll` and the health screen already surface.
   */
  async function syncAfterMigration(touchedWorkspaceIds: string[]): Promise<void> {
    const targets: (Workspace | null)[] = [null];
    for (const id of touchedWorkspaceIds) {
      const workspace = await workspaceService.get(id).catch(() => null);
      if (workspace !== null) targets.push(workspace);
    }
    for (const target of targets) {
      try {
        await buildWorkspaceScopedServices(await scopeFor(target), sharedDeps).adapterManager.syncAll({});
      } catch (error) {
        console.error('[migration] adapter sync failed for', target?.rootPath ?? 'Global', error);
      }
    }
  }

  const attachSessionBridges = (services: WorkspaceScopedServices): void => {
    services.sessionService.onOutput((sessionId, chunk) => {
      mainWindow?.webContents.send(SESSION_OUTPUT_CHANNEL, { sessionId, chunk });
    });
    services.sessionService.onExit((sessionId, _status, exitCode) => {
      mainWindow?.webContents.send(SESSION_EXIT_CHANNEL, { sessionId, exitCode });
    });
  };
  attachSessionBridges(workspaceScoped);

  const attachLaunchProcessBridges = (services: WorkspaceScopedServices): void => {
    services.launchProcessService.onOutput((event) => {
      mainWindow?.webContents.send(LAUNCH_PROCESS_OUTPUT_CHANNEL, event);
    });
    services.launchProcessService.onExit((event) => {
      mainWindow?.webContents.send(LAUNCH_PROCESS_EXIT_CHANNEL, event);
    });
  };
  attachLaunchProcessBridges(workspaceScoped);

  const attachEntityWatch = (services: WorkspaceScopedServices): void => {
    services.entityWatchService.onEntityChanged((event) => {
      mainWindow?.webContents.send(ENTITY_CHANGED_CHANNEL, event);
    });
    services.entityWatchService.start();
  };
  attachEntityWatch(workspaceScoped);

  app.on('before-quit', () => {
    workspaceScoped.sessionService.killAll();
    workspaceScoped.launchProcessService.killAll();
    void embeddedBrowserAdapter.destroyAll();
    void workspaceScoped.entityWatchService.stop();
  });

  const notificationPort = new ElectronNotificationAdapter();

  // Application discovery is Launch Services; every other platform gets the
  // portable subset (open with the default handler, reveal in the file manager).
  const openWithService = new OpenWithService(
    process.platform === 'darwin' ? new MacAppLauncher() : new SystemDefaultAppLauncher(),
    settingsService,
  );

  const buildDeps = () => ({
    settingsService,
    gitService: workspaceScoped.gitService,
    adapterManager: workspaceScoped.adapterManager,
    dialogPort,
    pluginService,
    credentialStore,
    skillService: workspaceScoped.skillService,
    agentService: workspaceScoped.agentService,
    hookService,
    instructionService: workspaceScoped.instructionService,
    sessionService: workspaceScoped.sessionService,
    embeddedBrowserPort: embeddedBrowserAdapter,
    sessionHistoryService: workspaceScoped.sessionHistoryService,
    workspaceService,
    workspaceActivation,
    fileBrowserService,
    marketplaceService,
    healthService: workspaceScoped.healthService,
    mcpService,
    openWithService,
    notificationPort,
    workspaceTeardownService: workspaceScoped.workspaceTeardownService,
    launchConfigService: workspaceScoped.launchConfigService,
    launchProcessService: workspaceScoped.launchProcessService,
    appQuit: () => app.quit(),
  });

  const switchQueue = createTaskQueue();

  let dispatch = createDispatcher(buildHandlers(buildDeps()));

  /**
   * Serialized: activation is renderer-triggerable, and two overlapping
   * switches would interleave across the `await`s below — leaving the
   * workspace that "wins" up to which registry write happened to land last
   * rather than which switch was requested last, and leaving the on-disk
   * active pointer free to disagree with the graph every later IPC call reads.
   * Queuing makes each activation atomic with respect to the others.
   *
   * `select` runs first and persists the new active id; only once it succeeds
   * is the old graph torn down, so a rejected `workspace.open` (not a folder,
   * the home dir) leaves the open workspace and its sessions alone.
   */
  function activate<T extends Workspace | null>(select: () => Promise<T>): Promise<T> {
    return switchQueue(async () => {
      const target = await select();
      workspaceScoped.sessionService.killAll();
      workspaceScoped.launchProcessService.killAll();
      await embeddedBrowserAdapter.destroyAll();
      await workspaceScoped.entityWatchService.stop();
      activeWorkspace = target;
      workspaceScoped = buildWorkspaceScopedServices(await scopeFor(target), sharedDeps);
      fileBrowserService = fileBrowserFor(target);
      attachSessionBridges(workspaceScoped);
      attachLaunchProcessBridges(workspaceScoped);
      attachEntityWatch(workspaceScoped);
      dispatch = createDispatcher(buildHandlers(buildDeps()));
      return target;
    });
  }

  const goHome = async (): Promise<void> => {
    await activate(async () => {
      await workspaceService.goHome();
      return null;
    });
  };

  const workspaceActivation: WorkspaceActivation = {
    switchTo: (id) => activate(() => workspaceService.switchTo(id)),
    open: (path) => activate(() => workspaceService.open(path)),
    goHome,
    delete: async (id) => {
      if (activeWorkspace?.id === id) await goHome();
      await workspaceService.delete(id);
    },
  };

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

/**
 * Boots into a dispatcher that answers every call with the migration's
 * `io` error, so the renderer's first `settings.get` lands on the IoError
 * screen with the message — which names the backup folder — instead of the
 * app quitting on a dialog.
 */
function wireMigrationFailure(error: unknown): void {
  console.error('[boot] workspace migration failed:', error);
  const message = error instanceof Error ? error.message : String(error);
  ipcMain.handle(IPC_CHANNEL, () => ({ ok: false, error: { kind: 'io', message } }));
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

  // A reload (dev Cmd+R, or any other top-level navigation) wipes the
  // renderer's in-memory browser-tabs list, but every embedded browser tab's
  // `WebContentsView` lives in this process and survives it untouched —
  // still attached to the window at its last bounds. Without this, an
  // orphaned one keeps rendering on top of the freshly (and now tab-less)
  // reloaded UI. See `EmbeddedBrowserPort.hideAll`.
  mainWindow.webContents.on('did-start-navigation', () => {
    embeddedBrowserPortForReload?.hideAll();
  });

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
