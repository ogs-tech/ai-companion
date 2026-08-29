import type { SettingsService } from '../application/services/settings-service.js';
import type { RepoService } from '../application/services/repo-service.js';
import type { AdapterManager } from '../application/services/adapter-manager.js';
import type { DialogPort, SelectFolderParams } from '../application/ports/dialog-port.js';
import type { PluginService } from '../application/services/plugin-service.js';
import type { SkillService } from '../application/services/skill-service.js';
import type { AgentService } from '../application/services/agent-service.js';
import type { InstructionService } from '../application/services/instruction-service.js';
import type { SessionService } from '../application/services/session-service.js';
import type { FileBrowserService } from '../application/services/file-browser-service.js';
import type { FileBrowserPort } from '../application/ports/file-browser-port.js';
import { buildSessionHandlers } from './session-handlers.js';
import { buildWorkspaceHandlers } from './workspace-handlers.js';
import type { WorkspaceService } from '../application/services/workspace-service.js';
import type { Workspace } from '../../shared/workspace.js';
import { buildProjectHandlers } from './project-handlers.js';
import type { ProjectService } from '../application/services/project-service.js';
import type { HookService } from '../application/services/hook-service.js';
import type { MarketplaceService } from '../application/services/marketplace-service.js';
import type { CredentialStorePort } from '../application/ports/credential-store-port.js';
import { DomainError } from '../domain/errors.js';
import type { Settings } from '../../shared/settings.js';
import type { IpcHandlers } from './dispatcher.js';
import { buildPluginHandlers } from './plugin-handlers.js';
import { buildCredentialsHandlers } from './credentials-handlers.js';
import { buildSkillHandlers } from './skill-handlers.js';
import { buildAgentHandlers } from './agent-handlers.js';
import { buildHookHandlers } from './hook-handlers.js';
import { buildInstructionHandlers } from './instruction-handlers.js';
import { buildMarketplaceHandlers } from './marketplace-handlers.js';
import { buildHealthHandlers } from './health-handlers.js';
import type { HealthService } from '../application/services/health/health-service.js';
import { buildMcpHandlers } from './mcp-handlers.js';
import type { McpService } from '../application/services/mcp-service.js';
import type { NotificationPort } from '../application/ports/notification-port.js';
import type { WorkspaceTeardownService } from '../application/services/workspace-teardown.js';
import { updateLanguageSection } from '../application/services/language-section.js';
import { asLanguagePreference } from './_validators.js';

export interface IpcDeps {
  settingsService: SettingsService;
  repoService: RepoService;
  adapterManager: AdapterManager;
  dialogPort: DialogPort;
  pluginService: PluginService;
  credentialStore: CredentialStorePort;
  skillService: SkillService;
  agentService: AgentService;
  hookService: HookService;
  instructionService: InstructionService;
  sessionService: SessionService;
  workspaceService: WorkspaceService;
  switchActiveWorkspace: (id: string) => Promise<Workspace>;
  fileBrowserService: FileBrowserService;
  fileBrowserPort: FileBrowserPort;
  projectService: ProjectService;
  marketplaceService: MarketplaceService;
  healthService: HealthService;
  mcpService: McpService;
  notificationPort: NotificationPort;
  workspaceTeardownService: WorkspaceTeardownService;
  appQuit: () => void;
}

interface RepoPathParams {
  path: string;
}

const asString = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new DomainError('validation', `Missing or invalid '${field}'`);
  }
  return value;
};

const asObject = (value: unknown, label: string): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new DomainError('validation', `Invalid '${label}' payload`);
  }
  return value as Record<string, unknown>;
};

