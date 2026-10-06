import type { IpcHandlers } from './dispatcher.js';
import type { LaunchConfigService } from '../application/services/launch-config-service.js';
import type { LaunchProcessService } from '../application/services/launch-process-service.js';
import { asObject, asString } from './_validators.js';

export function buildLaunchConfigHandlers(
  configService: LaunchConfigService,
  processService: LaunchProcessService,
): IpcHandlers {
  return {
    'launchConfig.list': async () => configService.listAll(),
    'launchConfig.run': async (params) => {
      const raw = asObject(params, 'launchConfig.run');
      return processService.run(asString(raw['projectId'], 'projectId'), asString(raw['configName'], 'configName'));
    },
    'launchConfig.kill': async (params) => {
      const raw = asObject(params, 'launchConfig.kill');
      processService.kill(asString(raw['processId'], 'processId'));
    },
    'launchConfig.status': async (params) => {
      const raw = asObject(params, 'launchConfig.status');
      return processService.status(asString(raw['processId'], 'processId')) ?? null;
    },
  };
}
