import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { createDesktopShell } from './desktop-shell.js';
import { FileLogger } from './infrastructure/logging/file-logger.js';
import { FsWindowStateStore } from './infrastructure/window/fs-window-state-store.js';
import { createServer, type Server } from 'node:http';
import { unlinkSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { IPC_CHANNEL } from '../shared/ipc-contract.js';
import { brand } from '../shared/brand.js';
import { devLockPath, workspaceHomePath, workspacePath as workspaceDataDir } from '../shared/brand-paths.js';
import type { Workspace } from '../shared/workspace.js';
import { workspaceFolders } from '../shared/workspace.js';
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
import { NodeFileOperationsAdapter } from './infrastructure/filesystem/node-file-operations-adapter.js';
import { ElectronTrash } from './infrastructure/shell/electron-trash.js';
import { ChokidarTreeWatcher } from './infrastructure/file-watcher/chokidar-tree-watcher.js';
import { FileOperationsService } from './application/services/file-operations-service.js';
import { ProjectSearchService } from './application/services/project-search-service.js';
import { ExternalFileService } from './application/services/external-file-service.js';
import { TreeWatchService } from './application/services/tree-watch-service.js';
import { WORKSPACE_TREE_CHANGED_CHANNEL } from '../shared/file-ops.js';
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
import { FsConventionSource } from './infrastructure/git/fs-convention-source.js';
import { ClaudeCliCommitMessageGenerator } from './infrastructure/claude-cli/claude-cli-commit-message-generator.js';
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
import { NodePtySessionAdapter } from './infrastructure/session-runtime/node-pty-session-adapter.js';
import { FsSessionSignalAdapter } from './infrastructure/session-signals/fs-session-signal-adapter.js';
import { SessionService } from './application/services/session-service.js';
import { SessionSignalHooksInstaller } from './application/services/session-signal-hooks-installer.js';
import { MergeMaterializer } from './application/services/merge-materializer.js';
import { CURSOR_PROFILE } from './infrastructure/session-runtime/cli-profiles.js';
import { CompositeTranscriptAdapter } from './infrastructure/session-runtime/composite-transcript-adapter.js';
import { NodeSqliteCursorChatStore } from './infrastructure/session-runtime/node-sqlite-cursor-chat-store.js';
import { FsCursorTranscriptAdapter } from './infrastructure/session-runtime/fs-cursor-transcript-adapter.js';
import { EmbeddedBrowserAdapter } from './infrastructure/browser/embedded-browser-adapter.js';
import type { EmbeddedBrowserPort } from './application/ports/embedded-browser-port.js';
import { FsClaudeTranscriptAdapter } from './infrastructure/claude-cli/fs-claude-transcript-adapter.js';
import { SESSION_OUTPUT_CHANNEL, SESSION_EXIT_CHANNEL, SESSION_ACTIVITY_CHANNEL } from '../shared/session.js';
import { ENTITY_CHANGED_CHANNEL } from '../shared/entity.js';
import { TERMINAL_OUTPUT_CHANNEL, TERMINAL_EXIT_CHANNEL } from '../shared/terminal.js';
import { FsLaunchConfigReader } from './infrastructure/launch-config/fs-launch-config-reader.js';
import { NodePtyTerminalAdapter } from './infrastructure/terminal/node-pty-terminal-adapter.js';
import { ChokidarFileWatcher } from './infrastructure/file-watcher/chokidar-file-watcher.js';
import { MarketplaceService } from './application/services/marketplace-service.js';
import { MarketplaceSeeder } from './application/services/marketplace-seeder.js';
import { SettingsMarketplaceRepository } from './infrastructure/marketplace/settings-marketplace-repository.js';
import { FsClaudeRuntimeReader } from './infrastructure/claude-runtime/fs-claude-runtime-reader.js';
import { PluginMcpReader } from './infrastructure/mcp/plugin-mcp-reader.js';
import { McpService } from './application/services/mcp-service.js';
import { UnixSocketLinkRouter } from './infrastructure/link-routing/unix-socket-link-router.js';
import { EXTERNAL_LINK_CHANNEL } from '../shared/external-link.js';
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

const globalDataDir = workspaceDataDir(homedir());
const logger = new FileLogger({ directory: join(globalDataDir, 'logs'), version: app.getVersion() });
const desktopShell = createDesktopShell({
  logger,
  windowState: new FsWindowStateStore(join(globalDataDir, 'window-state.json')),
  isDev,
  getMainWindow: () => mainWindow,
});
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

  const shellPort = new ElectronShell();
  const linkRouter = new UnixSocketLinkRouter({ baseDir: workspacePath });
  // A URL the session's CLI opened itself: show it in the embedded browser,
  // or — with no window to show it in — fall back to the default browser.
  linkRouter.onUrl((url) => {
    if (mainWindow !== null && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(EXTERNAL_LINK_CHANNEL, { url });
    } else {
      void shellPort.openExternal(url).catch((error: unknown) => console.error('[link-routing] openExternal failed', error));
    }
  });
  // Best-effort: without the socket, sessions spawn with the plain env and links keep going to the default browser.
  await linkRouter.start().catch((error: unknown) => console.error('[link-routing] disabled:', error));
  app.on('before-quit', (event) => {
    if (event.defaultPrevented) return; // Quit not approved yet — see desktop-shell.
    void linkRouter.stop();
  });

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
    const folders = workspaceFolders(workspace);
    if (folders.length === 1) return { workspace, dataDir };
    // Several folders: each keeps its own data dir; the workspace's shared set lives under Global.
    for (const folder of folders.slice(1)) await workspaceBootstrap.create(workspaceDataDir(folder));
    const sharedDataDir = join(workspaceHomePath(home, workspace.id), 'data');
    await workspaceBootstrap.create(sharedDataDir);
    return { workspace, dataDir, sharedDataDir };
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
  const hookService = new HookService(
    () => ({
      entities: workspaceScoped.entityService,
      detection: workspaceScoped.detectionService,
      workspaceId: workspaceScoped.entityRepository.activeWorkspaceId,
    }),
    { cache: pluginCache, fs: nodeFsAdapter },
  );
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

  const pluginMcpReader = new PluginMcpReader({
    listRoots: (scope) => pluginProvenance.roots(scope),
  });
  const mcpService = new McpService({
    // Rebuilt per workspace activation, hence a getter over the live graph.
    canonical: () => ({
      entities: workspaceScoped.entityService,
      detection: workspaceScoped.detectionService,
      workspaceId: workspaceScoped.entityRepository.activeWorkspaceId,
    }),
    plugins: pluginMcpReader,
    runtime: claudeRuntimeReader,
    shell: shellPort,
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

  const sessionSignals = new FsSessionSignalAdapter(join(workspacePath, 'session-signals'));

  const sessionRuntimes = {
    claude: new NodePtySessionAdapter('claude', () => ({ ...process.env, ...linkRouter.shimEnv() })),
    // `cursor-agent` installs to ~/.local/bin, which a GUI-launched app's PATH usually lacks.
    cursor: new NodePtySessionAdapter(
      'cursor-agent',
      () => ({ ...process.env, PATH: [process.env['PATH'], join(home, '.local', 'bin')].filter(Boolean).join(delimiter) }),
      CURSOR_PROFILE,
      [join(home, '.local', 'bin')],
    ),
  };

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
    // The CLI's own transcript directory — resolved here, like every other
    // `~/.claude` path, so the adapter stays a pure reader of a given folder.
    sessionTranscriptPort: new CompositeTranscriptAdapter({
      claude: new FsClaudeTranscriptAdapter(join(home, '.claude', 'projects')),
      cursor: new FsCursorTranscriptAdapter(join(home, '.cursor', 'chats'), new NodeSqliteCursorChatStore()),
    }),
    fileWatcherPort: new ChokidarFileWatcher(),
    launchConfigReaderPort: new FsLaunchConfigReader(),
    terminalPort: new NodePtyTerminalAdapter(),
    repoGitPort: new SimpleGitRepoClient(),
    conventionSourcePort: new FsConventionSource(),
    commitMessageGeneratorFor: (cwd: string) => new ClaudeCliCommitMessageGenerator({ cwd }),
  };

  if (migration.migrated) await syncAfterMigration(migration.touchedWorkspaceIds);

  const initialScope = await scopeFor(activeWorkspace);
  let workspaceScoped: WorkspaceScopedServices = buildWorkspaceScopedServices(initialScope, sharedDeps);

  // Built once and never rebuilt: live sessions outlive a switch between
  // Global and workspaces, so they cannot live in the per-scope graph.
  // `activate()` re-points it at whichever scope opens next.
  const sessionService = new SessionService(
    workspaceScoped.entityService,
    sessionRuntimes,
    embeddedBrowserAdapter,
    initialScope?.dataDir ?? globalEntities.dataDir,
    { workspaceService, activeWorkspace, homedir: home },
    nodeFsAdapter,
    { signals: sessionSignals },
  );

  const fileBrowserPort = new NodeFileBrowserAdapter([new NumbersConverterAdapter()]);
  const fileBrowserFor = (workspace: Workspace | null): FileBrowserService | null =>
    workspace === null ? null : new FileBrowserService(fileBrowserPort, workspace.rootPath, workspaceFolders(workspace));
  let fileBrowserService = fileBrowserFor(activeWorkspace);

  // File operations, search and the tree watcher follow the open workspace; the
  // external-file grant list is app-wide and survives every switch.
  const fileOperationsPort = new NodeFileOperationsAdapter();
  const trashPort = new ElectronTrash();
  const treeWatcherPort = new ChokidarTreeWatcher();
  const externalFileService = new ExternalFileService(dialogPort, fileBrowserPort, fileOperationsPort);
  let fileOperationsService: FileOperationsService | null = null;
  let projectSearchService: ProjectSearchService | null = null;
  let treeWatchService: TreeWatchService | null = null;
  const rebuildFileServices = async (): Promise<void> => {
    await treeWatchService?.stop();
    treeWatchService = null;
    if (fileBrowserService === null) {
      fileOperationsService = null;
      projectSearchService = null;
      return;
    }
    fileOperationsService = new FileOperationsService(fileBrowserService, fileOperationsPort, trashPort, externalFileService);
    projectSearchService = new ProjectSearchService(fileBrowserService, fileOperationsPort);
    treeWatchService = new TreeWatchService(treeWatcherPort, fileBrowserService);
    treeWatchService.onTreeChanged((event) => {
      mainWindow?.webContents.send(WORKSPACE_TREE_CHANGED_CHANNEL, event);
    });
    treeWatchService.start();
  };
  await rebuildFileServices();

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

  const attachSessionBridges = (): void => {
    sessionService.onOutput((sessionId, chunk) => {
      mainWindow?.webContents.send(SESSION_OUTPUT_CHANNEL, { sessionId, chunk });
    });
    sessionService.onActivity((sessionId) => {
      mainWindow?.webContents.send(SESSION_ACTIVITY_CHANNEL, { sessionId });
    });
    sessionService.onExit((sessionId, _status, exitCode) => {
      mainWindow?.webContents.send(SESSION_EXIT_CHANNEL, { sessionId, exitCode });
    });
  };
  attachSessionBridges();

  // Cursor takes hooks only from its global hooks.json; best-effort, and only when the CLI exists.
  if (await sessionRuntimes.cursor.isAvailable()) {
    new SessionSignalHooksInstaller(new MergeMaterializer(nodeFsAdapter, clock, workspacePath), join(home, '.cursor', 'hooks.json'))
      .install()
      .catch((error: unknown) => console.error('[session-signals] cursor hooks not installed:', error));
  }

  const attachTerminalBridges = (services: WorkspaceScopedServices): void => {
    services.terminalService.onOutput((event) => {
      mainWindow?.webContents.send(TERMINAL_OUTPUT_CHANNEL, event);
    });
    services.terminalService.onExit((event) => {
      mainWindow?.webContents.send(TERMINAL_EXIT_CHANNEL, event);
    });
  };
  attachTerminalBridges(workspaceScoped);

  const attachEntityWatch = (services: WorkspaceScopedServices): void => {
    services.entityWatchService.onEntityChanged((event) => {
      mainWindow?.webContents.send(ENTITY_CHANGED_CHANNEL, event);
    });
    services.entityWatchService.start();
  };
  attachEntityWatch(workspaceScoped);

  app.on('before-quit', (event) => {
    if (event.defaultPrevented) return; // Quit not approved yet — see desktop-shell.
    sessionService.killAll();
    workspaceScoped.terminalService.killAll();
    void embeddedBrowserAdapter.destroyAll();
    void workspaceScoped.entityWatchService.stop();
    void treeWatchService?.stop();
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
    commitMessageService: workspaceScoped.commitMessageService,
    adapterManager: workspaceScoped.adapterManager,
    dialogPort,
    pluginService,
    credentialStore,
    skillService: workspaceScoped.skillService,
    agentService: workspaceScoped.agentService,
    hookService,
    instructionService: workspaceScoped.instructionService,
    sessionService,
    embeddedBrowserPort: embeddedBrowserAdapter,
    sessionHistoryService: workspaceScoped.sessionHistoryService,
    workspaceService,
    workspaceActivation,
    fileBrowserService,
    fileOperationsService,
    projectSearchService,
    externalFileService,
    marketplaceService,
    healthService: workspaceScoped.healthService,
    mcpService,
    detectionService: workspaceScoped.detectionService,
    openWithService,
    notificationPort,
    workspaceTeardownService: workspaceScoped.workspaceTeardownService,
    launchConfigService: workspaceScoped.launchConfigService,
    terminalService: workspaceScoped.terminalService,
    openEditorsService: workspaceScoped.openEditorsService,
    appQuit: () => app.quit(),
    desktop: {
      logger,
      setWindowTitle: desktopShell.setWindowTitle,
      respondToQuit: desktopShell.respondToQuit,
      openLogsFolder: desktopShell.openLogsFolder,
    },
  });

  const switchQueue = createTaskQueue();

  // Assigned below, once `workspaceActivation` exists — `buildDeps()` reads it,
  // so building the first dispatcher here would hit its TDZ.
  let dispatch: ReturnType<typeof createDispatcher>;

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
      // Workspace/Início sessions keep running across the switch; entity
      // sessions belong to the editor that opened them, so they end with it.
      sessionService.killEntitySessions();
      workspaceScoped.terminalService.killAll();
      await embeddedBrowserAdapter.closeManualTabs();
      await workspaceScoped.entityWatchService.stop();
      activeWorkspace = target;
      const scope = await scopeFor(target);
      workspaceScoped = buildWorkspaceScopedServices(scope, sharedDeps);
      fileBrowserService = fileBrowserFor(target);
      await rebuildFileServices();
      sessionService.rebind({
        entityService: workspaceScoped.entityService,
        workspacePath: scope?.dataDir ?? globalEntities.dataDir,
        activeWorkspace: target,
      });
      attachTerminalBridges(workspaceScoped);
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

  /**
   * Applies a folder/name edit. Services hold a snapshot of the open
   * workspace, so a rename only refreshes it; a change of folders rebuilds the
   * graph (entity stores, git, file browser and watchers are per-folder), which
   * ends the live sessions and terminals — the same as switching workspaces.
   */
  const edited = async (id: string, edit: () => Promise<Workspace>, rebuild: boolean): Promise<Workspace> => {
    const wasActive = activeWorkspace?.id === id;
    const updated = await edit();
    // A session keeps the folders it started with, so a folder change ends the
    // workspace's sessions — in the background ones too, not just the open one.
    if (rebuild) sessionService.killScope(id);
    if (!wasActive) return updated;
    if (rebuild) return activate(async () => updated);
    activeWorkspace = updated;
    return updated;
  };

  const baseActivation: WorkspaceActivation = {
    addFolder: (id, path) => edited(id, () => workspaceService.addFolder(id, path), true),
    removeFolder: (id, path) => edited(id, () => workspaceService.removeFolder(id, path), true),
    rename: (id, name) => edited(id, () => workspaceService.rename(id, name), false),
    switchTo: (id) => activate(() => workspaceService.switchTo(id)),
    open: (path) => activate(() => workspaceService.open(path)),
    goHome,
    delete: async (id) => {
      sessionService.killScope(id);
      if (activeWorkspace?.id === id) await goHome();
      await workspaceService.delete(id);
    },
  };

  /** The "Abrir recente" menu lists workspaces, so any operation that can change that list refreshes it. */
  const refreshMenu = async (): Promise<void> => {
    try {
      desktopShell.setRecentWorkspaces(await workspaceService.list());
    } catch (error) {
      logger.error({ process: 'main', message: 'Could not refresh the application menu', stack: error instanceof Error ? error.stack : undefined });
    }
  };
  const refreshing =
    <A extends unknown[], R>(operation: (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      try {
        return await operation(...args);
      } finally {
        void refreshMenu();
      }
    };
  const workspaceActivation: WorkspaceActivation = {
    addFolder: refreshing(baseActivation.addFolder),
    removeFolder: refreshing(baseActivation.removeFolder),
    rename: refreshing(baseActivation.rename),
    switchTo: refreshing(baseActivation.switchTo),
    open: refreshing(baseActivation.open),
    goHome: refreshing(baseActivation.goHome),
    delete: refreshing(baseActivation.delete),
  };
  void refreshMenu();

  dispatch = createDispatcher(buildHandlers(buildDeps()));

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
    ...desktopShell.windowOptions(),
    show: false,
    title: brand.documentTitle,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  desktopShell.attachWindow(mainWindow);

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
  // The Dock icon stays visible: hiding it makes macOS treat the app as an
  // accessory process, which has no menu bar — the native menu would never show.
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
  desktopShell.registerProcessHandlers();

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
