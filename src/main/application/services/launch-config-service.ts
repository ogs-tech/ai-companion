import type { LaunchConfig, ProjectLaunchConfigs } from '../../../shared/launch-config.js';
import type { LaunchConfigReaderPort } from '../ports/launch-config-reader-port.js';
import type { ProjectService } from './project-service.js';
import type { Project } from '../../../shared/project.js';
import { DomainError } from '../../domain/errors.js';

export class LaunchConfigService {
  constructor(
    private readonly projectService: Pick<ProjectService, 'list' | 'get'>,
    private readonly reader: LaunchConfigReaderPort,
  ) {}

  private async resolve(project: Project): Promise<ProjectLaunchConfigs> {
    const result = await this.reader.read(project.path);
    return 'error' in result
      ? { projectId: project.id, configs: [], error: result.error }
      : { projectId: project.id, configs: result.configs };
  }

  async listForProject(projectId: string): Promise<ProjectLaunchConfigs> {
    const project = await this.projectService.get(projectId);
    return this.resolve(project);
  }

  /** Every registered Project's launch configs — one project's malformed launch.json never blocks the others. */
  async listAll(): Promise<ProjectLaunchConfigs[]> {
    const projects = await this.projectService.list();
    return Promise.all(projects.map((project) => this.resolve(project)));
  }

  async getConfig(projectId: string, configName: string): Promise<{ config: LaunchConfig; projectPath: string }> {
    const project = await this.projectService.get(projectId);
    const result = await this.reader.read(project.path);
    if ('error' in result) {
      throw new DomainError('io', `Cannot read launch configs for project '${projectId}': ${result.error}`);
    }
    const config = result.configs.find((c) => c.name === configName);
    if (!config) {
      throw new DomainError('not_found', `Launch config '${configName}' not found for project '${projectId}'`);
    }
    return { config, projectPath: project.path };
  }
}
