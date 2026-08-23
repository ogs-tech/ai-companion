import { describe, expect, it, vi } from 'vitest';
import { buildHandlers } from '../../../src/main/ipc/registry.js';
import { SettingsService } from '../../../src/main/application/services/settings-service.js';
import { RepoService } from '../../../src/main/application/services/repo-service.js';
import type { SettingsRepository } from '../../../src/main/application/ports/settings-repository.js';
import type { RepoReader } from '../../../src/main/application/ports/repo-reader.js';
import type { DialogPort } from '../../../src/main/application/ports/dialog-port.js';
import type { AdapterManager } from '../../../src/main/application/services/adapter-manager.js';
import type { PluginService } from '../../../src/main/application/services/plugin-service.js';
import type { SkillService } from '../../../src/main/application/services/skill-service.js';
import type { AgentService } from '../../../src/main/application/services/agent-service.js';
import type { InstructionService } from '../../../src/main/application/services/instruction-service.js';
import type { SessionService } from '../../../src/main/application/services/session-service.js';
import type { WorkspaceService } from '../../../src/main/application/services/workspace-service.js';
import type { ProjectService } from '../../../src/main/application/services/project-service.js';
import type { Workspace } from '../../../src/shared/workspace.js';
import type { MarketplaceService } from '../../../src/main/application/services/marketplace-service.js';
import type { HookService } from '../../../src/main/application/services/hook-service.js';
import type { CredentialStorePort } from '../../../src/main/application/ports/credential-store-port.js';
import type { HealthService } from '../../../src/main/application/services/health/health-service.js';
import type { NotificationPort } from '../../../src/main/application/ports/notification-port.js';
import type { WorkspaceTeardownService } from '../../../src/main/application/services/workspace-teardown.js';
import type { McpService } from '../../../src/main/application/services/mcp-service.js';
import type { Settings } from '../../../src/shared/settings.js';

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
  repoService: RepoService;
  adapterManager: AdapterManager;
  dialogPort: DialogPort;
  pluginService: PluginService;
  credentialStore: CredentialStorePort;
  skillService: SkillService;
  agentService: AgentService;
  instructionService: InstructionService;
  sessionService: SessionService;
  workspaceService: WorkspaceService;
  switchActiveWorkspace: (id: string) => Promise<Workspace>;
  projectService: ProjectService;
  marketplaceService: MarketplaceService;
  hookService: HookService;
  healthService: HealthService;
  mcpService: McpService;
  notificationPort: NotificationPort;
  workspaceTeardownService: WorkspaceTeardownService;
  appQuit: () => void;
  settingsRepoSpy: {
    load: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
  };
  repoReaderSpy: {
    exists: ReturnType<typeof vi.fn>;
    readFile: ReturnType<typeof vi.fn>;
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

  const repoReaderSpy = {
    exists: vi.fn().mockResolvedValue(true),
    readFile: vi.fn().mockResolvedValue(''),
  };
  const reader: RepoReader = {
    exists: repoReaderSpy.exists,
    readFile: repoReaderSpy.readFile,
  };

  const dialogSpy = {
    selectFolder: vi.fn().mockResolvedValue({ canceled: false, path: '/picked' }),
  };
  const dialogPort: DialogPort = {
    selectFolder: dialogSpy.selectFolder,
  };

  const adapterManager: AdapterManager = {
    syncAll: vi.fn().mockResolvedValue([]),
    removeAll: vi.fn().mockResolvedValue([]),
    removeAdapterSymlinks: vi.fn().mockResolvedValue({ removed: 0, skipped: 0, errors: [] }),
    countDestinations: vi.fn().mockResolvedValue(0),
  } as unknown as AdapterManager;

  const pluginService = null as unknown as PluginService;
  const skillService = null as unknown as SkillService;
  const agentService = null as unknown as AgentService;
  const instructionService = null as unknown as InstructionService;
  const sessionService = null as unknown as SessionService;
  const workspaceService = null as unknown as WorkspaceService;
  const switchActiveWorkspace = vi.fn() as unknown as (id: string) => Promise<Workspace>;
  const projectService = null as unknown as ProjectService;
  const marketplaceService = null as unknown as MarketplaceService;
  const hookService = null as unknown as HookService;
  const healthService = null as unknown as HealthService;
  const mcpService = null as unknown as McpService;
  const notificationPort = null as unknown as NotificationPort;
  const workspaceTeardownService = {
    restore: vi.fn().mockResolvedValue(undefined),
  } as unknown as WorkspaceTeardownService;
  const credentialStore: CredentialStorePort = {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    isAvailable: vi.fn().mockResolvedValue(true),
  };

  return {
    settingsService: new SettingsService(repo),
    repoService: new RepoService(reader),
    adapterManager,
    dialogPort,
    pluginService,
    credentialStore,
    skillService,
    agentService,
    instructionService,
    sessionService,
    workspaceService,
    switchActiveWorkspace,
    projectService,
    marketplaceService,
    hookService,
    healthService,
    mcpService,
    notificationPort,
    workspaceTeardownService,
    appQuit: () => undefined,
    settingsRepoSpy,
    repoReaderSpy,
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

  it('repo.detectGit delegates to RepoService.detectGit', async () => {
    const deps = buildDeps();
    deps.repoReaderSpy.exists.mockResolvedValueOnce(true);
    const handlers = buildHandlers(deps);

    const result = await handlers['repo.detectGit']?.({ path: '/repo' });

    expect(result).toBe(true);
    expect(deps.repoReaderSpy.exists).toHaveBeenCalledWith('/repo/.git');
  });

  it('repo.getCurrentBranch delegates to RepoService.getCurrentBranch', async () => {
    const deps = buildDeps();
    deps.repoReaderSpy.exists.mockResolvedValue(true);
    deps.repoReaderSpy.readFile.mockResolvedValueOnce('ref: refs/heads/main\n');
    const handlers = buildHandlers(deps);

    const result = await handlers['repo.getCurrentBranch']?.({ path: '/repo' });

    expect(result).toBe('main');
  });

  it('repo.link is no longer registered (linkedRepos removed)', () => {
    const deps = buildDeps();
    const handlers = buildHandlers(deps);
    expect(handlers['repo.link']).toBeUndefined();
    expect(handlers['repo.unlink']).toBeUndefined();
    expect(handlers['repo.list']).toBeUndefined();
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
