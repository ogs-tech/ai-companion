import { join } from 'node:path';
import type { Adapter } from './ports/adapter.js';
import type { NodeFsAdapter } from '../infrastructure/filesystem/node-fs-adapter.js';
import type { SettingsService } from './services/settings-service.js';
import type { ClockPort } from './ports/clock-port.js';
import type { PluginProvenanceService } from './services/plugin-provenance.js';
import type { PluginService } from './services/plugin-service.js';
import type { ClaudeRuntimePort } from './ports/claude-runtime-port.js';
import type { ClaudeSettingsFile } from '../infrastructure/settings/claude-settings-file.js';
import type { ClaudeCliPort } from './ports/claude-cli-port.js';
import type { ClaudeSessionPort } from './ports/claude-session-port.js';
import type { WorkspaceService } from './services/workspace-service.js';
import { SymlinkManager } from './services/symlink-manager.js';
import { FileMaterializer } from './services/file-materializer.js';
import { FsEntityRepository } from '../infrastructure/entity/fs-entity-repository.js';
import { AdapterManager } from './services/adapter-manager.js';
import { EntityService } from './services/entity-service.js';
import { EntityValidator } from './services/entity-validator.js';
import { SkillService } from './services/skill-service.js';
import { AgentService } from './services/agent-service.js';
import { InstructionService } from './services/instruction-service.js';
import { SessionService } from './services/session-service.js';
import { ProjectService } from './services/project-service.js';
import { FsProjectRegistry } from '../infrastructure/project/fs-project-registry.js';
import { HealthService } from './services/health/health-service.js';
import { McpAuthCollector } from './services/health/mcp-auth-collector.js';
import { McpRuntimeCollector } from './services/health/mcp-runtime-collector.js';
import { ConfigDriftCollector } from './services/health/config-drift-collector.js';
import { SymlinkCollector } from './services/health/symlink-collector.js';
import { GeneratedFileCollector } from './services/health/generated-file-collector.js';
import type { HealthCollector } from './services/health/health-collector.js';
import { WorkspaceTeardownService } from './services/workspace-teardown.js';
import { ClaudeAdapter } from '../infrastructure/adapters/claude-adapter.js';
import { CursorAdapter } from '../infrastructure/adapters/cursor-adapter.js';

export interface WorkspaceScopedSharedDeps {
  clock: ClockPort;
  nodeFsAdapter: NodeFsAdapter;
  settingsService: SettingsService;
  homedir: string;
  workspaceService: Pick<WorkspaceService, 'get'>;
  pluginProvenance: PluginProvenanceService;
  pluginService: PluginService;
  claudeRuntimeReader: ClaudeRuntimePort;
  claudeSettingsFile: ClaudeSettingsFile;
  claudeCli: ClaudeCliPort;
  claudeSessionPort: ClaudeSessionPort;
}

export interface WorkspaceScopedServices {
  entityRepository: FsEntityRepository;
  symlinkManager: SymlinkManager;
  fileMaterializer: FileMaterializer;
  adapterManager: AdapterManager;
  entityService: EntityService;
  skillService: SkillService;
  agentService: AgentService;
  instructionService: InstructionService;
  sessionService: SessionService;
  projectService: ProjectService;
  healthService: HealthService;
  workspaceTeardownService: WorkspaceTeardownService;
}

/** `dataDir` is `<workspace.rootPath>/.ai-companion` — already bootstrapped by the caller. */
export function buildWorkspaceScopedServices(
  dataDir: string,
  shared: WorkspaceScopedSharedDeps,
): WorkspaceScopedServices {
  const {
    clock, nodeFsAdapter, settingsService, homedir, workspaceService,
    pluginProvenance, pluginService, claudeRuntimeReader, claudeSettingsFile,
    claudeCli, claudeSessionPort,
  } = shared;

  const projectService = new ProjectService(new FsProjectRegistry(join(dataDir, 'projects.json')), clock);

  const claudeAdapter = new ClaudeAdapter({ homedir, workspaceService, projectService });
  const cursorAdapter = new CursorAdapter({ homedir, workspaceService, projectService });

  const symlinkManager = new SymlinkManager(nodeFsAdapter, clock, dataDir);
  const fileMaterializer = new FileMaterializer(nodeFsAdapter, clock, dataDir);
  const entityRepository = new FsEntityRepository(dataDir);
  const adapterManager = new AdapterManager({
    settingsService,
    entityRepository,
    symlinkManager,
    fileMaterializer,
    workspacePath: dataDir,
    adapters: new Map<string, Adapter>([
      [claudeAdapter.adapterId, claudeAdapter],
      [cursorAdapter.adapterId, cursorAdapter],
    ]),
  });

  const entityValidator = new EntityValidator();
  const entityService = new EntityService(entityRepository, clock, adapterManager, entityValidator);

  const skillService = new SkillService(entityService, { provenance: pluginProvenance, fs: nodeFsAdapter });
  const agentService = new AgentService(entityService, { provenance: pluginProvenance, fs: nodeFsAdapter });
  const instructionService = new InstructionService(entityService, claudeCli, projectService);
  const sessionService = new SessionService(entityService, claudeSessionPort, dataDir, {
    workspaceService: shared.workspaceService,
    projectService,
  });

  const healthCollectors: HealthCollector[] = [
    new McpAuthCollector(claudeRuntimeReader, clock),
    new McpRuntimeCollector(claudeRuntimeReader, clock),
    new ConfigDriftCollector(pluginService, clock),
    new SymlinkCollector(adapterManager, symlinkManager, clock),
    new GeneratedFileCollector(adapterManager, fileMaterializer, settingsService, clock),
  ];
  const healthService = new HealthService(healthCollectors, clock);

  const workspaceTeardownService = new WorkspaceTeardownService(
    adapterManager,
    nodeFsAdapter,
    dataDir,
    claudeSettingsFile,
  );

  return {
    entityRepository, symlinkManager, fileMaterializer, adapterManager, entityService,
    skillService, agentService, instructionService, sessionService, projectService,
    healthService, workspaceTeardownService,
  };
}
