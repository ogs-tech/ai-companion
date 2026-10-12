import { describe, expect, it, vi } from 'vitest';
import { buildHandlers } from '../../../src/main/ipc/registry.js';
import { SettingsService } from '../../../src/main/application/services/settings-service.js';
import type { GitService } from '../../../src/main/application/services/git-service.js';
import type { SettingsRepository } from '../../../src/main/application/ports/settings-repository.js';
import type { DialogPort } from '../../../src/main/application/ports/dialog-port.js';
import type { AdapterManager } from '../../../src/main/application/services/adapter-manager.js';
import type { PluginService } from '../../../src/main/application/services/plugin-service.js';
import type { SkillService } from '../../../src/main/application/services/skill-service.js';
import type { AgentService } from '../../../src/main/application/services/agent-service.js';
import type { InstructionService } from '../../../src/main/application/services/instruction-service.js';
import type { SessionService } from '../../../src/main/application/services/session-service.js';
import type { EmbeddedBrowserPort } from '../../../src/main/application/ports/embedded-browser-port.js';
import type { SessionHistoryService } from '../../../src/main/application/services/session-history-service.js';
import type { WorkspaceService } from '../../../src/main/application/services/workspace-service.js';
import type { WorkspaceActivation } from '../../../src/main/ipc/workspace-handlers.js';
import { createDispatcher } from '../../../src/main/ipc/dispatcher.js';
import type { MarketplaceService } from '../../../src/main/application/services/marketplace-service.js';
import type { HookService } from '../../../src/main/application/services/hook-service.js';
import type { CredentialStorePort } from '../../../src/main/application/ports/credential-store-port.js';
import type { HealthService } from '../../../src/main/application/services/health/health-service.js';
import type { NotificationPort } from '../../../src/main/application/ports/notification-port.js';
import type { WorkspaceTeardownService } from '../../../src/main/application/services/workspace-teardown.js';
import type { McpService } from '../../../src/main/application/services/mcp-service.js';
import type { OpenWithService } from '../../../src/main/application/services/open-with-service.js';
import type { FileBrowserService } from '../../../src/main/application/services/file-browser-service.js';
import type { Settings } from '../../../src/shared/settings.js';
import type { LaunchConfigService } from '../../../src/main/application/services/launch-config-service.js';
import type { LaunchProcessService } from '../../../src/main/application/services/launch-process-service.js';

const baseSettings = (overrides: Partial<Settings> = {}): Settings => ({
  adapters: {
    claude: { enabled: true },
    cursor: { enabled: false },
  },  ui: { theme: 'system' },
  language: 'off',
  ...overrides,
});

interface Deps {
  settingsService: SettingsService;
  gitService: GitService;
  adapterManager: AdapterManager;
  dialogPort: DialogPort;
  pluginService: PluginService;
  credentialStore: CredentialStorePort;
  skillService: SkillService;
  agentService: AgentService;
  instructionService: InstructionService;
  sessionService: SessionService;
  embeddedBrowserPort: EmbeddedBrowserPort;
  sessionHistoryService: SessionHistoryService;
  workspaceService: WorkspaceService;
  workspaceActivation: WorkspaceActivation;
  fileBrowserService: FileBrowserService | null;
  marketplaceService: MarketplaceService;
  hookService: HookService;
  healthService: HealthService;
  mcpService: McpService;
  openWithService: OpenWithService;
  notificationPort: NotificationPort;
  workspaceTeardownService: WorkspaceTeardownService;
  launchConfigService: LaunchConfigService;
  launchProcessService: LaunchProcessService;
  appQuit: () => void;
  settingsRepoSpy: {
    load: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
  };
  dialogSpy: {
    selectFolder: ReturnType<typeof vi.fn>;
  };
}

const buildDeps = (initial: Settings | null = baseSettings()): Deps => {
  const settingsRepoSpy = {
    load: vi.fn().mockResolvedValue(initial),
    save: vi.fn().mockResolvedValue(undefined),
  };
  const repo: SettingsRepository = {
    load: settingsRepoSpy.load,
    save: settingsRepoSpy.save,
  };

  const dialogSpy = {
    selectFolder: vi.fn().mockResolvedValue({ canceled: false, path: '/picked' }),
    selectApplication: vi.fn().mockResolvedValue({ canceled: true }),
  };
  const dialogPort: DialogPort = {
    selectFolder: dialogSpy.selectFolder,
    selectApplication: dialogSpy.selectApplication,
  };

  const adapterManager: AdapterManager = {
    syncAll: vi.fn().mockResolvedValue([]),
    removeAll: vi.fn().mockResolvedValue([]),
    removeAdapterSymlinks: vi.fn().mockResolvedValue({ removed: 0, skipped: 0, errors: [] }),
    countDestinations: vi.fn().mockResolvedValue(0),
  } as unknown as AdapterManager;

  const openWithService = null as unknown as OpenWithService;
  const pluginService = null as unknown as PluginService;
  const skillService = null as unknown as SkillService;
  const agentService = null as unknown as AgentService;
  const instructionService = null as unknown as InstructionService;
  const sessionService = null as unknown as SessionService;
  const embeddedBrowserPort = null as unknown as EmbeddedBrowserPort;
  const sessionHistoryService = null as unknown as SessionHistoryService;
  const workspaceService = null as unknown as WorkspaceService;
  const workspaceActivation = {
    switchTo: vi.fn(),
    open: vi.fn(),
    goHome: vi.fn(),
    delete: vi.fn(),
  } as unknown as WorkspaceActivation;
  const fileBrowserService = null;
  const marketplaceService = null as unknown as MarketplaceService;
  const hookService = null as unknown as HookService;
  const healthService = null as unknown as HealthService;
  const mcpService = null as unknown as McpService;
  const notificationPort = null as unknown as NotificationPort;
  const workspaceTeardownService = {
    restore: vi.fn().mockResolvedValue(undefined),
  } as unknown as WorkspaceTeardownService;
  const launchConfigService = null as unknown as LaunchConfigService;
  const launchProcessService = null as unknown as LaunchProcessService;
  const credentialStore: CredentialStorePort = {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    isAvailable: vi.fn().mockResolvedValue(true),
  };

  return {
    settingsService: new SettingsService(repo),
    gitService: null as unknown as GitService,
    adapterManager,
    dialogPort,
    pluginService,
    credentialStore,
    skillService,
    agentService,
    instructionService,
    sessionService,
    embeddedBrowserPort,
    sessionHistoryService,
    workspaceService,
    workspaceActivation,
    fileBrowserService,
    marketplaceService,
    hookService,
    healthService,
    mcpService,
    openWithService,
    notificationPort,
    workspaceTeardownService,
    launchConfigService,
    launchProcessService,
    appQuit: () => undefined,
    settingsRepoSpy,
    dialogSpy,
  };
};

