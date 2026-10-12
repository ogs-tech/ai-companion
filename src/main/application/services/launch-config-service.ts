import type { LaunchConfig, WorkspaceLaunchConfigs } from '../../../shared/launch-config.js';
import type { Workspace } from '../../../shared/workspace.js';
import type { LaunchConfigReaderPort } from '../ports/launch-config-reader-port.js';
import { DomainError } from '../../domain/errors.js';

/** The open workspace's own `.vscode/launch.json`, read at its root. */
export class LaunchConfigService {
  constructor(
    /** `null` at Início — there is no launch.json to read. */
    private readonly activeWorkspace: Pick<Workspace, 'id' | 'rootPath'> | null,
    private readonly reader: LaunchConfigReaderPort,
  ) {}

  async list(): Promise<WorkspaceLaunchConfigs | null> {
    const workspace = this.activeWorkspace;
    if (workspace === null) return null;
    const result = await this.reader.read(workspace.rootPath);
    return 'error' in result
      ? { workspaceId: workspace.id, configs: [], error: result.error }
      : { workspaceId: workspace.id, configs: result.configs };
  }

  async getConfig(configName: string): Promise<{ config: LaunchConfig; workspaceId: string; rootPath: string }> {
    const workspace = this.activeWorkspace;
    if (workspace === null) throw new DomainError('validation', 'No workspace is open — launch configs need one');
    const result = await this.reader.read(workspace.rootPath);
    if ('error' in result) {
      throw new DomainError('io', `Cannot read launch configs for workspace '${workspace.id}': ${result.error}`);
    }
    const config = result.configs.find((c) => c.name === configName);
    if (!config) {
      throw new DomainError('not_found', `Launch config '${configName}' not found in workspace '${workspace.id}'`);
    }
    return { config, workspaceId: workspace.id, rootPath: workspace.rootPath };
  }
}
