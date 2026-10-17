import type { SettingsService } from '../application/services/settings-service.js';
import type { GitService } from '../application/services/git-service.js';
import type { AdapterManager } from '../application/services/adapter-manager.js';
import type { DialogPort, SelectFolderParams } from '../application/ports/dialog-port.js';
import type { PluginService } from '../application/services/plugin-service.js';
import type { SkillService } from '../application/services/skill-service.js';
import type { AgentService } from '../application/services/agent-service.js';
import type { InstructionService } from '../application/services/instruction-service.js';
import type { SessionService } from '../application/services/session-service.js';
import type { FileBrowserService } from '../application/services/file-browser-service.js';
import { buildSessionHandlers } from './session-handlers.js';
import { buildBrowserHandlers } from './browser-handlers.js';
import type { EmbeddedBrowserPort } from '../application/ports/embedded-browser-port.js';
import { buildSessionHistoryHandlers } from './session-history-handlers.js';
import type { SessionHistoryService } from '../application/services/session-history-service.js';
import { buildWorkspaceHandlers, type WorkspaceActivation } from './workspace-handlers.js';
import type { WorkspaceService } from '../application/services/workspace-service.js';
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
import { buildOpenWithHandlers } from './open-with-handlers.js';
import type { OpenWithService } from '../application/services/open-with-service.js';
import { buildLaunchConfigHandlers } from './launch-config-handlers.js';
import { buildGitHandlers } from './git-handlers.js';
import type { CommitMessageService } from '../application/services/commit-message-service.js';
import type { LaunchConfigService } from '../application/services/launch-config-service.js';
import type { LaunchProcessService } from '../application/services/launch-process-service.js';
import type { McpService } from '../application/services/mcp-service.js';
import type { NotificationPort } from '../application/ports/notification-port.js';
import type { WorkspaceTeardownService } from '../application/services/workspace-teardown.js';
import { updateLanguageSection } from '../application/services/language-section.js';
import { asLanguagePreference } from './_validators.js';

export interface IpcDeps {
  settingsService: SettingsService;
  gitService: GitService;
  commitMessageService: CommitMessageService;
  adapterManager: AdapterManager;
  dialogPort: DialogPort;
  pluginService: PluginService;
  credentialStore: CredentialStorePort;
  skillService: SkillService;
  agentService: AgentService;
  hookService: HookService;
  instructionService: InstructionService;
  sessionService: SessionService;
  embeddedBrowserPort: EmbeddedBrowserPort;
  sessionHistoryService: SessionHistoryService;
  workspaceService: WorkspaceService;
  workspaceActivation: WorkspaceActivation;
  /** `null` at Início — no workspace is open, so there is no file tree. */
  fileBrowserService: FileBrowserService | null;
  marketplaceService: MarketplaceService;
  healthService: HealthService;
  mcpService: McpService;
  openWithService: OpenWithService;
  notificationPort: NotificationPort;
  workspaceTeardownService: WorkspaceTeardownService;
  launchConfigService: LaunchConfigService;
  launchProcessService: LaunchProcessService;
  appQuit: () => void;
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
    gitService,
    commitMessageService,
    adapterManager,
    dialogPort,
    pluginService,
    credentialStore,
    skillService,
    agentService,
    hookService,
    instructionService,
    sessionService,
    embeddedBrowserPort,
    sessionHistoryService,
    workspaceService,
    workspaceActivation,
    fileBrowserService,
    marketplaceService,
    healthService,
    mcpService,
    openWithService,
    notificationPort,
    workspaceTeardownService,
    launchConfigService,
    launchProcessService,
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
    ...buildBrowserHandlers(sessionService, embeddedBrowserPort),
    ...buildSessionHistoryHandlers(sessionHistoryService, sessionService),
    ...buildWorkspaceHandlers(workspaceService, workspaceActivation, fileBrowserService),
    ...buildMarketplaceHandlers(marketplaceService),
    ...buildHealthHandlers(healthService, notificationPort),
    ...buildMcpHandlers(mcpService),
    ...buildOpenWithHandlers({
      openWithService,
      workspaceBrowser: fileBrowserService,
      dialogPort,
      embeddedBrowser: embeddedBrowserPort,
      workspaceService,
    }),
    ...buildLaunchConfigHandlers(launchConfigService, launchProcessService),
    ...buildGitHandlers(gitService, commitMessageService),
  };
}