describe('buildHandlers', () => {
  it('registers settings.get and delegates to SettingsService', async () => {
    const deps = buildDeps();
    const handlers = buildHandlers(deps);

    expect(handlers).toHaveProperty('settings.get');
    const result = await handlers['settings.get']?.({});
    expect(result).toEqual(baseSettings());
    expect(deps.settingsRepoSpy.load).toHaveBeenCalledTimes(1);
  });

  it('settings.save persists the provided settings', async () => {
    const deps = buildDeps();
    const handlers = buildHandlers(deps);

    const next = baseSettings({ ui: { theme: 'dark' } });
    const result = await handlers['settings.save']?.(next);

    expect(result).toBeUndefined();
    expect(deps.settingsRepoSpy.save).toHaveBeenCalledWith(next);
  });

  it('settings.merge applies a deep-merge and persists the consolidated state', async () => {
    const deps = buildDeps();
    const handlers = buildHandlers(deps);

    const merged = (await handlers['settings.merge']?.({
      adapters: { claude: { enabled: false } },
      ui: { theme: 'dark' },
      language: 'off',
    })) as Settings;

    expect(merged.adapters.claude.enabled).toBe(false);
    expect(merged.ui.theme).toBe('dark');
    expect(deps.settingsRepoSpy.save).toHaveBeenCalledWith(merged);
  });

  it('repo.detectGit / repo.getCurrentBranch are no longer registered (superseded by git.status)', () => {
    const handlers = buildHandlers(buildDeps());
    expect(handlers['repo.detectGit']).toBeUndefined();
    expect(handlers['repo.getCurrentBranch']).toBeUndefined();
  });

  it('repo.link is no longer registered (linkedRepos removed)', () => {
    const deps = buildDeps();
    const handlers = buildHandlers(deps);
    expect(handlers['repo.link']).toBeUndefined();
    expect(handlers['repo.unlink']).toBeUndefined();
    expect(handlers['repo.list']).toBeUndefined();
  });

  it('project.* is no longer registered (a folder is a workspace now) — the dispatcher answers not_found', async () => {
    const handlers = buildHandlers(buildDeps());
    expect(Object.keys(handlers).filter((method) => method.startsWith('project.'))).toEqual([]);
    const dispatch = createDispatcher(handlers);
    expect(await dispatch('project.list', {})).toMatchObject({ ok: false, error: { kind: 'not_found' } });
  });

  it('registers workspace.open and workspace.goHome', () => {
    const handlers = buildHandlers(buildDeps());
    expect(handlers['workspace.open']).toBeTypeOf('function');
    expect(handlers['workspace.goHome']).toBeTypeOf('function');
  });

  it('dialog.selectFolder delegates to DialogPort.selectFolder', async () => {
    const deps = buildDeps();
    deps.dialogSpy.selectFolder.mockResolvedValueOnce({
      canceled: false,
      path: '/picked',
    });
    const handlers = buildHandlers(deps);

    const result = await handlers['dialog.selectFolder']?.({
      defaultPath: '/home',
    });

    expect(result).toEqual({ canceled: false, path: '/picked' });
    expect(deps.dialogSpy.selectFolder).toHaveBeenCalledWith({
      defaultPath: '/home',
    });
  });

  it('app.restore delegates to WorkspaceTeardownService.restore, then quits', async () => {
    const deps = buildDeps();
    const restore = vi.fn().mockResolvedValue(undefined);
    const appQuit = vi.fn();
    deps.workspaceTeardownService = { restore } as unknown as WorkspaceTeardownService;
    deps.appQuit = appQuit;
    const handlers = buildHandlers(deps);

    await handlers['app.restore']?.({});

    expect(restore).toHaveBeenCalledTimes(1);
    expect(appQuit).toHaveBeenCalledTimes(1);
    // Teardown must complete before the app quits.
    const restoreOrder = restore.mock.invocationCallOrder[0] ?? Infinity;
    const quitOrder = appQuit.mock.invocationCallOrder[0] ?? -Infinity;
    expect(restoreOrder).toBeLessThan(quitOrder);
  });
});
