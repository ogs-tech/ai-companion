import type { IpcHandlers } from './dispatcher.js';
import type { LaunchConfigService } from '../application/services/launch-config-service.js';
import type { TerminalService } from '../application/services/terminal-service.js';
import { asObject, asString } from './_validators.js';

export function buildLaunchConfigHandlers(
  configService: LaunchConfigService,
  terminalService: TerminalService,
): IpcHandlers {
  return {
    'launchConfig.list': async (params) => {
      const raw = params === undefined || params === null ? {} : asObject(params, 'launchConfig.list');
      return configService.list(raw['folder'] === undefined ? undefined : asString(raw['folder'], 'folder'));
    },
    // A launch is a terminal that runs the configuration's command; stop/status are the `terminal.*` methods.
    'launchConfig.run': async (params) => {
      const raw = asObject(params, 'launchConfig.run');
      return terminalService.runLaunch(
        asString(raw['configName'], 'configName'),
        raw['folder'] === undefined ? undefined : asString(raw['folder'], 'folder'),
      );
    },
  };
}