export function buildHandlers(deps: IpcDeps): IpcHandlers {
  const {
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
    sessionService,
    workspaceService,
    switchActiveWorkspace,
    fileBrowserService,
    fileBrowserPort,
    projectService,
    marketplaceService,
    healthService,
    mcpService,
    notificationPort,
    workspaceTeardownService,
    appQuit,
  } = deps;

  return {
    'settings.get': () => settingsService.load(),

    'settings.save': async (params) => {
      await settingsService.save(params as Settings);
    },

    'settings.merge': (params) =>
      settingsService.merge(params as Parameters<SettingsService['merge']>[0]),

    'settings.setLanguage': async (params) => {
      const raw = asObject(params, 'settings.setLanguage');
      const language = asLanguagePreference(raw['language'], 'language');

      const settings = await settingsService.merge({ language });

      const instruction = await instructionService.get('default');
      const newContent = updateLanguageSection(instruction.content, language);
      const { syncReport } = await instructionService.save({
        instruction: { ...instruction, content: newContent },
      });

      return { settings, syncReport };
    },

    'repo.detectGit': (params) => {
      const { path } = params as RepoPathParams;
      return repoService.detectGit(asString(path, 'path'));
    },

    'repo.getCurrentBranch': (params) => {
      const { path } = params as RepoPathParams;
      return repoService.getCurrentBranch(asString(path, 'path'));
    },

    'dialog.selectFolder': (params) => {
      const raw = params === undefined || params === null ? {} : asObject(params, 'dialog.selectFolder');
      const dialogParams: SelectFolderParams = {};
      if (typeof raw['defaultPath'] === 'string') {
        dialogParams.defaultPath = raw['defaultPath'];
      }
      return dialogPort.selectFolder(dialogParams);
    },

    'adapter.syncAll': async (params) => {
      const raw = params === undefined || params === null ? {} : asObject(params, 'adapter.syncAll');
      const adapterId = raw['adapterId'];
      if (adapterId !== undefined && typeof adapterId !== 'string') {
        throw new DomainError('validation', `Invalid 'adapterId'`);
      }
      return adapterManager.syncAll({
        ...(typeof adapterId === 'string' ? { adapterId } : {}),
      });
    },

    'adapter.removeAll': async (params) => {
      const raw = asObject(params, 'adapter.removeAll');
      return adapterManager.removeAll({
        adapterId: asString(raw['adapterId'], 'adapterId'),
      });
    },

    'adapter.setEnabled': async (params) => {
      const raw = asObject(params, 'adapter.setEnabled');
      const adapterId = asString(raw['adapterId'], 'adapterId');
      if (typeof raw['enabled'] !== 'boolean') {
        throw new DomainError('validation', "Missing or invalid 'enabled'");
      }
      const enabled = raw['enabled'];
      const removeSymlinks = raw['removeSymlinks'] !== false;
      const runSyncAll = raw['runSyncAll'] !== false;

      if (!enabled) {
        let removeResult = { removed: 0, skipped: 0, errors: [] as { destination: string; kind: string; message: string }[] };
        if (removeSymlinks) {
          const links = await adapterManager.removeAdapterSymlinks(adapterId);
          const generated = await adapterManager.removeAdapterGeneratedFiles(adapterId);
          removeResult = {
            removed: links.removed + generated.removed,
            skipped: links.skipped + generated.skipped,
            errors: [...links.errors, ...generated.errors],
          };
        }
        await settingsService.merge({ adapters: { [adapterId]: { enabled: false } } });
        return removeResult;
      } else {
        await settingsService.merge({ adapters: { [adapterId]: { enabled: true } } });
        const syncReport = runSyncAll
          ? await adapterManager.syncAll({ adapterId })
          : [];
        return { syncReport };
      }
    },

    'adapter.countDestinations': async (params) => {
      const raw = asObject(params, 'adapter.countDestinations');
      const adapterId = asString(raw['adapterId'], 'adapterId');
      const count = await adapterManager.countDestinations(adapterId);
      return { count };
    },

    'app.restore': async () => {
      await workspaceTeardownService.restore();
      appQuit();
    },

    ...buildPluginHandlers(pluginService),
    ...buildCredentialsHandlers(credentialStore),
    ...buildSkillHandlers(skillService),
    ...buildAgentHandlers(agentService),
    ...buildHookHandlers(hookService),
    ...buildInstructionHandlers(instructionService),
    ...buildSessionHandlers(sessionService),
    ...buildWorkspaceHandlers(workspaceService, switchActiveWorkspace, fileBrowserService),
    ...buildProjectHandlers(projectService, fileBrowserPort),
    ...buildMarketplaceHandlers(marketplaceService),
    ...buildHealthHandlers(healthService, notificationPort),
    ...buildMcpHandlers(mcpService),
  };
}
